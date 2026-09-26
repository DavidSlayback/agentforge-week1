<?php

/**
 * The AgentForge write endpoint: authenticate, authorize, then dispatch.
 *
 * Routes (all require the HMAC headers; all but health require a context token):
 *   GET  health               module and ledger status
 *   POST documents            store a source PDF/scan or a derived-facts JSON
 *   GET  documents            read a module-stored document back (decrypted)
 *   POST lab-results          procedure_order/_code/_report/_result rows
 *   GET  lab-observations     FHIR Observations from the in-process service: one
 *                             source document's, or with no source_document_id
 *                             the patient's module-written lab history
 *   POST clinical-list-items  clinician-confirmed intake meds/allergies
 *
 * Request signatures use AGENTFORGE_MODULE_HMAC_SECRET; context tokens use
 * AGENTFORGE_DEMO_SECRET. The two must differ, so the Week 1 service (which
 * only holds the demo secret) cannot sign module requests.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Api;

use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\ClinicalListItemInput;
use OpenEMR\Modules\AgentForge\Domain\DocumentType;
use OpenEMR\Modules\AgentForge\Domain\DocumentWriteRequest;
use OpenEMR\Modules\AgentForge\Domain\IdempotencyKey;
use OpenEMR\Modules\AgentForge\Domain\LabResultsRequest;
use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Http\AccessPolicy;
use OpenEMR\Modules\AgentForge\Http\ApiError;
use OpenEMR\Modules\AgentForge\Http\ContextTokenVerifier;
use OpenEMR\Modules\AgentForge\Http\HmacVerifier;
use OpenEMR\Modules\AgentForge\Http\RequestAuthenticator;
use OpenEMR\Modules\AgentForge\Http\RoutePolicy;
use OpenEMR\Modules\AgentForge\Http\SignedRequest;
use OpenEMR\Modules\AgentForge\Persistence\ActorResolver;
use OpenEMR\Modules\AgentForge\Persistence\CategoryResolver;
use OpenEMR\Modules\AgentForge\Persistence\IdempotentWriter;
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;
use OpenEMR\Modules\AgentForge\Persistence\OpenEmrAuditSink;
use OpenEMR\Modules\AgentForge\Persistence\PatientResolver;
use OpenEMR\Modules\AgentForge\Persistence\SqlNonceStore;
use OpenEMR\Modules\AgentForge\Persistence\SqlWriteLedger;
use OpenEMR\Modules\AgentForge\Persistence\WriteLedger;

final readonly class AgentForgeApi
{
    public const MODULE_VERSION = '0.2.0';

    public function __construct(
        private RequestAuthenticator $authenticator,
        private ContextTokenVerifier $contextVerifier,
        private AccessPolicy $accessPolicy,
        private WriteLedger $ledger,
        private IdempotentWriter $writer,
        private ChartGateway $chart,
        private AclChecker $acl,
    ) {
    }

    public static function fromEnvironment(): self
    {
        $hmacSecret = self::env('AGENTFORGE_MODULE_HMAC_SECRET');
        $contextSecret = self::env('AGENTFORGE_DEMO_SECRET');
        if ($hmacSecret === '' || $contextSecret === '' || hash_equals($hmacSecret, $contextSecret)) {
            throw new ApiError(503, 'module_not_configured');
        }
        if (!SqlWriteLedger::isInstalled()) {
            throw new ApiError(503, 'ledger_not_installed');
        }
        $ledger = new SqlWriteLedger();
        return new self(
            new RequestAuthenticator(new HmacVerifier($hmacSecret), new SqlNonceStore()),
            new ContextTokenVerifier($contextSecret),
            new AccessPolicy(AccessPolicy::parseAllowlist(self::env('AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS'))),
            $ledger,
            new IdempotentWriter($ledger, new OpenEmrAuditSink()),
            new OpenEmrChartGateway(new PatientResolver(), new ActorResolver(self::env('AGENTFORGE_DEMO_ACTOR_USERNAME')), new CategoryResolver()),
            new OpenEmrAclChecker(),
        );
    }

    /**
     * @param array<array-key, mixed> $query
     * @param array<string, string>   $headers lower-cased names
     * @return array{int, array<string, mixed>}
     */
    public function handle(string $method, array $query, array $headers, string $rawBody, int $now): array
    {
        $request = $this->authenticator->authenticate($method, $query, $headers, $rawBody, $now);
        $policy = AccessPolicy::policyFor($request->method, $request->route);
        if (!$policy->requiresContext) {
            return [200, ['status' => 'ok', 'module_version' => self::MODULE_VERSION, 'ledger_installed' => true, 'persistence_boundary' => 'openemr-module']];
        }
        if ($request->contextToken === null) {
            throw new ApiError(401, 'context_invalid');
        }
        $claims = $this->contextVerifier->verify($request->contextToken, $now);
        $this->accessPolicy->authorize($policy, $request, $claims);
        $patient = new PatientUuid($request->patientUuid ?? '');
        $pid = $this->chart->pidFor($patient);
        $actor = $this->chart->actorFor($claims);
        $this->requireAcl($policy, $actor);

        return match ($request->route) {
            'documents' => $request->method === 'POST' ? $this->storeDocument($request, $pid, $actor) : $this->readDocument($request, $pid),
            'lab-results' => $this->storeLabResults($request, $pid, $actor),
            'lab-observations' => $this->readLabObservations($request, $patient, $pid),
            'clinical-list-items' => $this->storeClinicalListItems($request, $pid, $actor),
            default => throw new ApiError(404, 'route_not_found'),
        };
    }

    /**
     * A module-stored document of one of $operations that belongs to $pid. The
     * pid is checked on the returned row too, so a lookup that ignored the
     * patient could never link or read another patient's document.
     *
     * @param list<string> $operations
     */
    private function ownedDocument(int $pid, int $documentId, array $operations, string $issue): LedgerEntry
    {
        $row = $this->ledger->findDocument($pid, $documentId);
        if ($row === null || $row->pid !== $pid || $row->documentId !== $documentId || !in_array($row->operation, $operations, true)) {
            throw new ApiError(404, 'document_not_found', [$issue]);
        }
        return $row;
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeDocument(SignedRequest $request, int $pid, Actor $actor): array
    {
        $input = DocumentWriteRequest::fromBody($request->body);
        if ($input->sourceDocumentId !== null) {
            $this->ownedDocument($pid, $input->sourceDocumentId, array_map(static fn(DocumentType $type): string => $type->ledgerOperation(), DocumentType::sourceTypes()), 'source_document_not_found');
        }
        $key = $input->documentType === DocumentType::DerivedFacts && $input->sourceDocumentId !== null
            ? IdempotencyKey::forDerivedFacts($pid, $input->sourceDocumentId)
            : IdempotencyKey::forDocument($pid, $input->documentType, $input->contentSha256);
        $categoryId = $this->chart->categoryIdFor($input->documentType);
        $chart = $this->chart;
        $result = $this->writer->execute(
            $key,
            $input->documentType->ledgerOperation(),
            $pid,
            $input->contentSha256,
            $input->payloadSha256(),
            $actor,
            static fn() => $chart->storeDocument($pid, $categoryId, $input, $actor),
        );
        return [$result->httpStatus(), $result->body()];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function readDocument(SignedRequest $request, int $pid): array
    {
        $documentId = $request->queryInt('document_id');
        if ($documentId === null) {
            throw ApiError::invalid(['document_id_invalid']);
        }
        $row = $this->ownedDocument($pid, $documentId, array_map(static fn(DocumentType $type): string => $type->ledgerOperation(), DocumentType::cases()), 'document_not_found');
        return [200, $this->chart->readDocument($pid, $documentId, $row)];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeLabResults(SignedRequest $request, int $pid, Actor $actor): array
    {
        $input = LabResultsRequest::fromBody($request->body);
        $source = $this->ownedDocument($pid, $input->sourceDocumentId, [DocumentType::LabPdf->ledgerOperation()], 'source_lab_document_not_found');
        if ($source->contentSha256 === null || !hash_equals($source->contentSha256, $input->sourceSha256)) {
            throw ApiError::invalid(['source_sha256_mismatch']);
        }
        $chart = $this->chart;
        $result = $this->writer->execute(
            IdempotencyKey::forLabResults($pid, $input->sourceSha256),
            'lab',
            $pid,
            $input->sourceSha256,
            $input->payloadSha256(),
            $actor,
            static fn() => $chart->storeLabResults($pid, $input, $actor),
        );
        return [$result->httpStatus(), $result->body()];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function readLabObservations(SignedRequest $request, PatientUuid $patient, int $pid): array
    {
        if (!array_key_exists('source_document_id', $request->query)) {
            return $this->readLabObservationHistory($patient, $pid);
        }
        $sourceId = $request->queryInt('source_document_id');
        if ($sourceId === null) {
            throw ApiError::invalid(['source_document_id_invalid']);
        }
        $labRow = $this->ledger->findBySourceDocument($pid, 'lab', $sourceId);
        if ($labRow === null || $labRow->pid !== $pid || $labRow->documentId !== $sourceId) {
            throw new ApiError(404, 'document_not_found', ['lab_results_not_found']);
        }
        return [200, $this->chart->readLabObservations($patient, $labRow)];
    }

    /**
     * Lab history for the trend chart: only "lab" rows this module wrote for
     * this patient, each linked to a lab PDF this module stored for the same
     * patient. The pid and operation are re-checked on every returned row, so
     * a lookup that ignored the patient could never leak another chart's labs.
     * Rows dropped by these checks are counted in `skipped_lab_rows`, not
     * hidden.
     *
     * @return array{int, array<string, mixed>}
     */
    private function readLabObservationHistory(PatientUuid $patient, int $pid): array
    {
        $rows = [];
        $skipped = 0;
        foreach ($this->ledger->findLabResultsForPatient($pid) as $row) {
            if ($row->pid !== $pid || $row->operation !== 'lab' || $row->documentId === null) {
                $skipped++;
                continue;
            }
            $source = $this->ledger->findDocument($pid, $row->documentId);
            if ($source === null || $source->pid !== $pid || $source->documentId !== $row->documentId || $source->operation !== DocumentType::LabPdf->ledgerOperation()) {
                $skipped++;
                continue;
            }
            $rows[] = $row;
        }
        $bundle = $this->chart->readLabObservationHistory($patient, $rows);
        $bundle['skipped_lab_rows'] = $skipped;
        return [200, $bundle];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeClinicalListItems(SignedRequest $request, int $pid, Actor $actor): array
    {
        $input = ClinicalListItemInput::fromBody($request->body);
        $listSources = [DocumentType::IntakeForm, DocumentType::MedicationList];
        $source = $this->ownedDocument($pid, $input->sourceDocumentId, array_map(static fn(DocumentType $type): string => $type->ledgerOperation(), $listSources), 'source_list_document_not_found');
        $sourceType = null;
        foreach ($listSources as $type) {
            if ($type->ledgerOperation() === $source->operation) {
                $sourceType = $type;
            }
        }
        $allowedKinds = $sourceType === null ? [] : $sourceType->confirmableListItemKinds();
        $disallowed = [];
        foreach ($input->items as $index => $item) {
            if (!in_array($item['kind'], $allowedKinds, true)) {
                $disallowed[] = "items[$index].kind_not_allowed_for_source";
            }
        }
        if ($disallowed !== []) {
            throw ApiError::invalid($disallowed);
        }
        $chart = $this->chart;
        $items = [];
        $created = false;
        foreach ($input->items as $item) {
            $result = $this->writer->execute(
                IdempotencyKey::forListItem($pid, $item['kind'], $input->sourceDocumentId, $item['title']),
                'list:' . $item['kind']->value,
                $pid,
                null,
                hash('sha256', $item['kind']->value . '|' . strtolower(trim($item['title'])) . '|' . $item['field_id']),
                $actor,
                static fn() => $chart->storeListItem($pid, $item['kind'], $item['title'], $input->sourceDocumentId, $input->confirmationEventId, $actor),
            );
            $created = $created || $result->created;
            $items[] = ['field_id' => $item['field_id'], 'duplicate' => !$result->created, 'payload_differs' => $result->payloadDiffers] + $result->response;
        }
        return [$created ? 201 : 200, ['status' => $created ? 'created' : 'duplicate', 'items' => $items]];
    }

    private function requireAcl(RoutePolicy $policy, Actor $actor): void
    {
        if (!$this->acl->allows($policy->aclSection, $policy->aclValue, $actor->username, $policy->write)) {
            throw new ApiError(403, 'acl_denied');
        }
    }

    private static function env(string $name): string
    {
        $value = getenv($name);
        return is_string($value) ? trim($value) : '';
    }
}

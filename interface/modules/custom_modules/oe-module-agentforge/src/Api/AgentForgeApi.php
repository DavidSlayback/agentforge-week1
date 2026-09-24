<?php

/**
 * The AgentForge write endpoint: authenticate, authorize, then dispatch.
 *
 * Routes (all require the HMAC headers; all but health require a context token):
 *   GET  health               module and ledger status
 *   POST documents            store a source PDF/scan or a derived-facts JSON
 *   GET  documents            read a module-stored document back (decrypted)
 *   POST lab-results          procedure_order/_code/_report/_result rows
 *   GET  lab-observations     FHIR Observations from the in-process service
 *   POST clinical-list-items  clinician-confirmed intake meds/allergies
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Api;

use OpenEMR\Common\Acl\AclMain;
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
use OpenEMR\Modules\AgentForge\Persistence\OpenEmrAuditSink;
use OpenEMR\Modules\AgentForge\Persistence\PatientResolver;
use OpenEMR\Modules\AgentForge\Persistence\SqlNonceStore;
use OpenEMR\Modules\AgentForge\Persistence\SqlWriteLedger;
use OpenEMR\Modules\AgentForge\Persistence\WriteLedger;
use OpenEMR\Modules\AgentForge\Read\DocumentReader;
use OpenEMR\Modules\AgentForge\Read\LabObservationReader;
use OpenEMR\Modules\AgentForge\Write\ClinicalListWriter;
use OpenEMR\Modules\AgentForge\Write\DocumentWriter;
use OpenEMR\Modules\AgentForge\Write\LabResultWriter;

final readonly class AgentForgeApi
{
    public const MODULE_VERSION = '0.2.0';

    private function __construct(
        private RequestAuthenticator $authenticator,
        private ContextTokenVerifier $contextVerifier,
        private AccessPolicy $accessPolicy,
        private WriteLedger $ledger,
        private IdempotentWriter $writer,
        private PatientResolver $patients,
        private ActorResolver $actors,
        private CategoryResolver $categories,
    ) {
    }

    public static function fromEnvironment(): self
    {
        $secret = self::env('AGENTFORGE_DEMO_SECRET');
        if ($secret === '') {
            throw new ApiError(503, 'module_not_configured');
        }
        if (!SqlWriteLedger::isInstalled()) {
            throw new ApiError(503, 'ledger_not_installed');
        }
        $ledger = new SqlWriteLedger();
        return new self(
            new RequestAuthenticator(new HmacVerifier($secret), new SqlNonceStore()),
            new ContextTokenVerifier($secret),
            new AccessPolicy(AccessPolicy::parseAllowlist(self::env('AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS'))),
            $ledger,
            new IdempotentWriter($ledger, new OpenEmrAuditSink()),
            new PatientResolver(),
            new ActorResolver(self::env('AGENTFORGE_DEMO_ACTOR_USERNAME')),
            new CategoryResolver(),
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
        $pid = $this->patients->pidFor($patient);
        $actor = $this->actors->forClaims($claims);
        self::requireAcl($policy, $actor);

        return match ($request->route) {
            'documents' => $request->method === 'POST' ? $this->storeDocument($request, $pid, $actor) : $this->readDocument($request, $pid),
            'lab-results' => $this->storeLabResults($request, $pid, $actor),
            'lab-observations' => $this->readLabObservations($request, $patient, $pid),
            'clinical-list-items' => $this->storeClinicalListItems($request, $patient, $pid, $actor),
            default => throw new ApiError(404, 'route_not_found'),
        };
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeDocument(SignedRequest $request, int $pid, Actor $actor): array
    {
        $input = DocumentWriteRequest::fromBody($request->body);
        if ($input->sourceDocumentId !== null) {
            $source = $this->ledger->findDocument($pid, $input->sourceDocumentId);
            if ($source === null || !in_array($source->operation, [DocumentType::LabPdf->ledgerOperation(), DocumentType::IntakeForm->ledgerOperation()], true)) {
                throw new ApiError(404, 'document_not_found', ['source_document_not_found']);
            }
        }
        $key = $input->documentType === DocumentType::DerivedFacts && $input->sourceDocumentId !== null
            ? IdempotencyKey::forDerivedFacts($pid, $input->sourceDocumentId)
            : IdempotencyKey::forDocument($pid, $input->documentType, $input->contentSha256);
        $categoryName = $input->documentType->categoryName();
        $categoryId = $this->categories->idFor($input->documentType);
        $result = $this->writer->execute(
            $key,
            $input->documentType->ledgerOperation(),
            $pid,
            $input->contentSha256,
            $input->payloadSha256(),
            $actor,
            static fn() => (new DocumentWriter())->write($pid, $categoryId, $categoryName, $input, $actor),
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
        $ledgerRow = $this->ledger->findDocument($pid, $documentId);
        if ($ledgerRow === null) {
            throw new ApiError(404, 'document_not_found');
        }
        return [200, (new DocumentReader())->read($pid, $documentId, $ledgerRow)];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeLabResults(SignedRequest $request, int $pid, Actor $actor): array
    {
        $input = LabResultsRequest::fromBody($request->body);
        $source = $this->ledger->findDocument($pid, $input->sourceDocumentId);
        if ($source === null || $source->operation !== DocumentType::LabPdf->ledgerOperation()) {
            throw new ApiError(404, 'document_not_found', ['source_lab_document_not_found']);
        }
        if ($source->contentSha256 === null || !hash_equals($source->contentSha256, $input->sourceSha256)) {
            throw ApiError::invalid(['source_sha256_mismatch']);
        }
        $result = $this->writer->execute(
            IdempotencyKey::forLabResults($pid, $input->sourceSha256),
            'lab',
            $pid,
            $input->sourceSha256,
            $input->payloadSha256(),
            $actor,
            static fn() => (new LabResultWriter())->write($pid, $input, $actor),
        );
        return [$result->httpStatus(), $result->body()];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function readLabObservations(SignedRequest $request, PatientUuid $patient, int $pid): array
    {
        $sourceId = $request->queryInt('source_document_id');
        if ($sourceId === null) {
            throw ApiError::invalid(['source_document_id_invalid']);
        }
        $labRow = $this->ledger->findBySourceDocument($pid, 'lab', $sourceId);
        if ($labRow === null) {
            throw new ApiError(404, 'document_not_found', ['lab_results_not_found']);
        }
        return [200, (new LabObservationReader())->read($patient, $labRow)];
    }

    /**
     * @return array{int, array<string, mixed>}
     */
    private function storeClinicalListItems(SignedRequest $request, PatientUuid $patient, int $pid, Actor $actor): array
    {
        $input = ClinicalListItemInput::fromBody($request->body);
        $source = $this->ledger->findDocument($pid, $input->sourceDocumentId);
        if ($source === null || $source->operation !== DocumentType::IntakeForm->ledgerOperation()) {
            throw new ApiError(404, 'document_not_found', ['source_intake_document_not_found']);
        }
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
                static fn() => (new ClinicalListWriter())->write($pid, $patient, $item['kind'], $item['title'], $input->sourceDocumentId, $input->confirmationEventId, $actor),
            );
            $created = $created || $result->created;
            $items[] = ['field_id' => $item['field_id'], 'duplicate' => !$result->created] + $result->response;
        }
        return [$created ? 201 : 200, ['status' => $created ? 'created' : 'duplicate', 'items' => $items]];
    }

    private static function requireAcl(RoutePolicy $policy, Actor $actor): void
    {
        $allowed = AclMain::aclCheckCore($policy->aclSection, $policy->aclValue, $actor->username, $policy->write ? ['write', 'addonly'] : '');
        if (!$allowed) {
            throw new ApiError(403, 'acl_denied');
        }
    }

    private static function env(string $name): string
    {
        $value = getenv($name);
        return is_string($value) ? trim($value) : '';
    }
}

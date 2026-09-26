<?php

/**
 * ChartGateway backed by the deployed OpenEMR 8.0.0 runtime.
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
use OpenEMR\Modules\AgentForge\Domain\ContextClaims;
use OpenEMR\Modules\AgentForge\Domain\DocumentType;
use OpenEMR\Modules\AgentForge\Domain\DocumentWriteRequest;
use OpenEMR\Modules\AgentForge\Domain\LabResultsRequest;
use OpenEMR\Modules\AgentForge\Domain\ListItemKind;
use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Persistence\ActorResolver;
use OpenEMR\Modules\AgentForge\Persistence\CategoryResolver;
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;
use OpenEMR\Modules\AgentForge\Persistence\PatientResolver;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;
use OpenEMR\Modules\AgentForge\Read\DocumentReader;
use OpenEMR\Modules\AgentForge\Read\LabObservationReader;
use OpenEMR\Modules\AgentForge\Write\ClinicalListWriter;
use OpenEMR\Modules\AgentForge\Write\DocumentWriter;
use OpenEMR\Modules\AgentForge\Write\LabResultWriter;

final readonly class OpenEmrChartGateway implements ChartGateway
{
    public function __construct(
        private PatientResolver $patients,
        private ActorResolver $actors,
        private CategoryResolver $categories,
    ) {
    }

    public function pidFor(PatientUuid $patient): int
    {
        return $this->patients->pidFor($patient);
    }

    public function actorFor(ContextClaims $claims): Actor
    {
        return $this->actors->forClaims($claims);
    }

    public function categoryIdFor(DocumentType $type): int
    {
        return $this->categories->idFor($type);
    }

    public function storeDocument(int $pid, int $categoryId, DocumentWriteRequest $request, Actor $actor): WriteOutcome
    {
        return (new DocumentWriter())->write($pid, $categoryId, $request->documentType->categoryName(), $request, $actor);
    }

    public function readDocument(int $pid, int $documentId, LedgerEntry $ledgerRow): array
    {
        return (new DocumentReader())->read($pid, $documentId, $ledgerRow);
    }

    public function storeLabResults(int $pid, LabResultsRequest $request, Actor $actor): WriteOutcome
    {
        return (new LabResultWriter())->write($pid, $request, $actor);
    }

    public function readLabObservations(PatientUuid $patient, LedgerEntry $labRow): array
    {
        return (new LabObservationReader())->read($patient, $labRow);
    }

    public function readLabObservationHistory(PatientUuid $patient, array $labRows): array
    {
        return (new LabObservationReader())->readHistory($patient, $labRows);
    }

    public function storeListItem(int $pid, ListItemKind $kind, string $title, int $sourceDocumentId, string $confirmationEventId, Actor $actor): WriteOutcome
    {
        return (new ClinicalListWriter())->write($pid, $kind, $title, $sourceDocumentId, $confirmationEventId, $actor);
    }
}

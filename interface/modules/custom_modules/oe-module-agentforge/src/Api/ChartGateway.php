<?php

/**
 * Everything the endpoint needs from OpenEMR itself: patient and actor
 * resolution, categories, and the document / lab / list writers and readers.
 * Injected so the dispatcher can be tested without an OpenEMR runtime.
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
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;

interface ChartGateway
{
    public function pidFor(PatientUuid $patient): int;

    public function actorFor(ContextClaims $claims): Actor;

    public function categoryIdFor(DocumentType $type): int;

    public function storeDocument(int $pid, int $categoryId, DocumentWriteRequest $request, Actor $actor): WriteOutcome;

    /**
     * @return array<string, mixed>
     */
    public function readDocument(int $pid, int $documentId, LedgerEntry $ledgerRow): array;

    public function storeLabResults(int $pid, LabResultsRequest $request, Actor $actor): WriteOutcome;

    /**
     * @return array<string, mixed>
     */
    public function readLabObservations(PatientUuid $patient, LedgerEntry $labRow): array;

    public function storeListItem(int $pid, ListItemKind $kind, string $title, int $sourceDocumentId, string $confirmationEventId, Actor $actor): WriteOutcome;
}

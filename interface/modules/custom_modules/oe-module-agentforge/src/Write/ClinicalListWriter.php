<?php

/**
 * Writes one clinician-confirmed intake medication or allergy to `lists`.
 *
 * Inputs are validated by ClinicalListItemInput before this runs, and both
 * kinds are inserted through QueryUtils with a registry uuid, so a database
 * failure throws (and becomes a JSON error) instead of reaching the legacy
 * HelpfulDie path that AllergyIntoleranceService's validator can hit, and
 * medications get the uuid that ListService::insert omits in 8.0.0.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\ListItemKind;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;

final readonly class ClinicalListWriter
{
    public function write(int $pid, ListItemKind $kind, string $title, int $sourceDocumentId, string $confirmationEventId, Actor $actor): WriteOutcome
    {
        $comments = sprintf('AgentForge intake doc %d; clinician-confirmed %s', $sourceDocumentId, $confirmationEventId);
        $type = match ($kind) {
            ListItemKind::Allergy => 'allergy',
            ListItemKind::Medication => 'medication',
        };
        // lists.verification is the allergyintolerance-verification list.
        $verification = match ($kind) {
            ListItemKind::Allergy => 'confirmed',
            ListItemKind::Medication => '',
        };
        $uuid = (new UuidRegistry(['table_name' => 'lists']))->createUuid();
        $id = (int) QueryUtils::sqlInsert(
            'INSERT INTO lists (uuid, date, type, title, activity, comments, pid, user, verification) VALUES (?, NOW(), ?, ?, 1, ?, ?, ?, ?)',
            [$uuid, $type, $title, $comments, $pid, $actor->username, $verification],
        );
        return new WriteOutcome(
            ['kind' => $kind->value, 'list_id' => $id, 'list_uuid' => UuidRegistry::uuidToString($uuid), 'source_document_id' => $sourceDocumentId],
            $sourceDocumentId,
            null,
            1,
        );
    }
}

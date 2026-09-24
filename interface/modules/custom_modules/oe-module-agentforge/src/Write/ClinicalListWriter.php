<?php

/**
 * Writes one clinician-confirmed intake medication or allergy to `lists`.
 *
 * Allergies go through AllergyIntoleranceService::insert (validated, uuid
 * assigned). ListService::insert sets no uuid for medications in 8.0.0, so
 * medications are inserted directly with a registry uuid.
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
use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Http\ApiError;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;
use OpenEMR\Services\AllergyIntoleranceService;

final readonly class ClinicalListWriter
{
    public function write(int $pid, PatientUuid $patient, ListItemKind $kind, string $title, int $sourceDocumentId, string $confirmationEventId, Actor $actor): WriteOutcome
    {
        $comments = sprintf('AgentForge intake doc %d; clinician-confirmed %s', $sourceDocumentId, $confirmationEventId);
        [$listId, $listUuid] = match ($kind) {
            ListItemKind::Allergy => self::insertAllergy($patient, $title, $comments, $actor),
            ListItemKind::Medication => self::insertMedication($pid, $title, $comments, $actor),
        };
        return new WriteOutcome(
            ['kind' => $kind->value, 'list_id' => $listId, 'list_uuid' => $listUuid, 'source_document_id' => $sourceDocumentId],
            $sourceDocumentId,
            null,
            1,
        );
    }

    /**
     * @return array{int, string}
     */
    private static function insertAllergy(PatientUuid $patient, string $title, string $comments, Actor $actor): array
    {
        $result = (new AllergyIntoleranceService())->insert([
            'puuid' => $patient->value,
            'title' => $title,
            'verification' => 'confirmed',
            'comments' => $comments,
            'user' => $actor->username,
        ]);
        if (!$result->isValid()) {
            throw ApiError::invalid(['allergy_rejected_by_openemr_validator']);
        }
        if ($result->hasErrors()) {
            throw new \RuntimeException('AllergyIntoleranceService::insert failed');
        }
        $data = $result->getData();
        $row = is_array($data) && isset($data[0]) && is_array($data[0]) ? $data[0] : [];
        $id = $row['id'] ?? null;
        $uuid = $row['uuid'] ?? null;
        if (!is_numeric($id) || !is_string($uuid)) {
            throw new \RuntimeException('AllergyIntoleranceService::insert returned no id');
        }
        return [(int) $id, $uuid];
    }

    /**
     * @return array{int, string}
     */
    private static function insertMedication(int $pid, string $title, string $comments, Actor $actor): array
    {
        $uuid = (new UuidRegistry(['table_name' => 'lists']))->createUuid();
        $id = (int) QueryUtils::sqlInsert(
            "INSERT INTO lists (uuid, date, type, title, activity, comments, pid, user) VALUES (?, NOW(), 'medication', ?, 1, ?, ?, ?)",
            [$uuid, $title, $comments, $pid, $actor->username],
        );
        return [$id, UuidRegistry::uuidToString($uuid)];
    }
}

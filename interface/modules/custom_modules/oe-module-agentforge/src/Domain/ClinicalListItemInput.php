<?php

/**
 * Parsed body of POST route=clinical-list-items: intake or medication-list
 * medications and intake allergies a clinician has explicitly confirmed
 * (never unconfirmed drafts).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class ClinicalListItemInput
{
    public const MAX_ITEMS = 20;

    /**
     * @param non-empty-list<array{kind: ListItemKind, title: string, field_id: string}> $items
     */
    private function __construct(
        public PatientUuid $patientUuid,
        public int $sourceDocumentId,
        public string $confirmationEventId,
        public array $items,
    ) {
    }

    /**
     * @param array<string, mixed> $body
     */
    public static function fromBody(array $body): self
    {
        $patient = new PatientUuid(is_string($body['patient_uuid'] ?? null) ? $body['patient_uuid'] : '');
        $issues = [];
        $sourceId = $body['source_document_id'] ?? null;
        if (!is_int($sourceId) || $sourceId <= 0) {
            $issues[] = 'source_document_id_invalid';
        }
        $eventId = is_string($body['confirmation_event_id'] ?? null) ? $body['confirmation_event_id'] : '';
        if (preg_match('/^[A-Za-z0-9._:-]{1,64}$/', $eventId) !== 1) {
            $issues[] = 'confirmation_event_id_invalid';
        }
        $rows = $body['items'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === [] || count($rows) > self::MAX_ITEMS) {
            throw ApiError::invalid([...$issues, 'items_must_be_1_to_20']);
        }
        $items = [];
        foreach ($rows as $index => $row) {
            $kind = is_array($row) && is_string($row['kind'] ?? null) ? ListItemKind::tryFrom($row['kind']) : null;
            $title = is_array($row) && is_string($row['title'] ?? null) ? trim($row['title']) : '';
            $fieldId = is_array($row) && is_string($row['field_id'] ?? null) ? $row['field_id'] : '';
            if ($kind === null) {
                $issues[] = "items[$index].kind_invalid";
            }
            if (strlen($title) < 2 || strlen($title) > 255 || preg_match('/[\x00-\x1f\x7f]/', $title) === 1) {
                $issues[] = "items[$index].title_invalid";
            }
            if (preg_match('/^[a-z0-9._]{1,64}$/', $fieldId) !== 1) {
                $issues[] = "items[$index].field_id_invalid";
            }
            if ($kind !== null) {
                $items[] = ['kind' => $kind, 'title' => $title, 'field_id' => $fieldId];
            }
        }
        if ($issues !== [] || $items === [] || !is_int($sourceId)) {
            throw ApiError::invalid($issues === [] ? ['items_invalid'] : $issues);
        }
        return new self($patient, $sourceId, $eventId, $items);
    }
}

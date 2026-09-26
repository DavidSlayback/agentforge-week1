<?php

/**
 * Builds a patient's lab-history Bundle from OpenEMR's FHIR laboratory
 * Observations and this module's "lab" ledger rows. Pure (no database, no
 * OpenEMR runtime), so it is tested directly.
 *
 * Only Observations whose id a module ledger row recorded are returned, so
 * lab results that did not come from an AgentForge-stored source document
 * never appear. Each entry carries the source document id from the ledger,
 * the field id and page the module wrote into the result's note, and the
 * collection date in the server's local time zone (OpenEMR's FHIR service
 * converted the stored local date to UTC; this converts it back, in the
 * same process and time zone).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Read;

use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;

final readonly class LabHistoryAssembler
{
    public const SCOPE = 'patient_lab_history';
    private const NOTE = '/^agentforge:v1 doc=([0-9]+) page=([0-9]+) field=(lab\.[a-z0-9_]{1,40})$/';

    /**
     * @param list<LedgerEntry>                 $labRows   module "lab" ledger rows of one patient
     * @param list<array<array-key, mixed>>     $resources serialized FHIR Observations
     * @return array<string, mixed>
     */
    public static function assemble(array $labRows, array $resources, \DateTimeZone $timeZone, string $readPath): array
    {
        /** @var array<string, array{LedgerEntry, ?string}> $expected observation id => [row, field id] */
        $expected = [];
        foreach ($labRows as $row) {
            if ($row->documentId === null) {
                continue;
            }
            $fieldIds = [];
            foreach (is_array($row->response['results'] ?? null) ? $row->response['results'] : [] as $result) {
                if (is_array($result) && is_string($result['observation_id'] ?? null) && is_string($result['field_id'] ?? null)) {
                    $fieldIds[$result['observation_id']] = $result['field_id'];
                }
            }
            foreach (is_array($row->response['observation_ids'] ?? null) ? $row->response['observation_ids'] : [] as $id) {
                if (is_string($id)) {
                    $expected[$id] = [$row, $fieldIds[$id] ?? null];
                }
            }
        }
        $entries = [];
        $found = [];
        $unlinked = [];
        foreach ($resources as $resource) {
            $id = $resource['id'] ?? null;
            if (!is_string($id) || !isset($expected[$id]) || isset($found[$id])) {
                continue;
            }
            [$row, $fieldId] = $expected[$id];
            $note = self::note($resource);
            // The note is written by this module; a note naming another
            // document means the row is not the one the ledger recorded.
            if ($note !== null && $note['doc'] !== $row->documentId) {
                $unlinked[] = $id;
                continue;
            }
            $found[$id] = true;
            $entries[] = [
                'resource' => $resource,
                'source_document_id' => $row->documentId,
                'field_id' => $fieldId ?? $note['field'] ?? null,
                'page' => $note['page'] ?? null,
                'collection_date' => self::localDate($resource['effectiveDateTime'] ?? null, $timeZone),
            ];
        }
        $documentIds = [];
        foreach ($labRows as $row) {
            if ($row->documentId !== null) {
                $documentIds[$row->documentId] = true;
            }
        }
        return [
            'resourceType' => 'Bundle',
            'type' => 'searchset',
            'scope' => self::SCOPE,
            'total' => count($entries),
            'read_path' => $readPath,
            'source_document_ids' => array_keys($documentIds),
            'expected_observation_ids' => array_keys($expected),
            'missing_observation_ids' => array_values(array_diff(array_keys($expected), array_keys($found))),
            'unlinked_observation_ids' => $unlinked,
            'entry' => $entries,
        ];
    }

    /**
     * @param array<array-key, mixed> $resource
     * @return array{doc: int, page: int, field: string}|null
     */
    private static function note(array $resource): ?array
    {
        foreach (is_array($resource['note'] ?? null) ? $resource['note'] : [] as $note) {
            $text = is_array($note) ? ($note['text'] ?? null) : null;
            if (is_string($text) && preg_match(self::NOTE, $text, $match) === 1) {
                return ['doc' => (int) $match[1], 'page' => (int) $match[2], 'field' => $match[3]];
            }
        }
        return null;
    }

    private static function localDate(mixed $effective, \DateTimeZone $timeZone): ?string
    {
        if (!is_string($effective) || preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}/', $effective) !== 1) {
            return null;
        }
        try {
            return (new \DateTimeImmutable($effective))->setTimezone($timeZone)->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }
}

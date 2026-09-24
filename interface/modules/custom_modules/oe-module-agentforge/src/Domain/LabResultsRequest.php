<?php

/**
 * Parsed body of POST route=lab-results.
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

final readonly class LabResultsRequest
{
    public const MAX_RESULTS = 50;

    /**
     * @param non-empty-list<LabResultInput> $results
     */
    private function __construct(
        public PatientUuid $patientUuid,
        public int $sourceDocumentId,
        public string $sourceSha256,
        public array $results,
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
        $sourceSha = is_string($body['source_sha256'] ?? null) ? $body['source_sha256'] : '';
        if (preg_match('/^[0-9a-f]{64}$/', $sourceSha) !== 1) {
            $issues[] = 'source_sha256_invalid';
        }
        $rows = $body['results'] ?? null;
        if (!is_array($rows) || !array_is_list($rows) || $rows === [] || count($rows) > self::MAX_RESULTS) {
            throw ApiError::invalid([...$issues, 'results_must_be_1_to_50']);
        }
        $results = [];
        $fieldIds = [];
        foreach ($rows as $index => $row) {
            if (!is_array($row)) {
                $issues[] = "results[$index].must_be_object";
                continue;
            }
            $result = LabResultInput::fromArray($row, $index, $issues);
            if ($result === null) {
                continue;
            }
            if (isset($fieldIds[$result->fieldId])) {
                $issues[] = "results[$index].field_id_duplicate";
                continue;
            }
            $fieldIds[$result->fieldId] = true;
            $results[] = $result;
        }
        if ($issues !== [] || $results === [] || !is_int($sourceId)) {
            throw ApiError::invalid($issues === [] ? ['results_invalid'] : $issues);
        }
        return new self($patient, $sourceId, $sourceSha, $results);
    }

    public function payloadSha256(): string
    {
        $rows = array_map(static fn(LabResultInput $result): array => $result->toArray(), $this->results);
        return hash('sha256', json_encode([$this->sourceDocumentId, $this->sourceSha256, $rows], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    public function collectionDate(): string
    {
        return $this->results[0]->collectionDate;
    }
}

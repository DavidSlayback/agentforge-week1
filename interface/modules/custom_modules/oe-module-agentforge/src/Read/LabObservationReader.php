<?php

/**
 * Reads lab results back as US Core Observations produced by OpenEMR's own
 * FHIR service, called in-process. This is NOT the /fhir HTTP API, which is
 * disabled on the deployment (rest_fhir_api=0); the label says so.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Read;

use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;
use OpenEMR\Services\FHIR\FhirObservationService;

final readonly class LabObservationReader
{
    public const READ_PATH = 'openemr-fhir-service-in-process';

    /**
     * @return array<string, mixed>
     */
    public function read(PatientUuid $patient, LedgerEntry $labRow): array
    {
        $expected = [];
        foreach (is_array($labRow->response['observation_ids'] ?? null) ? $labRow->response['observation_ids'] : [] as $id) {
            if (is_string($id)) {
                $expected[$id] = true;
            }
        }
        $result = (new FhirObservationService())->getAll(['category' => 'laboratory'], $patient->value);
        if ($result->hasErrors()) {
            throw new \RuntimeException('FhirObservationService::getAll reported errors');
        }
        $entries = [];
        $found = [];
        $data = $result->getData();
        foreach (is_array($data) ? $data : [] as $resource) {
            if (!$resource instanceof \JsonSerializable) {
                continue;
            }
            $serialized = json_decode(json_encode($resource, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), true, 64, JSON_THROW_ON_ERROR);
            $id = is_array($serialized) ? ($serialized['id'] ?? null) : null;
            if (!is_string($id) || !isset($expected[$id])) {
                continue;
            }
            $found[$id] = true;
            $entries[] = ['resource' => $serialized];
        }
        return [
            'resourceType' => 'Bundle',
            'type' => 'searchset',
            'total' => count($entries),
            'read_path' => self::READ_PATH,
            'source_document_id' => $labRow->documentId,
            'expected_observation_ids' => array_keys($expected),
            'missing_observation_ids' => array_values(array_diff(array_keys($expected), array_keys($found))),
            'entry' => $entries,
        ];
    }

    /**
     * Every Observation of the patient's module-written lab rows, in one FHIR
     * service call, each linked to its source document (LabHistoryAssembler).
     *
     * @param list<LedgerEntry> $labRows
     * @return array<string, mixed>
     */
    public function readHistory(PatientUuid $patient, array $labRows): array
    {
        $timeZone = new \DateTimeZone(date_default_timezone_get());
        if ($labRows === []) {
            return LabHistoryAssembler::assemble([], [], $timeZone, self::READ_PATH);
        }
        $result = (new FhirObservationService())->getAll(['category' => 'laboratory'], $patient->value);
        if ($result->hasErrors()) {
            throw new \RuntimeException('FhirObservationService::getAll reported errors');
        }
        $resources = [];
        $data = $result->getData();
        foreach (is_array($data) ? $data : [] as $resource) {
            if (!$resource instanceof \JsonSerializable) {
                continue;
            }
            $serialized = json_decode(json_encode($resource, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), true, 64, JSON_THROW_ON_ERROR);
            if (is_array($serialized)) {
                $resources[] = $serialized;
            }
        }
        return LabHistoryAssembler::assemble($labRows, $resources, $timeZone, self::READ_PATH);
    }
}

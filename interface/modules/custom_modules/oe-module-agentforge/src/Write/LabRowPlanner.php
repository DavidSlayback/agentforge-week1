<?php

/**
 * Plans the procedure_order / _code / _report / _result rows for one source
 * lab document so that OpenEMR 8.0.0's FHIR laboratory Observation search
 * (ProcedureService::search) returns every result:
 * activity=1, exactly one order code whose seq equals the report's seq,
 * a report uuid, and results linked to the report. Pure (no database).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\LabResultInput;
use OpenEMR\Modules\AgentForge\Domain\LabResultsRequest;

final readonly class LabRowPlanner
{
    public const ORDER_SEQ = 1;
    public const PROCEDURE_CODE = 'AF-EXTRACTED-LAB';
    public const PROCEDURE_NAME = 'AgentForge extracted lab report';

    /**
     * @return array{
     *   order: array<string, int|string>,
     *   code: array<string, int|string>,
     *   report: array<string, int|string>,
     *   results: list<array<string, int|string>>
     * }
     */
    public static function plan(int $pid, LabResultsRequest $request, Actor $actor): array
    {
        $date = $request->collectionDate() . ' 00:00:00';
        $sourceId = $request->sourceDocumentId;
        return [
            'order' => [
                'provider_id' => 0, // the actor did not order this test
                'patient_id' => $pid,
                'encounter_id' => 0,
                'date_collected' => $date,
                'order_status' => 'complete',
                'activity' => 1,
                'control_id' => 'AF1:' . $request->sourceSha256,
                'lab_id' => 0,
                'procedure_order_type' => 'laboratory_test',
                'clinical_hx' => '',
            ],
            'code' => [
                'procedure_order_seq' => self::ORDER_SEQ,
                'procedure_code' => self::PROCEDURE_CODE,
                'procedure_name' => self::PROCEDURE_NAME,
                'procedure_source' => '1',
                'procedure_order_title' => self::PROCEDURE_NAME,
                'procedure_type' => 'laboratory_test',
            ],
            'report' => [
                'procedure_order_seq' => self::ORDER_SEQ,
                'date_collected' => $date,
                // FHIR effectiveDateTime reads date_report; the source has no
                // separate report date, so the collection date is used.
                'date_report' => $date,
                'source' => $actor->userId,
                'report_status' => 'prelim', // unreviewed AI extraction; proc_rep_status option
                'review_status' => 'received', // not clinician-reviewed
                'report_notes' => sprintf('AgentForge extraction from document %d; not clinician-reviewed', $sourceId),
            ],
            'results' => array_map(static fn(LabResultInput $result): array => [
                'field_id' => $result->fieldId,
                'result_data_type' => $result->isNumeric() ? 'N' : 'S',
                'result_code' => $result->loincCode,
                'result_text' => $result->testName,
                'date' => $result->collectionDate . ' 00:00:00',
                'units' => $result->unit,
                'result' => $result->value,
                // Raw source text; 8.0.0 FHIR only emits referenceRange for "low-high".
                'range' => $result->referenceRange,
                'abnormal' => $result->abnormal,
                'comments' => sprintf('agentforge:v1 doc=%d page=%d field=%s', $sourceId, $result->page, $result->fieldId),
                'document_id' => $sourceId,
                'result_status' => 'prelim', // proc_res_status option; 8.0.0 FHIR maps it to status "unknown"
            ], $request->results),
        ];
    }
}

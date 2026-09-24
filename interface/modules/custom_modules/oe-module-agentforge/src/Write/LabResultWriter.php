<?php

/**
 * Inserts the planned procedure_* rows. Runs inside the ledger transaction.
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
use OpenEMR\Modules\AgentForge\Domain\LabResultsRequest;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;

final readonly class LabResultWriter
{
    public function write(int $pid, LabResultsRequest $request, Actor $actor): WriteOutcome
    {
        $plan = LabRowPlanner::plan($pid, $request, $actor);
        $orderUuid = (new UuidRegistry(['table_name' => 'procedure_order']))->createUuid();
        $order = $plan['order'];
        $orderId = (int) QueryUtils::sqlInsert(
            'INSERT INTO procedure_order (uuid, provider_id, patient_id, encounter_id, date_collected, date_ordered, order_status, activity, control_id, lab_id, procedure_order_type, clinical_hx)'
            . ' VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)',
            [$orderUuid, $order['provider_id'], $order['patient_id'], $order['encounter_id'], $order['date_collected'], $order['order_status'], $order['activity'], $order['control_id'], $order['lab_id'], $order['procedure_order_type'], $order['clinical_hx']],
        );
        $code = $plan['code'];
        QueryUtils::sqlStatementThrowException(
            'INSERT INTO procedure_order_code (procedure_order_id, procedure_order_seq, procedure_code, procedure_name, procedure_source, procedure_order_title, procedure_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$orderId, $code['procedure_order_seq'], $code['procedure_code'], $code['procedure_name'], $code['procedure_source'], $code['procedure_order_title'], $code['procedure_type']],
        );
        $reportUuid = (new UuidRegistry(['table_name' => 'procedure_report']))->createUuid();
        $report = $plan['report'];
        $reportId = (int) QueryUtils::sqlInsert(
            'INSERT INTO procedure_report (uuid, procedure_order_id, procedure_order_seq, date_collected, date_report, source, report_status, review_status, report_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$reportUuid, $orderId, $report['procedure_order_seq'], $report['date_collected'], $report['date_report'], $report['source'], $report['report_status'], $report['review_status'], $report['report_notes']],
        );
        $results = [];
        foreach ($plan['results'] as $row) {
            $resultUuid = (new UuidRegistry(['table_name' => 'procedure_result']))->createUuid();
            $resultId = (int) QueryUtils::sqlInsert(
                'INSERT INTO procedure_result (uuid, procedure_report_id, result_data_type, result_code, result_text, date, units, result, `range`, abnormal, comments, document_id, result_status)'
                . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$resultUuid, $reportId, $row['result_data_type'], $row['result_code'], $row['result_text'], $row['date'], $row['units'], $row['result'], $row['range'], $row['abnormal'], $row['comments'], $row['document_id'], $row['result_status']],
            );
            $results[] = [
                'field_id' => $row['field_id'],
                'procedure_result_id' => $resultId,
                'observation_id' => UuidRegistry::uuidToString($resultUuid),
            ];
        }
        return new WriteOutcome(
            [
                'source_document_id' => $request->sourceDocumentId,
                'procedure_order_id' => $orderId,
                'procedure_order_uuid' => UuidRegistry::uuidToString($orderUuid),
                'procedure_report_id' => $reportId,
                'results' => $results,
                'observation_ids' => array_column($results, 'observation_id'),
            ],
            $request->sourceDocumentId,
            $orderId,
            count($results) + 3,
        );
    }
}

<?php

/**
 * One extracted lab value, validated before it can become a procedure_result.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

final readonly class LabResultInput
{
    /**
     * OpenEMR 8.0.0 list proc_res_abnormal, plus "" when the source states no
     * flag. The service maps source text literally and never infers high/low.
     */
    public const ABNORMAL_VALUES = ['', 'no', 'yes', 'high', 'low', 'vhigh', 'vlow'];

    private function __construct(
        public string $fieldId,
        public string $loincCode,
        public string $testName,
        public string $value,
        public string $unit,
        public string $referenceRange,
        public string $abnormal,
        public string $collectionDate,
        public int $page,
    ) {
    }

    /**
     * @param array<array-key, mixed> $row
     * @param list<string> $issues collects issue codes; returns null when invalid
     */
    public static function fromArray(array $row, int $index, array &$issues): ?self
    {
        $prefix = "results[$index].";
        $string = static fn(string $key): string => is_string($row[$key] ?? null) ? trim($row[$key]) : '';
        $fieldId = $string('field_id');
        $loinc = $string('loinc_code');
        $testName = $string('test_name');
        $value = $string('value');
        $unit = $string('unit');
        $range = $string('reference_range');
        $abnormal = $string('abnormal');
        $date = $string('collection_date');
        $page = $row['page'] ?? null;
        $before = count($issues);
        if (preg_match('/^lab\.[a-z0-9_]{1,40}$/', $fieldId) !== 1) {
            $issues[] = $prefix . 'field_id_invalid';
        }
        if (preg_match('/^[0-9]{1,7}-[0-9]$/', $loinc) !== 1) {
            $issues[] = $prefix . 'loinc_code_invalid';
        }
        if ($testName === '' || strlen($testName) > 255) {
            $issues[] = $prefix . 'test_name_invalid';
        }
        if ($value === '' || strlen($value) > 255) {
            $issues[] = $prefix . 'value_invalid';
        }
        if (strlen($unit) > 31) {
            $issues[] = $prefix . 'unit_invalid';
        }
        if (strlen($range) > 255) {
            $issues[] = $prefix . 'reference_range_invalid';
        }
        if (!in_array($abnormal, self::ABNORMAL_VALUES, true)) {
            $issues[] = $prefix . 'abnormal_invalid';
        }
        if (!self::isDate($date)) {
            $issues[] = $prefix . 'collection_date_invalid';
        }
        if (!is_int($page) || $page < 1 || $page > 999) {
            $issues[] = $prefix . 'page_invalid';
        }
        if (count($issues) !== $before || !is_int($page)) {
            return null;
        }
        return new self($fieldId, $loinc, $testName, $value, $unit, $range, $abnormal, $date, $page);
    }

    public function isNumeric(): bool
    {
        return preg_match('/^-?[0-9]+(\.[0-9]+)?$/', $this->value) === 1;
    }

    /**
     * @return array<string, string|int>
     */
    public function toArray(): array
    {
        return [
            'field_id' => $this->fieldId,
            'loinc_code' => $this->loincCode,
            'test_name' => $this->testName,
            'value' => $this->value,
            'unit' => $this->unit,
            'reference_range' => $this->referenceRange,
            'abnormal' => $this->abnormal,
            'collection_date' => $this->collectionDate,
            'page' => $this->page,
        ];
    }

    private static function isDate(string $value): bool
    {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $parsed !== false && $parsed->format('Y-m-d') === $value;
    }
}

<?php

/**
 * agentforge_write_ledger on the OpenEMR 8.0.0 database (QueryUtils only).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class SqlWriteLedger implements WriteLedger
{
    public const TABLE = 'agentforge_write_ledger';
    public const NONCE_TABLE = 'agentforge_request_nonce';
    private const LOCK_TIMEOUT_SECONDS = 10;

    public static function isInstalled(): bool
    {
        return QueryUtils::existsTable(self::TABLE) && QueryUtils::existsTable(self::NONCE_TABLE);
    }

    public function acquireLock(string $key): void
    {
        $got = QueryUtils::fetchSingleValue('SELECT GET_LOCK(?, ?) AS got', 'got', [self::lockName($key), self::LOCK_TIMEOUT_SECONDS]);
        if ((string) $got !== '1') {
            throw new ApiError(503, 'ledger_lock_timeout');
        }
    }

    public function releaseLock(string $key): void
    {
        QueryUtils::fetchSingleValue('SELECT RELEASE_LOCK(?) AS released', 'released', [self::lockName($key)]);
    }

    public function find(string $key): ?LedgerEntry
    {
        return self::entry(QueryUtils::querySingleRow('SELECT * FROM agentforge_write_ledger WHERE idempotency_key = ?', [$key]));
    }

    public function findDocument(int $pid, int $documentId): ?LedgerEntry
    {
        return self::entry(QueryUtils::querySingleRow(
            "SELECT * FROM agentforge_write_ledger WHERE pid = ? AND document_id = ? AND operation LIKE 'doc:%' ORDER BY created_at LIMIT 1",
            [$pid, $documentId],
        ));
    }

    public function findBySourceDocument(int $pid, string $operation, int $documentId): ?LedgerEntry
    {
        return self::entry(QueryUtils::querySingleRow(
            'SELECT * FROM agentforge_write_ledger WHERE pid = ? AND operation = ? AND document_id = ? ORDER BY created_at LIMIT 1',
            [$pid, $operation, $documentId],
        ));
    }

    public function findLabResultsForPatient(int $pid): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT * FROM agentforge_write_ledger WHERE pid = ? AND operation = 'lab' ORDER BY created_at",
            [$pid],
        );
        $entries = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $entry = self::entry($row);
            if ($entry !== null) {
                $entries[] = $entry;
            }
        }
        return $entries;
    }

    public function insert(LedgerEntry $entry): void
    {
        QueryUtils::sqlStatementThrowException(
            'INSERT INTO agentforge_write_ledger (idempotency_key, operation, pid, content_sha256, document_id, procedure_order_id, response_json, payload_sha256, actor_user_id, issuer, created_at)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $entry->idempotencyKey,
                $entry->operation,
                $entry->pid,
                $entry->contentSha256,
                $entry->documentId,
                $entry->procedureOrderId,
                json_encode($entry->response, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
                $entry->payloadSha256,
                $entry->actorUserId,
                $entry->issuer,
            ],
        );
    }

    public function transaction(callable $work): mixed
    {
        return QueryUtils::inTransaction($work);
    }

    private static function lockName(string $key): string
    {
        // MariaDB lock names are limited to 64 characters.
        return 'agentforge:' . substr(hash('sha256', $key), 0, 48);
    }

    private static function entry(mixed $row): ?LedgerEntry
    {
        if (!is_array($row)) {
            return null;
        }
        $response = json_decode(is_string($row['response_json'] ?? null) ? $row['response_json'] : '{}', true, 64, JSON_THROW_ON_ERROR);
        $normalized = [];
        foreach (is_array($response) ? $response : [] as $key => $value) {
            $normalized[(string) $key] = $value;
        }
        return new LedgerEntry(
            self::string($row, 'idempotency_key'),
            self::string($row, 'operation'),
            self::int($row, 'pid') ?? 0,
            ($row['content_sha256'] ?? null) === null ? null : self::string($row, 'content_sha256'),
            self::int($row, 'document_id'),
            self::int($row, 'procedure_order_id'),
            $normalized,
            self::string($row, 'payload_sha256'),
            self::int($row, 'actor_user_id') ?? 0,
            self::string($row, 'issuer'),
        );
    }

    /**
     * @param array<array-key, mixed> $row
     */
    private static function string(array $row, string $key): string
    {
        $value = $row[$key] ?? '';
        return is_scalar($value) ? (string) $value : '';
    }

    /**
     * @param array<array-key, mixed> $row
     */
    private static function int(array $row, string $key): ?int
    {
        $value = $row[$key] ?? null;
        if (is_int($value)) {
            return $value;
        }
        return is_string($value) && preg_match('/^-?[0-9]+$/', $value) === 1 ? (int) $value : null;
    }
}

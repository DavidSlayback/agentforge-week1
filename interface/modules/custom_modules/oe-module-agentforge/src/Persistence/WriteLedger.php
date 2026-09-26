<?php

/**
 * Idempotency ledger and the locking/transaction primitives around it.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

interface WriteLedger
{
    /**
     * Serializes writers of one key across PHP workers.
     */
    public function acquireLock(string $key): void;

    public function releaseLock(string $key): void;

    public function find(string $key): ?LedgerEntry;

    public function insert(LedgerEntry $entry): void;

    /**
     * Ledger row for a document this module stored for the patient.
     */
    public function findDocument(int $pid, int $documentId): ?LedgerEntry;

    /**
     * Ledger row of an operation (e.g. "lab") recorded against a source document.
     */
    public function findBySourceDocument(int $pid, string $operation, int $documentId): ?LedgerEntry;

    /**
     * Every "lab" ledger row (procedure rows this module wrote) for the patient,
     * oldest first.
     *
     * @return list<LedgerEntry>
     */
    public function findLabResultsForPatient(int $pid): array;

    /**
     * @template T
     * @param callable(): T $work
     * @return T
     */
    public function transaction(callable $work): mixed;
}

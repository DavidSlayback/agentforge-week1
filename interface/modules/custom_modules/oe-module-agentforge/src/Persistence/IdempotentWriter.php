<?php

/**
 * Lock, look up, and only then write: a repeated request returns the first
 * stored response and adds zero rows. The same key with a different payload
 * is refused with 409 idempotency_conflict (W3 H1), never answered as a
 * duplicate of a write that did not happen. Pure given its WriteLedger/AuditSink.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\IdempotencyKey;
use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class IdempotentWriter
{
    public function __construct(
        private WriteLedger $ledger,
        private AuditSink $audit,
    ) {
    }

    /**
     * Unlocked pre-check, so a multi-item request can refuse a conflict before
     * writing any item; `execute` checks again under the lock.
     */
    public function assertNoConflict(IdempotencyKey $key, string $payloadSha256): void
    {
        $existing = $this->ledger->find($key->value);
        if ($existing !== null) {
            self::refuseConflict($existing, $payloadSha256);
        }
    }

    private static function refuseConflict(LedgerEntry $existing, string $payloadSha256): void
    {
        if (!hash_equals($existing->payloadSha256, $payloadSha256)) {
            throw new ApiError(409, 'idempotency_conflict', ['payload_differs']);
        }
    }

    /**
     * @param callable(): WriteOutcome $write runs inside the ledger transaction
     */
    public function execute(
        IdempotencyKey $key,
        string $operation,
        int $pid,
        ?string $contentSha256,
        string $payloadSha256,
        Actor $actor,
        callable $write,
    ): IdempotentResult {
        $this->ledger->acquireLock($key->value);
        try {
            $existing = $this->ledger->find($key->value);
            if ($existing !== null) {
                self::refuseConflict($existing, $payloadSha256);
                return new IdempotentResult(false, $existing->response);
            }
            $response = $this->ledger->transaction(function () use ($key, $operation, $pid, $contentSha256, $payloadSha256, $actor, $write): array {
                $outcome = $write();
                $response = $outcome->response + ['idempotency_key' => $key->value];
                $this->ledger->insert(new LedgerEntry(
                    $key->value,
                    $operation,
                    $pid,
                    $contentSha256,
                    $outcome->ledgerDocumentId,
                    $outcome->procedureOrderId,
                    $response,
                    $payloadSha256,
                    $actor->userId,
                    $actor->issuer,
                ));
                $this->audit->recordWrite($operation, $actor, $pid, $outcome->ledgerDocumentId, $outcome->rowCount);
                return $response;
            });
            return new IdempotentResult(true, $response);
        } finally {
            $this->ledger->releaseLock($key->value);
        }
    }
}

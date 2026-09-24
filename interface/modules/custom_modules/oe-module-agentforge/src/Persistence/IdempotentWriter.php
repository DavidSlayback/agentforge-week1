<?php

/**
 * Lock, look up, and only then write: a repeated request returns the first
 * stored response and adds zero rows. Pure given its WriteLedger/AuditSink.
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

final readonly class IdempotentWriter
{
    public function __construct(
        private WriteLedger $ledger,
        private AuditSink $audit,
    ) {
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
                return new IdempotentResult(false, $existing->response, !hash_equals($existing->payloadSha256, $payloadSha256));
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
            return new IdempotentResult(true, $response, false);
        } finally {
            $this->ledger->releaseLock($key->value);
        }
    }
}

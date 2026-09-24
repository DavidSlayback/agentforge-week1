<?php

/**
 * One row of agentforge_write_ledger: the first response for a key.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

final readonly class LedgerEntry
{
    /**
     * @param array<string, mixed> $response
     */
    public function __construct(
        public string $idempotencyKey,
        public string $operation,
        public int $pid,
        public ?string $contentSha256,
        public ?int $documentId,
        public ?int $procedureOrderId,
        public array $response,
        public string $payloadSha256,
        public int $actorUserId,
        public string $issuer,
    ) {
    }
}

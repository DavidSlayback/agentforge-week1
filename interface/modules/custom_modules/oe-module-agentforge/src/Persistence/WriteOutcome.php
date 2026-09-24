<?php

/**
 * What a writer produced: the response to store, and the ids the ledger indexes.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

final readonly class WriteOutcome
{
    /**
     * @param array<string, mixed> $response
     */
    public function __construct(
        public array $response,
        public ?int $ledgerDocumentId,
        public ?int $procedureOrderId,
        public int $rowCount,
    ) {
    }
}

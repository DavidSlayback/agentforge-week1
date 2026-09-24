<?php

/**
 * Single-use storage for request nonces (replay protection).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

interface NonceStore
{
    /**
     * Record the nonce. Returns false when it was already used.
     */
    public function claim(string $nonce, int $expiresAt, int $now): bool;
}

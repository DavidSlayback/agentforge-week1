<?php

/**
 * The OpenEMR user a write is attributed to, and which issuer vouched for it.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

final readonly class Actor
{
    public function __construct(
        public int $userId,
        public string $username,
        public string $issuer,
    ) {
        if ($userId <= 0 || $username === '') {
            throw new \DomainException('Actor requires an active OpenEMR user');
        }
    }
}

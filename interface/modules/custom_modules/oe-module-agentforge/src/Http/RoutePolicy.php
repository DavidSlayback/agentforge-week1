<?php

/**
 * Authorization requirements of one module route.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class RoutePolicy
{
    /**
     * @param list<string> $allowedScopes
     */
    public function __construct(
        public bool $requiresContext,
        public array $allowedScopes,
        public string $aclSection,
        public string $aclValue,
        public bool $write,
    ) {
    }
}

<?php

/**
 * Resolves the OpenEMR user a write is attributed to (design D-D / D-E).
 *
 * openemr-module tokens name the launching user by users.uuid; synthetic-demo
 * tokens are attributed to AGENTFORGE_DEMO_ACTOR_USERNAME and keep their
 * issuer in the ledger, so demo writes stay distinguishable.
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
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\ContextClaims;
use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class ActorResolver
{
    public function __construct(private string $demoActorUsername)
    {
    }

    public function forClaims(ContextClaims $claims): Actor
    {
        if ($claims->issuer === ContextClaims::ISSUER_OPENEMR_MODULE) {
            if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', strtolower($claims->clinicianUuid)) !== 1) {
                throw new ApiError(401, 'context_invalid');
            }
            $row = QueryUtils::querySingleRow('SELECT id, username, active FROM users WHERE uuid = ?', [UuidRegistry::uuidToBytes(strtolower($claims->clinicianUuid))]);
            return self::actorFrom($row, $claims->issuer);
        }
        if ($this->demoActorUsername === '') {
            throw new ApiError(503, 'module_not_configured', ['demo_actor_missing']);
        }
        $row = QueryUtils::querySingleRow('SELECT id, username, active FROM users WHERE username = ?', [$this->demoActorUsername]);
        return self::actorFrom($row, $claims->issuer);
    }

    private static function actorFrom(mixed $row, string $issuer): Actor
    {
        if (!is_array($row) || (string) ($row['active'] ?? '0') !== '1') {
            throw new ApiError(403, 'acl_denied', ['actor_not_active']);
        }
        $id = $row['id'] ?? null;
        $username = $row['username'] ?? null;
        if (!is_scalar($id) || preg_match('/^[1-9][0-9]*$/', (string) $id) !== 1 || !is_string($username) || $username === '') {
            throw new ApiError(403, 'acl_denied', ['actor_not_active']);
        }
        return new Actor((int) $id, $username, $issuer);
    }
}

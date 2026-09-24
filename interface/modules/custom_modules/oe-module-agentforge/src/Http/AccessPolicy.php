<?php

/**
 * Route table and context-token authorization rules for the write endpoint.
 *
 * Pure: the OpenEMR ACL check itself runs later against the resolved actor.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

use OpenEMR\Modules\AgentForge\Domain\ContextClaims;

final readonly class AccessPolicy
{
    private const READ_SCOPES = ['read-briefing', 'write-source-document', 'write-clinical-action'];

    /**
     * @param list<string> $demoPatientAllowlist lower-case OpenEMR patient uuids
     */
    public function __construct(private array $demoPatientAllowlist)
    {
    }

    /**
     * @param string $raw comma- or whitespace-separated uuids
     * @return list<string>
     */
    public static function parseAllowlist(string $raw): array
    {
        $uuids = [];
        foreach (preg_split('/[\s,]+/', strtolower(trim($raw))) ?: [] as $candidate) {
            if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $candidate) === 1) {
                $uuids[] = $candidate;
            }
        }
        return array_values(array_unique($uuids));
    }

    public static function policyFor(string $method, string $route): RoutePolicy
    {
        return match ([$method, $route]) {
            ['GET', 'health'] => new RoutePolicy(false, [], 'patients', 'docs', false),
            ['POST', 'documents'] => new RoutePolicy(true, ['write-source-document'], 'patients', 'docs', true),
            ['GET', 'documents'] => new RoutePolicy(true, self::READ_SCOPES, 'patients', 'docs', false),
            ['POST', 'lab-results'] => new RoutePolicy(true, ['write-source-document'], 'patients', 'lab', true),
            ['GET', 'lab-observations'] => new RoutePolicy(true, self::READ_SCOPES, 'patients', 'lab', false),
            ['POST', 'clinical-list-items'] => new RoutePolicy(true, ['write-clinical-action'], 'patients', 'med', true),
            default => throw new ApiError(404, 'route_not_found'),
        };
    }

    public function authorize(RoutePolicy $policy, SignedRequest $request, ContextClaims $claims): void
    {
        if ($request->patientUuid === null || !hash_equals(strtolower($claims->patientUuid), strtolower($request->patientUuid))) {
            throw new ApiError(403, 'patient_scope_mismatch');
        }
        if (!in_array($claims->scope, $policy->allowedScopes, true)) {
            throw new ApiError(403, 'acl_denied', ['context_scope_not_allowed']);
        }
        if ($claims->issuer === ContextClaims::ISSUER_OPENEMR_MODULE) {
            if ($claims->authn !== 'openemr-session') {
                throw new ApiError(401, 'context_invalid');
            }
            return;
        }
        if ($claims->issuer === ContextClaims::ISSUER_SYNTHETIC_DEMO) {
            if (!in_array(strtolower($claims->patientUuid), $this->demoPatientAllowlist, true)) {
                throw new ApiError(403, 'demo_patient_not_allowed');
            }
            return;
        }
        throw new ApiError(401, 'context_invalid');
    }
}

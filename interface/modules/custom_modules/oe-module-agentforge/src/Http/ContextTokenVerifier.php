<?php

/**
 * Verifies the launcher context-token format (public/index.php and
 * agentforge/src/accessContext.js): base64url(JSON) "." base64url(HMAC-SHA256
 * over the encoded payload with the raw AGENTFORGE_DEMO_SECRET).
 * Pure: no OpenEMR dependencies.
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

final readonly class ContextTokenVerifier
{
    public const MAX_TTL_SECONDS = 300;
    private const SCOPE_ACL = [
        'read-briefing' => 'read',
        'write-source-document' => 'write',
        'write-clinical-action' => 'write',
    ];

    public function __construct(private string $secret)
    {
        if ($secret === '') {
            throw new \InvalidArgumentException('AgentForge context secret is not configured');
        }
    }

    public static function sign(string $encodedPayload, string $secret): string
    {
        return HmacVerifier::base64UrlEncode(hash_hmac('sha256', $encodedPayload, $secret, true));
    }

    public function verify(string $token, int $now): ContextClaims
    {
        if (preg_match('/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/', $token, $parts) !== 1) {
            throw new ApiError(401, 'context_invalid');
        }
        if (!hash_equals(self::sign($parts[1], $this->secret), $parts[2])) {
            throw new ApiError(401, 'context_invalid');
        }
        $json = base64_decode(strtr($parts[1], '-_', '+/'), true);
        if ($json === false) {
            throw new ApiError(401, 'context_invalid');
        }
        try {
            $payload = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ApiError(401, 'context_invalid');
        }
        if (!is_array($payload)) {
            throw new ApiError(401, 'context_invalid');
        }
        $strings = [];
        foreach (['patient_uuid', 'clinician_uuid', 'scope', 'issuer', 'authn', 'role', 'acl'] as $field) {
            $value = $payload[$field] ?? null;
            if (!is_string($value) || $value === '') {
                throw new ApiError(401, 'context_invalid');
            }
            $strings[$field] = $value;
        }
        $expiresAt = $payload['expires_at'] ?? null;
        if (!is_int($expiresAt)) {
            throw new ApiError(401, 'context_invalid');
        }
        if ($expiresAt <= $now || $expiresAt > $now + self::MAX_TTL_SECONDS) {
            throw new ApiError(401, 'context_invalid');
        }
        $expectedAcl = self::SCOPE_ACL[$strings['scope']] ?? null;
        if ($strings['role'] !== 'clinician' || $expectedAcl === null || $expectedAcl !== $strings['acl']) {
            throw new ApiError(401, 'context_invalid');
        }
        return new ContextClaims(
            $strings['patient_uuid'],
            $strings['clinician_uuid'],
            $strings['scope'],
            $strings['issuer'],
            $strings['authn'],
            $strings['acl'],
            $expiresAt,
        );
    }
}

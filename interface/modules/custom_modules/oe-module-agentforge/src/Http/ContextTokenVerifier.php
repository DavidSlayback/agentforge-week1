<?php

/**
 * Verifies context tokens: base64url(JSON) "." base64url(signature over the
 * encoded payload). Each issuer has exactly one signature scheme (W3 H1):
 *
 * - issuer openemr-module (the launcher, public/index.php): Ed25519, verified
 *   with AGENTFORGE_LAUNCH_VERIFY_KEY. Only the openemr container holds the
 *   private key, so no holder of AGENTFORGE_DEMO_SECRET can mint one.
 * - every other issuer (synthetic-demo, agentforge/src/accessContext.js):
 *   HMAC-SHA256 with the raw AGENTFORGE_DEMO_SECRET.
 *
 * An HMAC-signed openemr-module token, an Ed25519-signed token of any other
 * issuer, and any launcher token when no verify key is configured are all
 * context_invalid. Pure apart from ext-sodium: no OpenEMR dependencies.
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

    public function __construct(
        private string $secret,
        private ?LaunchVerifyKey $launchKey = null,
    ) {
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
        if (preg_match('/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{86})$/', $token, $parts) !== 1) {
            throw new ApiError(401, 'context_invalid');
        }
        $launchSigned = strlen($parts[2]) === 86;
        if ($launchSigned) {
            $this->verifyLaunchSignature($parts[1], $parts[2]);
        } elseif (!hash_equals(self::sign($parts[1], $this->secret), $parts[2])) {
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
        if (($strings['issuer'] === ContextClaims::ISSUER_OPENEMR_MODULE) !== $launchSigned) {
            throw new ApiError(401, 'context_invalid', ['issuer_signature_scheme_mismatch']);
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

    private function verifyLaunchSignature(string $encodedPayload, string $encodedSignature): void
    {
        if ($this->launchKey === null) {
            throw new ApiError(401, 'context_invalid', ['launch_verify_key_not_configured']);
        }
        $signature = base64_decode(strtr($encodedSignature, '-_', '+/'), true);
        // Canonical encoding only, so one signature has exactly one token string.
        if ($signature === false || HmacVerifier::base64UrlEncode($signature) !== $encodedSignature || !$this->launchKey->verify($encodedPayload, $signature)) {
            throw new ApiError(401, 'context_invalid');
        }
    }
}

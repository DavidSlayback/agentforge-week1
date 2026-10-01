<?php

/**
 * Request-signature primitives for the AgentForge write endpoint.
 *
 * Request signatures use a key derived (HMAC over KEY_LABEL) from
 * AGENTFORGE_MODULE_HMAC_SECRET, which only openemr and agentforge-w2 hold and
 * which must differ from AGENTFORGE_DEMO_SECRET (AgentForgeApi::fromEnvironment).
 * Context tokens are verified separately (ContextTokenVerifier). Pure: no
 * OpenEMR dependencies.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class HmacVerifier
{
    public const KEY_ID = 'v1';
    public const KEY_LABEL = 'agentforge/openemr-write/v1';
    public const MAX_SKEW_SECONDS = 300;

    private string $writeKey;

    public function __construct(string $secret)
    {
        if ($secret === '') {
            throw new \InvalidArgumentException('AgentForge request secret is not configured');
        }
        $this->writeKey = self::deriveWriteKey($secret);
    }

    public static function deriveWriteKey(string $secret): string
    {
        return hash_hmac('sha256', self::KEY_LABEL, $secret, true);
    }

    public static function base64UrlEncode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public function sign(CanonicalRequest $request): string
    {
        return self::base64UrlEncode(hash_hmac('sha256', $request->toString(), $this->writeKey, true));
    }

    public function verify(CanonicalRequest $request, string $signature): bool
    {
        return hash_equals($this->sign($request), $signature);
    }

    public static function withinSkew(int $timestamp, int $now): bool
    {
        return abs($now - $timestamp) <= self::MAX_SKEW_SECONDS;
    }
}

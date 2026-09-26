<?php

/**
 * Mints the context tokens the "Prepare for visit" launcher (public/index.php)
 * hands to the AgentForge W2 service from a logged-in OpenEMR session, in the
 * format ContextTokenVerifier and agentforge/src/accessContext.js verify:
 * base64url(JSON) "." base64url(HMAC-SHA256 with AGENTFORGE_DEMO_SECRET).
 * Every token says issuer openemr-module and authn openemr-session; the W2
 * service reads the real OpenEMR chart only for tokens with those claims.
 *
 * Pure: the caller does the session, ACL and allowlist lookups and passes the
 * results in, so the grant rules are testable without OpenEMR.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Launch;

use OpenEMR\Modules\AgentForge\Domain\ContextClaims;
use OpenEMR\Modules\AgentForge\Http\ContextTokenVerifier;
use OpenEMR\Modules\AgentForge\Http\HmacVerifier;

final readonly class LaunchTokenMinter
{
    /** Under the 300 s ceiling both verifiers enforce, so a small clock skew between containers never rejects a fresh token. */
    public const TTL_SECONDS = 280;
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(private string $secret)
    {
        if ($secret === '') {
            throw new \InvalidArgumentException('AgentForge context secret is not configured');
        }
    }

    /**
     * Which tokens this launch may carry. Reading needs chart read ACL. The
     * write-source-document token also needs document write ACL and a patient
     * on the write allowlist; the module and the W2 service re-check both.
     */
    public static function grant(bool $chartReadAcl, bool $documentWriteAcl, bool $patientOnWriteAllowlist): LaunchGrant
    {
        if (!$chartReadAcl) {
            return LaunchGrant::None;
        }
        return $documentWriteAcl && $patientOnWriteAllowlist ? LaunchGrant::ReadAndUpload : LaunchGrant::ReadOnly;
    }

    public function mint(string $patientUuid, string $clinicianUuid, LaunchScope $scope, int $now): string
    {
        $patient = strtolower($patientUuid);
        $clinician = strtolower($clinicianUuid);
        if (preg_match(self::UUID, $patient) !== 1 || preg_match(self::UUID, $clinician) !== 1) {
            throw new \InvalidArgumentException('Launch tokens need OpenEMR patient and user uuids');
        }
        $payload = json_encode([
            'patient_uuid' => $patient,
            'clinician_uuid' => $clinician,
            'scope' => $scope->scope(),
            'issuer' => ContextClaims::ISSUER_OPENEMR_MODULE,
            'authn' => 'openemr-session',
            'role' => 'clinician',
            'acl' => $scope->acl(),
            'expires_at' => $now + self::TTL_SECONDS,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $encoded = HmacVerifier::base64UrlEncode($payload);
        return $encoded . '.' . ContextTokenVerifier::sign($encoded, $this->secret);
    }

    /**
     * The W2 page URL: `<service>/?demo_token=<read>[&write_token=<write>]`.
     * In production the service URL is the public `/agentforge-w2` path.
     */
    public static function launchUrl(string $serviceUrl, string $readToken, ?string $writeToken): string
    {
        $url = rtrim($serviceUrl, '/') . '/?demo_token=' . rawurlencode($readToken);
        return $writeToken === null ? $url : $url . '&write_token=' . rawurlencode($writeToken);
    }
}

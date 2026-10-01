<?php

/**
 * Mints the context tokens the "Prepare for visit" launcher (public/index.php)
 * hands to the AgentForge W2 service from a logged-in OpenEMR session, in the
 * format ContextTokenVerifier and agentforge/src/accessContext.js verify:
 * base64url(JSON) "." base64url(Ed25519 signature with AGENTFORGE_LAUNCH_SIGNING_KEY).
 * Every token says issuer openemr-module and authn openemr-session; the W2
 * service reads the real OpenEMR chart only for tokens with those claims.
 * Only the openemr container holds the signing key (W3 H1); the verifiers
 * hold its public key, and refuse any openemr-module token signed with the
 * shared AGENTFORGE_DEMO_SECRET.
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
use OpenEMR\Modules\AgentForge\Http\HmacVerifier;

final readonly class LaunchTokenMinter
{
    /** Under the 300 s ceiling both verifiers enforce, so a small clock skew between containers never rejects a fresh token. */
    public const TTL_SECONDS = 280;
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(private LaunchSigningKey $signingKey)
    {
    }

    /**
     * The ACOs the OpenEMR REST routes OpenEMRRestAdapter reads enforce
     * (apis/routes/_rest_routes_standard.inc.php): patient (demographics),
     * medical_problem, medication, allergy, document and encounter. Those
     * reads run as the service's OAuth identity, so the signed-in user must
     * hold every one of them before any token is minted.
     *
     * @var list<array{string, string}>
     */
    public const REQUIRED_READ_ACOS = [
        ['patients', 'demo'],
        ['patients', 'med'],
        ['patients', 'docs'],
        ['encounters', 'notes'],
        ['encounters', 'auth_a'],
    ];

    /**
     * Which tokens this launch may carry.
     *
     * - Every REQUIRED_READ_ACOS entry, for the signed-in user; else None.
     * - The patient on the live allowlist (AGENTFORGE_LIVE_PATIENT_UUIDS, the
     *   designated synthetic patients); else NotDesignated.
     * - Upload also needs patients/docs write and the write allowlist
     *   (AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS); the module API and the W2
     *   service enforce both allowlists again.
     *
     * @param callable(string, string, string): bool $aclCheck section, value, return value ('' = any)
     */
    public static function grant(callable $aclCheck, bool $patientOnLiveAllowlist, bool $patientOnWriteAllowlist): LaunchGrant
    {
        foreach (self::REQUIRED_READ_ACOS as [$section, $value]) {
            if (!$aclCheck($section, $value, '')) {
                return LaunchGrant::None;
            }
        }
        if (!$patientOnLiveAllowlist) {
            return LaunchGrant::NotDesignated;
        }
        return $aclCheck('patients', 'docs', 'write') && $patientOnWriteAllowlist ? LaunchGrant::ReadAndUpload : LaunchGrant::ReadOnly;
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
        return $encoded . '.' . HmacVerifier::base64UrlEncode($this->signingKey->sign($encoded));
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

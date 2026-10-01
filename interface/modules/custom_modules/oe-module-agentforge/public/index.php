<?php

/**
 * "Prepare for visit" launcher: hands the logged-in OpenEMR session's patient
 * context to the AgentForge W2 service as short-lived Ed25519-signed tokens
 * (issuer openemr-module, authn openemr-session; AGENTFORGE_LAUNCH_SIGNING_KEY,
 * held only by this container). The service reads the real chart
 * for these tokens only when AGENTFORGE_OPENEMR_LIVE_READS=on, and it
 * exchanges them once, on the first page load, for a launch session, so a
 * replayed link is refused (agentforge/src/launchSession.js); see
 * src/Launch/LaunchTokenMinter.php for the grant rules.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once dirname(__FILE__, 5) . '/globals.php';
require_once dirname(__DIR__) . '/src/autoload.php';

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Logging\SystemLogger;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Http\AccessPolicy;
use OpenEMR\Modules\AgentForge\Launch\LaunchGrant;
use OpenEMR\Modules\AgentForge\Launch\LaunchScope;
use OpenEMR\Modules\AgentForge\Launch\LaunchSigningKey;
use OpenEMR\Modules\AgentForge\Launch\LaunchTokenMinter;

$session = SessionWrapperFactory::getInstance()->getWrapper();
$pidValue = $session->get('pid');
$userIdValue = $session->get('authUserID');
$usernameValue = $session->get('authUser');
$pid = is_scalar($pidValue) ? (string) $pidValue : '';
$userId = is_scalar($userIdValue) ? (string) $userIdValue : '';
$username = is_string($usernameValue) ? $usernameValue : '';
// Production: the public W2 path, e.g. https://<host>/agentforge-w2 (the
// browser follows this link, so it must be reachable from the browser).
$serviceUrl = (string) (getenv('AGENTFORGE_SERVICE_URL') ?: 'http://127.0.0.1:8787');

if ($pid === '' || $userId === '' || $username === '') {
    http_response_code(403);
    echo '<p>' . xlt('AgentForge requires an authenticated patient context.') . '</p>';
    exit;
}

// W3 H1: launcher tokens are Ed25519-signed with a key only this container
// holds (AGENTFORGE_LAUNCH_SIGNING_KEY), never with the shared demo secret.
// Missing or invalid: the launcher refuses, labeled; nothing else changes.
$envString = static function (string $name): string {
    $value = getenv($name);
    return is_string($value) ? trim($value) : '';
};
try {
    $signingKey = LaunchSigningKey::fromBase64Seed($envString('AGENTFORGE_LAUNCH_SIGNING_KEY'), $envString('AGENTFORGE_LAUNCH_VERIFY_KEY'));
} catch (\Throwable $error) {
    (new SystemLogger())->error('AgentForge launcher signing key is not configured', ['exception' => $error]);
    http_response_code(503);
    echo '<p>' . xlt('AgentForge launch is not configured on this OpenEMR server (launcher signing key missing or invalid).') . '</p>';
    exit;
}

$patientRow = sqlQuery('SELECT uuid FROM patient_data WHERE pid = ?', [$pid]);
$userRow = sqlQuery('SELECT uuid FROM users WHERE id = ?', [$userId]);
$patientRef = is_array($patientRow) && !empty($patientRow['uuid']) ? strtolower(UuidRegistry::uuidToString($patientRow['uuid'])) : '';
$clinicianRef = is_array($userRow) && !empty($userRow['uuid']) ? strtolower(UuidRegistry::uuidToString($userRow['uuid'])) : '';
if ($patientRef === '' || $clinicianRef === '') {
    http_response_code(404);
    echo '<p>' . xlt('The selected OpenEMR patient or the signed-in user has no usable UUID.') . '</p>';
    exit;
}

// The W2 service reads the chart as its own OAuth identity, so per-user
// authorization happens here, once: every ACO the REST routes it reads
// enforce, checked for the signed-in user (the ARO value is the username).
// Live tokens go only to designated synthetic patients
// (AGENTFORGE_LIVE_PATIENT_UUIDS); uploads also need the write allowlist.
$envList = static fn(string $name): array => AccessPolicy::parseAllowlist((string) (getenv($name) ?: ''));
$grant = LaunchTokenMinter::grant(
    static fn(string $section, string $value, string $returnValue): bool => AclMain::aclCheckCore($section, $value, $username, $returnValue),
    in_array($patientRef, $envList('AGENTFORGE_LIVE_PATIENT_UUIDS'), true),
    in_array($patientRef, $envList('AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS'), true),
);
if ($grant === LaunchGrant::None) {
    http_response_code(403);
    echo '<p>' . xlt('AgentForge requires read access to the selected patient chart (demographics, medical record, documents and encounters).') . '</p>';
    exit;
}
if ($grant === LaunchGrant::NotDesignated) {
    http_response_code(403);
    echo '<p>' . xlt('AgentForge is enabled only for designated synthetic patients.') . '</p>';
    exit;
}

$minter = new LaunchTokenMinter($signingKey);
$now = time();
$readToken = $minter->mint($patientRef, $clinicianRef, LaunchScope::ReadBriefing, $now);
$writeToken = $grant === LaunchGrant::ReadAndUpload ? $minter->mint($patientRef, $clinicianRef, LaunchScope::WriteSourceDocument, $now) : null;
$url = LaunchTokenMinter::launchUrl($serviceUrl, $readToken, $writeToken);
?>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title><?php echo xlt('AgentForge'); ?></title></head>
<body>
<main>
<h1><?php echo xlt('Prepare for visit'); ?></h1>
<p><?php echo xlt('The authenticated OpenEMR patient context was handed to the AgentForge service for under five minutes. This is a designated synthetic patient.'); ?></p>
<p><?php echo xlt('The link works once. To open AgentForge again, reload this page.'); ?></p>
<p><?php echo $writeToken === null ? xlt('Chart reads only: uploads need document write access and an allowlisted synthetic patient.') : xlt('Chart reads and synthetic document uploads for this patient.'); ?></p>
<a class="btn btn-primary" target="_blank" rel="noopener" href="<?php echo attr($url); ?>"><?php echo xlt('Open AgentForge briefing'); ?></a>
</main>
</body>
</html>

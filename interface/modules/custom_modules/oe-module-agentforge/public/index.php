<?php

/**
 * AgentForge launcher: hands the authenticated OpenEMR patient context to the
 * AgentForge service as short-lived signed context tokens.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Common\Acl\AclMain;

$session = SessionWrapperFactory::getInstance()->getWrapper();
$pid = (string)($session->get('pid') ?? '');
// AclMain::aclCheckCore() matches the gacl ARO value, which is the username
// (authUser), not the numeric authUserID.
$authUser = (string)($session->get('authUser') ?? '');
$authUserId = (string)($session->get('authUserID') ?? '');
$secret = (string)(getenv('AGENTFORGE_DEMO_SECRET') ?: '');
$serviceUrl = rtrim((string)(getenv('AGENTFORGE_SERVICE_URL') ?: 'http://127.0.0.1:8787'), '/');

if ($pid === '' || $authUser === '' || $authUserId === '' || $secret === '') {
    http_response_code(403);
    echo '<p>' . text(xlt('AgentForge requires an authenticated patient context and server configuration.')) . '</p>';
    exit;
}

if (!AclMain::aclCheckCore('patients', 'med', $authUser) || !AclMain::aclCheckCore('patients', 'docs', $authUser)) {
    http_response_code(403);
    echo '<p>' . text(xlt('AgentForge requires read access to the selected patient chart.')) . '</p>';
    exit;
}

$patientRow = sqlQuery('SELECT uuid FROM patient_data WHERE pid = ?', [$pid]);
$patientRef = !empty($patientRow['uuid']) ? UuidRegistry::uuidToString($patientRow['uuid']) : '';
if ($patientRef === '') {
    http_response_code(404);
    echo '<p>' . text(xlt('The selected OpenEMR patient has no usable UUID.')) . '</p>';
    exit;
}
// The write endpoint resolves the actor from clinician_uuid, so it must be
// users.uuid, not the numeric user id.
$userRow = sqlQuery('SELECT uuid FROM users WHERE id = ? AND active = 1', [$authUserId]);
$clinicianRef = !empty($userRow['uuid']) ? UuidRegistry::uuidToString($userRow['uuid']) : '';
if ($clinicianRef === '') {
    http_response_code(403);
    echo '<p>' . text(xlt('The signed-in OpenEMR user has no usable UUID.')) . '</p>';
    exit;
}
$signContext = static function (string $scope, string $acl) use ($patientRef, $clinicianRef, $secret): string {
    $payload = json_encode([
        'patient_uuid' => $patientRef,
        'clinician_uuid' => $clinicianRef,
        'scope' => $scope,
        'issuer' => 'openemr-module',
        'authn' => 'openemr-session',
        'role' => 'clinician',
        'acl' => $acl,
        'expires_at' => time() + 300,
    ], JSON_UNESCAPED_SLASHES);
    $encoded = rtrim(strtr(base64_encode($payload ?: '{}'), '+/', '-_'), '=');
    $signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $encoded, $secret, true)), '+/', '-_'), '=');
    return $encoded . '.' . $signature;
};
$url = $serviceUrl . '/?demo_token=' . rawurlencode($signContext('read-briefing', 'read'));
// A write-scoped token is minted only for users who may write patient documents.
if (AclMain::aclCheckCore('patients', 'docs', $authUser, ['write', 'addonly'])) {
    $url .= '&source_document_token=' . rawurlencode($signContext('write-source-document', 'write'));
}
?>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title><?php echo xlt('AgentForge'); ?></title></head>
<body>
<main>
<h1><?php echo xlt('Prepare for visit'); ?></h1>
<p><?php echo text(xlt('The authenticated OpenEMR patient context was handed to the AgentForge service for five minutes.')); ?></p>
<a class="btn btn-primary" target="_blank" rel="noopener" href="<?php echo attr($url); ?>"><?php echo xlt('Open AgentForge briefing'); ?></a>
</main>
</body>
</html>

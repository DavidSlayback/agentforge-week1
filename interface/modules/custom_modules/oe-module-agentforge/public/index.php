<?php

require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Common\Acl\AclMain;

$session = SessionWrapperFactory::getInstance()->getWrapper();
$pid = (string)($session->get('pid') ?? '');
$user = (string)($session->get('authUserID') ?? '');
$secret = (string)(getenv('AGENTFORGE_DEMO_SECRET') ?: '');
$serviceUrl = rtrim((string)(getenv('AGENTFORGE_SERVICE_URL') ?: 'http://127.0.0.1:8787'), '/');

if ($pid === '' || $user === '' || $secret === '') {
    http_response_code(403);
    echo '<p>' . text(xlt('AgentForge requires an authenticated patient context and server configuration.')) . '</p>';
    exit;
}

if (!AclMain::aclCheckCore('patients', 'med', $user) || !AclMain::aclCheckCore('patients', 'docs', $user)) {
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
$payload = json_encode([
    'patient_uuid' => $patientRef,
    'clinician_uuid' => $user,
    'scope' => 'read-briefing',
    'issuer' => 'openemr-module',
    'authn' => 'openemr-session',
    'role' => 'clinician',
    'acl' => 'read',
    'expires_at' => time() + 300,
], JSON_UNESCAPED_SLASHES);
$encoded = rtrim(strtr(base64_encode($payload ?: '{}'), '+/', '-_'), '=');
$signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $encoded, $secret, true)), '+/', '-_'), '=');
$token = $encoded . '.' . $signature;
$url = $serviceUrl . '/?demo_token=' . rawurlencode($token);
?>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title><?php echo xlt('AgentForge'); ?></title></head>
<body>
<main>
<h1><?php echo xlt('Prepare for visit'); ?></h1>
<p><?php echo text(xlt('The authenticated OpenEMR patient context was handed to the read-only AgentForge service for five minutes.')); ?></p>
<a class="btn btn-primary" target="_blank" rel="noopener" href="<?php echo attr($url); ?>"><?php echo xlt('Open AgentForge briefing'); ?></a>
</main>
</body>
</html>

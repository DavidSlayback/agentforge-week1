<?php

require_once dirname(__FILE__, 5) . '/globals.php';

use OpenEMR\Common\Session\SessionWrapperFactory;

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

// Synthetic demo mapping only. Real deployment must replace this with an
// authorized OpenEMR patient UUID from the audited adapter boundary.
$fixtureNumber = ((int)$pid % 6) + 1;
$patientRef = 'fixture-patient-' . str_pad((string)$fixtureNumber, 3, '0', STR_PAD_LEFT);
$payload = json_encode([
    'patient_uuid' => $patientRef,
    'clinician_uuid' => $user,
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
<p><?php echo text(xlt('The authenticated patient context was handed to the synthetic AgentForge service for five minutes.')); ?></p>
<a class="btn btn-primary" target="_blank" rel="noopener" href="<?php echo attr($url); ?>"><?php echo xlt('Open AgentForge briefing'); ?></a>
</main>
</body>
</html>

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueSignedContext, verifySignedContext } from '../../agentforge/src/accessContext.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installedPhp = process.env.AGENTFORGE_PHP || 'C:/Users/david/AppData/Local/Microsoft/WinGet/Packages/PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe/php.exe';

function php(args, input = '', env = {}) {
  return execFileSync(installedPhp, args, { cwd: root, input, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

test('PHP and Node signed-context implementations agree on synthetic tokens', () => {
  if (!fs.existsSync(installedPhp)) return;
  const secret = 'synthetic-parity-secret';
  const now = 1_800_000_000;
  const nodeToken = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', issuer: 'openemr-module', authn: 'openemr-session', secret, now: () => now });
  const phpChecksNode = php(['-r', String.raw`
$parts = explode('.', getenv('TOKEN'));
$encoded = $parts[0] ?? '';
$provided = $parts[1] ?? '';
$expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $encoded, getenv('SECRET'), true)), '+/', '-_'), '=');
$padding = strlen($encoded) % 4;
$payload = json_decode(base64_decode(strtr($encoded . ($padding ? str_repeat('=', 4 - $padding) : ''), '-_', '+/')), true);
if (!hash_equals($expected, $provided) || ($payload['patient_uuid'] ?? '') !== 'fixture-patient-001' || ($payload['issuer'] ?? '') !== 'openemr-module') exit(1);
echo 'ok';
`], '', { TOKEN: nodeToken, SECRET: secret });
  assert.equal(phpChecksNode, 'ok');

  const phpToken = php(['-r', String.raw`
$payload = json_encode([
  'patient_uuid' => 'fixture-patient-002', 'clinician_uuid' => 'fixture-physician-001',
  'scope' => 'read-briefing', 'issuer' => 'openemr-module', 'authn' => 'openemr-session',
  'role' => 'clinician', 'acl' => 'read', 'expires_at' => (int)getenv('NOW') + 300,
], JSON_UNESCAPED_SLASHES);
$encoded = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
$signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $encoded, getenv('SECRET'), true)), '+/', '-_'), '=');
echo $encoded . '.' . $signature;
`], '', { SECRET: secret, NOW: String(now) });
  assert.deepEqual(verifySignedContext(phpToken, secret, () => now), {
    patient_uuid: 'fixture-patient-002',
    clinician_uuid: 'fixture-physician-001',
    scope: 'read-briefing',
    issuer: 'openemr-module',
    authn: 'openemr-session',
    role: 'clinician',
    acl: 'read',
    expires_at: now + 300,
  });
});

test('AgentForge PHP launcher has no syntax errors', () => {
  if (!fs.existsSync(installedPhp)) return;
  const launcher = path.join(root, 'interface/modules/custom_modules/oe-module-agentforge/public/index.php');
  assert.match(php(['-l', launcher]), /No syntax errors detected/);
});

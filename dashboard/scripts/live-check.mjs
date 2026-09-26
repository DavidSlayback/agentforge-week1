// Unauthenticated checks against a running dashboard (MIGRATION-REACT.md §6.5).
// Needs no credentials and prints no secrets.
//
//   node dashboard/scripts/live-check.mjs <base-url> <expected-sha|any> [--out <file.json>]
//
// Exit code 1 if any check fails. The result names the URL and SHA it ran
// against; evidence is valid only for that SHA (AGENTS.md).
import { writeFileSync } from 'node:fs';

const EXPECTED_SCOPE =
  'openid api:oemr api:fhir user/Patient.rs user/CareTeam.rs user/Practitioner.rs user/Organization.rs user/patient.rs user/allergy.rs user/medical_problem.rs user/medication.rs user/prescription.rs user/encounter.rs user/vital.rs user/list.r';

const [base, sha, ...rest] = process.argv.slice(2);
if (!base || !sha) {
  console.error('usage: live-check.mjs <base-url> <expected-sha|any> [--out file.json]');
  process.exit(2);
}
const outIdx = rest.indexOf('--out');
const out = outIdx >= 0 ? rest[outIdx + 1] : undefined;
const root = base.replace(/\/+$/, '');
const checks = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, pass: true, detail });
  } catch (err) {
    checks.push({ name, pass: false, detail: err instanceof Error ? err.message : String(err) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const get = (path, init = {}) => fetch(`${root}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...init });

await check('health reports the expected SHA', async () => {
  const res = await get('/dashboard/health');
  const text = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  const m = /"git_sha":"([0-9a-f]{40}|unversioned)"/.exec(text);
  assert(m, 'no git_sha in compact JSON');
  if (sha !== 'any') assert(m[1] === sha, `git_sha ${m[1]} != ${sha}`);
  return `git_sha=${m[1]}`;
});

await check('SPA served with CSP', async () => {
  const res = await get('/dashboard/');
  const csp = res.headers.get('content-security-policy') ?? '';
  const text = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  assert(text.includes('<div id="root">'), 'not the SPA shell');
  assert(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), 'CSP missing');
  assert(res.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy missing');
  return 'CSP + no-referrer present';
});

await check('session without a cookie is unauthenticated', async () => {
  const res = await get('/dashboard/bff/session');
  const body = await res.json();
  assert(res.status === 200 && body.authenticated === false, `status ${res.status}`);
  assert(res.headers.get('cache-control') === 'no-store', 'no-store missing');
  return 'authenticated=false, no-store';
});

await check('card route without a session is 401', async () => {
  const res = await get('/dashboard/bff/patients/00000000-0000-4000-8000-000000000000/header');
  assert(res.status === 401, `status ${res.status}`);
  return '401';
});

await check('query strings on /bff are refused', async () => {
  const res = await get('/dashboard/bff/session?x=1');
  assert(res.status === 400, `status ${res.status}`);
  return '400';
});

await check('login redirects to authorize with S256, state, nonce and the exact scopes', async () => {
  const res = await get('/dashboard/login');
  assert(res.status === 302, `status ${res.status}`);
  const loc = new URL(res.headers.get('location') ?? '');
  const q = loc.searchParams;
  assert(loc.pathname.endsWith('/oauth2/default/authorize'), `authorize path ${loc.pathname}`);
  assert(q.get('code_challenge_method') === 'S256', 'no S256');
  assert((q.get('state') ?? '').length >= 32 && (q.get('nonce') ?? '').length >= 32, 'state/nonce missing');
  assert(q.get('scope') === EXPECTED_SCOPE, 'scope differs');
  assert(!(q.get('scope') ?? '').includes('offline_access'), 'offline_access requested');
  assert(!q.has('client_secret'), 'client secret in URL');
  assert(q.get('redirect_uri') === `${new URL(root).origin}/dashboard/callback`, `redirect_uri ${q.get('redirect_uri')}`);
  const cookie = res.headers.get('set-cookie') ?? '';
  assert(/dashboard_tx=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\/dashboard/.test(cookie), 'tx cookie flags');
  if (root.startsWith('https://')) assert(/Secure/.test(cookie), 'tx cookie not Secure over https');
  return `authorize at ${loc.origin}${loc.pathname}; cookie flags ok`;
});

const result = { url: root, expectedSha: sha, checkedAt: new Date().toISOString(), pass: checks.every((c) => c.pass), checks };
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
console.log(result.pass ? 'live-check: PASS' : 'live-check: FAIL');
if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.exit(result.pass ? 0 : 1);

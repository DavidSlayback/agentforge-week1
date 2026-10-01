import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * TEST-ONLY stand-in for the OpenEMR launcher's Ed25519 signing key
 * (oe-module-agentforge LaunchTokenMinter). The keypair is the synthetic one
 * in fixtures/hmac-vectors.json (`launch_token_vectors`), never deployed. In
 * production only the openemr container holds the private key; nothing under
 * agentforge/src can mint an `openemr-module` token.
 */
const vectors = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../fixtures/hmac-vectors.json', import.meta.url)), 'utf8')).launch_token_vectors;
export const LAUNCH_VECTORS = vectors;
export const TEST_LAUNCH_SIGNING_KEY = vectors.signing_key_base64;
export const TEST_LAUNCH_VERIFY_KEY = vectors.verify_key_base64;

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(TEST_LAUNCH_SIGNING_KEY, 'base64')]), format: 'der', type: 'pkcs8' });

/** A launcher token exactly as LaunchTokenMinter::mint builds it (same key order, so the bytes match PHP). `issuer` is overridable only so tests can prove other issuers are refused under this key. */
export function issueTestLaunchToken({ patient_uuid, clinician_uuid, scope = 'read-briefing', ttlSeconds = 280, now = Math.floor(Date.now() / 1000), authn = 'openemr-session', issuer = 'openemr-module' }) {
  const payload = { patient_uuid, clinician_uuid, scope, issuer, authn, role: 'clinician', acl: scope === 'read-briefing' ? 'read' : 'write', expires_at: now + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${crypto.sign(null, Buffer.from(encoded), privateKey).toString('base64url')}`;
}

import crypto from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const MAX_CONTEXT_TTL_SECONDS = 300;
export const CONTEXT_SCOPES = new Set(['read-briefing', 'write-source-document', 'write-clinical-action']);
/**
 * W3 H1: the OpenEMR launcher's issuer. Its tokens are Ed25519-signed by the
 * openemr container (AGENTFORGE_LAUNCH_SIGNING_KEY, which nothing else holds)
 * and verified here with AGENTFORGE_LAUNCH_VERIFY_KEY. Every other issuer is
 * HMAC-signed with AGENTFORGE_DEMO_SECRET. Each issuer accepts exactly one
 * scheme, so a holder of the demo secret (frozen W1, this service) can never
 * produce an openemr-module token a verifier accepts.
 */
export const LAUNCH_ISSUER = 'openemr-module';
const HMAC_SIGNATURE_CHARS = 43;
const ED25519_SIGNATURE_CHARS = 86;
const codedError = (code) => Object.assign(new Error(code), { code });

/** `AGENTFORGE_LAUNCH_VERIFY_KEY`: strict base64 of a 32-byte Ed25519 public key. Empty is null; anything else malformed throws (startup fails). */
export function parseLaunchVerifyKey(raw) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!text) return null;
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== text) throw codedError('AGENTFORGE_LAUNCH_VERIFY_KEY_INVALID');
  try {
    return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
  } catch {
    throw codedError('AGENTFORGE_LAUNCH_VERIFY_KEY_INVALID');
  }
}

/** True when `token` carries an Ed25519 (launcher-length) signature; says nothing about validity. */
export function isLaunchSignedToken(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  return parts.length === 2 && parts[1].length === ED25519_SIGNATURE_CHARS;
}
// Provenance stays process-local so callers cannot forge a deployed context
// by copying the signed payload fields.
const verifiedContexts = new WeakSet();
// The signed token behind each verified context, so a launcher-issued token
// can be forwarded unchanged to the OpenEMR module, which re-verifies it.
const signedTokens = new WeakMap();

/** True only for a context object `verifySignedContext` produced in this process (not a copy). */
export function isVerifiedContext(verifiedContext) {
  return Boolean(verifiedContext && typeof verifiedContext === 'object' && verifiedContexts.has(verifiedContext));
}

/** The exact signed token a verified context came from, or null. */
export function signedTokenFor(verifiedContext) {
  return (verifiedContext && typeof verifiedContext === 'object' && signedTokens.get(verifiedContext)) || null;
}

/** Issue a short-lived HMAC context token. Never an `openemr-module` token: only the OpenEMR launcher can sign those (LAUNCH_ISSUER_RESERVED). */
export function issueSignedContext({ patient_uuid, clinician_uuid, scope = 'read-briefing', ttlSeconds = 300, issuer = 'synthetic-demo', authn = 'synthetic', role = 'clinician', acl = 'read', audience = null, secret, now = () => Math.floor(Date.now() / 1000) }) {
  if (!secret || !patient_uuid || !clinician_uuid || !CONTEXT_SCOPES.has(scope) || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_CONTEXT_TTL_SECONDS || !issuer || !authn || role !== 'clinician' || !['read', 'write'].includes(acl) || (scope === 'read-briefing' && acl !== 'read') || (['write-source-document', 'write-clinical-action'].includes(scope) && acl !== 'write')) throw new Error('SIGNED_CONTEXT_CONFIG_REQUIRED');
  if (issuer === LAUNCH_ISSUER) throw codedError('LAUNCH_ISSUER_RESERVED');
  if (audience !== null && (typeof audience !== 'string' || !audience)) throw new Error('SIGNED_CONTEXT_CONFIG_REQUIRED');
  // `aud` (optional) names the one service the token is for. The OpenEMR
  // module's verifier ignores fields it does not know.
  const payload = { patient_uuid, clinician_uuid, scope, issuer, authn, role, acl, ...(audience ? { aud: audience } : {}), expires_at: now() + ttlSeconds };
  const encoded = encode(payload);
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/**
 * Verify a context token. `secret` (AGENTFORGE_DEMO_SECRET) checks HMAC
 * tokens; `launchVerifyKey` (from `parseLaunchVerifyKey`) checks launcher
 * tokens. Without a launch key every launcher token is refused.
 */
export function verifySignedContext(token, secret, now = () => Math.floor(Date.now() / 1000), { launchVerifyKey = null } = {}) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;
  let launchSigned;
  if (signature.length === ED25519_SIGNATURE_CHARS) {
    if (!launchVerifyKey) return null;
    const bytes = Buffer.from(signature, 'base64url');
    // Canonical encoding only: two strings for one signature would defeat the single-use launch exchange.
    if (bytes.length !== 64 || bytes.toString('base64url') !== signature) return null;
    try { if (!crypto.verify(null, Buffer.from(encoded), launchVerifyKey, bytes)) return null; } catch { return null; }
    launchSigned = true;
  } else if (signature.length === HMAC_SIGNATURE_CHARS) {
    if (!secret) return null;
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    launchSigned = false;
  } else {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    // Each issuer has exactly one signature scheme (see LAUNCH_ISSUER).
    if ((payload?.issuer === LAUNCH_ISSUER) !== launchSigned) return null;
    if (typeof payload.patient_uuid !== 'string' || !payload.patient_uuid || typeof payload.clinician_uuid !== 'string' || !payload.clinician_uuid || !CONTEXT_SCOPES.has(payload.scope) || typeof payload.issuer !== 'string' || !payload.issuer || typeof payload.authn !== 'string' || !payload.authn || payload.role !== 'clinician' || !['read', 'write'].includes(payload.acl) || (payload.scope === 'read-briefing' && payload.acl !== 'read') || (['write-source-document', 'write-clinical-action'].includes(payload.scope) && payload.acl !== 'write') || !Number.isFinite(payload.expires_at) || payload.expires_at <= now() || payload.expires_at > now() + MAX_CONTEXT_TTL_SECONDS) return null;
    const context = { patient_uuid: payload.patient_uuid, clinician_uuid: payload.clinician_uuid, scope: payload.scope, issuer: payload.issuer, authn: payload.authn, role: payload.role, acl: payload.acl, ...(typeof payload.aud === 'string' && payload.aud ? { audience: payload.aud } : {}), expires_at: payload.expires_at };
    verifiedContexts.add(context);
    signedTokens.set(context, token);
    return Object.freeze(context);
  } catch {
    return null;
  }
}

/** Authorize one read scope from a server-verified context only. */
export function authorizeRequest({ request = {}, verifiedContext = null, requiredIssuer = null, requiredAuthn = null, requiredRole = null, requiredScope = 'read-briefing', requiredAcl = 'read', now = () => Math.floor(Date.now() / 1000) }) {
  if (!verifiedContext || typeof request.patient_uuid !== 'string' || !request.patient_uuid || typeof request.clinician_uuid !== 'string' || !request.clinician_uuid) {
    return { status: 'blocked', reason: 'server_context_missing_or_invalid' };
  }
  if (verifiedContext && !verifiedContexts.has(verifiedContext)) return { status: 'blocked', reason: 'server_context_missing_or_invalid' };
  if (verifiedContext && (typeof verifiedContext.patient_uuid !== 'string' || typeof verifiedContext.clinician_uuid !== 'string' || !CONTEXT_SCOPES.has(verifiedContext.scope) || !['read', 'write'].includes(verifiedContext.acl) || !Number.isFinite(verifiedContext.expires_at))) return { status: 'blocked', reason: 'server_context_missing_or_invalid' };
  if (verifiedContext && verifiedContext.expires_at <= now()) return { status: 'blocked', reason: 'server_context_expired' };
  if (verifiedContext && requiredIssuer && verifiedContext.issuer !== requiredIssuer) return { status: 'blocked', reason: 'server_context_issuer_invalid' };
  if (verifiedContext && requiredAuthn && verifiedContext.authn !== requiredAuthn) return { status: 'blocked', reason: 'server_context_authn_invalid' };
  if (verifiedContext && requiredRole && verifiedContext.role !== requiredRole) return { status: 'blocked', reason: 'server_context_role_invalid' };
  if (verifiedContext && (verifiedContext.patient_uuid !== request.patient_uuid || verifiedContext.clinician_uuid !== request.clinician_uuid || verifiedContext.scope !== requiredScope || verifiedContext.acl !== requiredAcl)) {
    return { status: 'blocked', reason: 'server_context_mismatch' };
  }
  return { status: 'authorized', patient_uuid: verifiedContext.patient_uuid, clinician_uuid: verifiedContext.clinician_uuid, scope: verifiedContext.scope, source: 'signed-user-context' };
}

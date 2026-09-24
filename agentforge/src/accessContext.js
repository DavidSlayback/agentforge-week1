import crypto from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const MAX_CONTEXT_TTL_SECONDS = 300;
export const CONTEXT_SCOPES = new Set(['read-briefing', 'write-source-document', 'write-clinical-action']);
// Provenance stays process-local so callers cannot forge a deployed context
// by copying the signed payload fields.
const verifiedContexts = new WeakSet();
// The signed token behind each verified context, so a launcher-issued token
// can be forwarded unchanged to the OpenEMR module, which re-verifies it.
const signedTokens = new WeakMap();

/** The exact signed token a verified context came from, or null. */
export function signedTokenFor(verifiedContext) {
  return (verifiedContext && typeof verifiedContext === 'object' && signedTokens.get(verifiedContext)) || null;
}

/** Issue a short-lived synthetic session assertion for a read-only patient scope. */
export function issueSignedContext({ patient_uuid, clinician_uuid, scope = 'read-briefing', ttlSeconds = 300, issuer = 'synthetic-demo', authn = 'synthetic', role = 'clinician', acl = 'read', secret, now = () => Math.floor(Date.now() / 1000) }) {
  if (!secret || !patient_uuid || !clinician_uuid || !CONTEXT_SCOPES.has(scope) || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_CONTEXT_TTL_SECONDS || !issuer || !authn || role !== 'clinician' || !['read', 'write'].includes(acl) || (scope === 'read-briefing' && acl !== 'read') || (['write-source-document', 'write-clinical-action'].includes(scope) && acl !== 'write')) throw new Error('SIGNED_CONTEXT_CONFIG_REQUIRED');
  const payload = { patient_uuid, clinician_uuid, scope, issuer, authn, role, acl, expires_at: now() + ttlSeconds };
  const encoded = encode(payload);
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySignedContext(token, secret, now = () => Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof payload.patient_uuid !== 'string' || !payload.patient_uuid || typeof payload.clinician_uuid !== 'string' || !payload.clinician_uuid || !CONTEXT_SCOPES.has(payload.scope) || typeof payload.issuer !== 'string' || !payload.issuer || typeof payload.authn !== 'string' || !payload.authn || payload.role !== 'clinician' || !['read', 'write'].includes(payload.acl) || (payload.scope === 'read-briefing' && payload.acl !== 'read') || (['write-source-document', 'write-clinical-action'].includes(payload.scope) && payload.acl !== 'write') || !Number.isFinite(payload.expires_at) || payload.expires_at <= now() || payload.expires_at > now() + MAX_CONTEXT_TTL_SECONDS) return null;
    const context = { patient_uuid: payload.patient_uuid, clinician_uuid: payload.clinician_uuid, scope: payload.scope, issuer: payload.issuer, authn: payload.authn, role: payload.role, acl: payload.acl, expires_at: payload.expires_at };
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

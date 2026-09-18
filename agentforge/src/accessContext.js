import crypto from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function issueSignedContext({ patient_uuid, clinician_uuid, scope = 'read-briefing', ttlSeconds = 300, secret, now = () => Math.floor(Date.now() / 1000) }) {
  if (!secret || !patient_uuid || !clinician_uuid) throw new Error('SIGNED_CONTEXT_CONFIG_REQUIRED');
  const payload = { patient_uuid, clinician_uuid, scope, expires_at: now() + ttlSeconds };
  const encoded = encode(payload);
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySignedContext(token, secret, now = () => Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.patient_uuid || !payload.clinician_uuid || payload.scope !== 'read-briefing' || payload.expires_at <= now()) return null;
    return { patient_uuid: payload.patient_uuid, clinician_uuid: payload.clinician_uuid, scope: payload.scope, expires_at: payload.expires_at };
  } catch {
    return null;
  }
}

export function authorizeRequest({ request, verifiedContext = null, requireSignedContext = false }) {
  if (request.authorization?.status !== 'authorized' || request.authorization?.scope !== 'read-briefing') {
    return { status: 'blocked', reason: 'identity_or_authorization_not_established' };
  }
  if (requireSignedContext && !verifiedContext) return { status: 'blocked', reason: 'server_context_missing_or_invalid' };
  if (verifiedContext && (verifiedContext.patient_uuid !== request.patient_uuid || verifiedContext.clinician_uuid !== request.clinician_uuid || verifiedContext.scope !== 'read-briefing')) {
    return { status: 'blocked', reason: 'server_context_mismatch' };
  }
  const context = verifiedContext || { patient_uuid: request.patient_uuid, clinician_uuid: request.clinician_uuid, scope: request.authorization.scope, source: 'legacy-contract' };
  return { status: 'authorized', patient_uuid: context.patient_uuid, clinician_uuid: context.clinician_uuid, scope: context.scope, source: context.source || 'signed-synthetic-session' };
}

import crypto from 'node:crypto';

/**
 * Client for the oe-module-agentforge write endpoint
 * (interface/modules/custom_modules/oe-module-agentforge/public/api.php).
 *
 * Every request is signed with HMAC scheme v1. The canonical string must stay
 * byte-identical to the PHP CanonicalRequest; both sides are pinned by
 * test/fixtures/hmac-vectors.json. Errors carry codes and HTTP statuses only,
 * never request or response bodies, so they cannot leak document content.
 */
export const HMAC_SCHEME = 'AGENTFORGE-HMAC-SHA256-V1';
export const HMAC_KEY_ID = 'v1';
export const HMAC_KEY_LABEL = 'agentforge/openemr-write/v1';
export const MODULE_OBSERVATION_READ_PATH = 'openemr-fhir-service-in-process';
export const MODULE_LAB_HISTORY_SCOPE = 'patient_lab_history';
const QUERY_KEY = /^[a-z_]{1,40}$/;
const QUERY_VALUE = /^[A-Za-z0-9._-]{1,128}$/;
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

export const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Request-signing key, separated from the raw secret that signs context tokens. */
export function deriveWriteKey(secret) {
  if (typeof secret !== 'string' || !secret) throw new OpenEMRModuleError('OPENEMR_MODULE_NOT_CONFIGURED', { httpStatus: 503 });
  return crypto.createHmac('sha256', secret).update(HMAC_KEY_LABEL).digest();
}

/** Sorted key=value pairs; the restricted alphabet means no percent-encoding can drift between languages. */
export function canonicalQuery(query) {
  const keys = Object.keys(query).sort();
  if (!keys.length) return '-';
  return keys.map((key) => {
    const value = query[key];
    if (!QUERY_KEY.test(key) || typeof value !== 'string' || !QUERY_VALUE.test(value)) throw new OpenEMRModuleError('OPENEMR_MODULE_QUERY_INVALID', { httpStatus: 500 });
    return `${key}=${value}`;
  }).join('&');
}

export function canonicalString({ method, route, site, patientUuid = '', contentSha256 = '', bodySha256, timestamp, nonce, query, contextTokenSha256 = '' }) {
  return [HMAC_SCHEME, method, route, site, patientUuid || '-', contentSha256 || '-', bodySha256, String(timestamp), nonce, canonicalQuery(query), contextTokenSha256 || '-'].join('\n');
}

export function signCanonical(secret, canonical) {
  return crypto.createHmac('sha256', deriveWriteKey(secret)).update(canonical).digest('base64url');
}

export function verifyCanonicalSignature(secret, canonical, signature) {
  const expected = Buffer.from(signCanonical(secret, canonical));
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Build the signed headers for one request. `body` is the exact JSON string sent ('' for GET). */
export function signRequest({ secret, method, query, body = '', contextToken = null, timestamp, nonce }) {
  const parsed = body ? JSON.parse(body) : {};
  const bodySha256 = body ? sha256Hex(body) : EMPTY_SHA256;
  const patientUuid = method === 'POST' ? (typeof parsed.patient_uuid === 'string' ? parsed.patient_uuid : '') : (query.patient_uuid || '');
  const contentSha256 = method === 'POST' && typeof parsed.content_sha256 === 'string' ? parsed.content_sha256 : '';
  const canonical = canonicalString({ method, route: query.route, site: query.site || 'default', patientUuid, contentSha256, bodySha256, timestamp, nonce, query, contextTokenSha256: contextToken ? sha256Hex(contextToken) : '' });
  const headers = {
    'x-agentforge-key-id': HMAC_KEY_ID,
    'x-agentforge-timestamp': String(timestamp),
    'x-agentforge-nonce': nonce,
    'x-agentforge-content-sha256': bodySha256,
    'x-agentforge-signature': signCanonical(secret, canonical),
    ...(contextToken ? { 'x-agentforge-context-token': contextToken } : {}),
  };
  return { headers, canonical };
}

/** Typed module failure. `httpStatus` is what the AgentForge API should answer with. */
export class OpenEMRModuleError extends Error {
  constructor(code, { status = null, httpStatus = 502, issues = [], correlationId = null } = {}) {
    super(code);
    this.name = 'OpenEMRModuleError';
    this.code = code;
    this.status = status;
    this.httpStatus = httpStatus;
    this.issues = issues;
    this.correlationId = correlationId;
  }
}

// Module statuses that describe the caller's request pass through; auth,
// replay and server failures are this service's fault and surface as 502.
const PASS_THROUGH_STATUSES = new Set([400, 403, 404, 413, 503]);

export class OpenEMRModuleClient {
  constructor({ baseUrl, secret, site = 'default', timeoutMs = 15000, fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), nonce = () => crypto.randomBytes(16).toString('hex'), correlationId = () => `af-${crypto.randomUUID()}` }) {
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new OpenEMRModuleError('OPENEMR_MODULE_NOT_CONFIGURED', { httpStatus: 503 });
    deriveWriteKey(secret);
    this.baseUrl = baseUrl;
    this.secret = secret;
    this.site = site;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.nonce = nonce;
    this.correlationId = correlationId;
  }

  async request({ method, route, query = {}, body = null, contextToken = null }) {
    const fullQuery = { route, site: this.site, ...query };
    const bodyText = body === null ? '' : JSON.stringify(body);
    const { headers } = signRequest({ secret: this.secret, method, query: fullQuery, body: bodyText, contextToken, timestamp: this.now(), nonce: this.nonce() });
    const correlationId = this.correlationId();
    const url = new URL(this.baseUrl);
    for (const [key, value] of Object.entries(fullQuery)) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url.toString(), { method, headers: { ...headers, accept: 'application/json', 'x-correlation-id': correlationId, ...(bodyText ? { 'content-type': 'application/json' } : {}) }, ...(bodyText ? { body: bodyText } : {}), signal: controller.signal });
    } catch (error) {
      throw new OpenEMRModuleError(error?.name === 'AbortError' ? 'OPENEMR_MODULE_TIMEOUT' : 'OPENEMR_MODULE_UNREACHABLE', { httpStatus: error?.name === 'AbortError' ? 504 : 502, correlationId });
    } finally {
      clearTimeout(timer);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID', { status: response.status, correlationId }); }
    if (!response.ok) {
      const moduleCode = typeof payload?.error === 'string' && /^[a-z_]{1,40}$/.test(payload.error) ? payload.error.toUpperCase() : `HTTP_${response.status}`;
      const issues = Array.isArray(payload?.issues) ? payload.issues.filter((issue) => typeof issue === 'string' && /^[A-Za-z0-9_.[\]]{1,80}$/.test(issue)) : [];
      throw new OpenEMRModuleError(`OPENEMR_MODULE_${moduleCode}`, { status: response.status, httpStatus: PASS_THROUGH_STATUSES.has(response.status) ? response.status : 502, issues, correlationId });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID', { status: response.status, correlationId });
    return payload;
  }

  health() { return this.request({ method: 'GET', route: 'health' }); }

  /** POST route=documents. `content` is a Buffer; `sourceDocumentId` only for derived_facts. */
  async storeDocument({ patientUuid, contextToken, documentType, filename, mimeType, content, sourceDocumentId = null }) {
    const body = { patient_uuid: patientUuid, document_type: documentType, filename, mime_type: mimeType, content_sha256: sha256Hex(content), content_base64: content.toString('base64'), ...(sourceDocumentId === null ? {} : { source_document_id: sourceDocumentId }) };
    const result = await this.request({ method: 'POST', route: 'documents', body, contextToken });
    requireIntegerId(result.document_id);
    return result;
  }

  /** GET route=documents: bytes decrypted by OpenEMR; the sha256 is re-checked here. */
  async getDocument({ patientUuid, contextToken, documentId }) {
    const result = await this.request({ method: 'GET', route: 'documents', query: { patient_uuid: patientUuid, document_id: String(documentId) }, contextToken });
    const content = Buffer.from(String(result.content_base64 || ''), 'base64');
    if (sha256Hex(content) !== result.content_sha256) throw new OpenEMRModuleError('OPENEMR_MODULE_CONTENT_HASH_MISMATCH');
    return { ...result, content };
  }

  async storeLabResults({ patientUuid, contextToken, sourceDocumentId, sourceSha256, results }) {
    const result = await this.request({ method: 'POST', route: 'lab-results', body: { patient_uuid: patientUuid, source_document_id: sourceDocumentId, source_sha256: sourceSha256, results }, contextToken });
    requireIntegerId(result.procedure_order_id);
    if (!Array.isArray(result.observation_ids)) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID');
    return result;
  }

  async getLabObservations({ patientUuid, contextToken, sourceDocumentId }) {
    const result = await this.request({ method: 'GET', route: 'lab-observations', query: { patient_uuid: patientUuid, source_document_id: String(sourceDocumentId) }, contextToken });
    if (result.resourceType !== 'Bundle' || result.read_path !== MODULE_OBSERVATION_READ_PATH || !Array.isArray(result.entry)) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID');
    return result;
  }

  /**
   * GET route=lab-observations with no source_document_id: the patient's
   * module-written lab Observations, each linked to its source document id.
   */
  async getLabObservationHistory({ patientUuid, contextToken }) {
    const result = await this.request({ method: 'GET', route: 'lab-observations', query: { patient_uuid: patientUuid }, contextToken });
    if (result.resourceType !== 'Bundle' || result.read_path !== MODULE_OBSERVATION_READ_PATH || result.scope !== MODULE_LAB_HISTORY_SCOPE || !Array.isArray(result.entry) || !Array.isArray(result.missing_observation_ids)) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID');
    for (const entry of result.entry) {
      if (!entry || typeof entry.resource !== 'object' || entry.resource === null || !Number.isInteger(entry.source_document_id) || entry.source_document_id <= 0) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID');
    }
    return result;
  }

  /** Only for items a clinician has confirmed (A3); drafts never reach OpenEMR. */
  storeClinicalListItems({ patientUuid, contextToken, sourceDocumentId, confirmationEventId, items }) {
    return this.request({ method: 'POST', route: 'clinical-list-items', body: { patient_uuid: patientUuid, source_document_id: sourceDocumentId, confirmation_event_id: confirmationEventId, items }, contextToken });
  }
}

function requireIntegerId(value) {
  if (!Number.isInteger(value) || value <= 0) throw new OpenEMRModuleError('OPENEMR_MODULE_RESPONSE_INVALID');
}

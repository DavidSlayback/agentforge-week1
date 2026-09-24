import http from 'node:http';
import crypto from 'node:crypto';
import { canonicalString, sha256Hex, verifyCanonicalSignature } from '../src/openemrModuleClient.js';
import { verifySignedContext } from '../src/accessContext.js';

/**
 * TEST-ONLY fake of the oe-module-agentforge HTTP contract (public/api.php).
 * It is not OpenEMR: it keeps rows in memory so the service's HTTP path can
 * be exercised without PHP. It enforces the same HMAC, nonce, context-token,
 * allowlist and idempotency rules, and counts the rows it "writes" so tests
 * can assert that a re-upload adds zero rows.
 */
export async function startFakeOpenEMRModule({ secret, allowlist = [] }) {
  const nonces = new Set();
  const ledger = new Map();
  const documents = new Map();
  const labBySource = new Map();
  const counts = { documents: 0, procedure_orders: 0, procedure_results: 0, requests: 0, rejected: 0 };
  let nextDocumentId = 57;
  let nextOrderId = 9;
  let nextResultId = 21;

  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const idempotent = (key, write) => {
    if (ledger.has(key)) return [200, { status: 'duplicate', payload_differs: false, ...ledger.get(key) }];
    const response = { ...write(), idempotency_key: key };
    ledger.set(key, response);
    return [201, { status: 'created', payload_differs: false, ...response }];
  };

  const server = http.createServer(async (req, res) => {
    counts.requests += 1;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://fake-module');
    if (url.pathname === '/__counts') return reply(res, 200, counts);
    const query = Object.fromEntries(url.searchParams.entries());
    const body = rawBody ? JSON.parse(rawBody) : {};
    const header = (name) => req.headers[name] || '';
    const contextToken = header('x-agentforge-context-token');
    const canonical = canonicalString({
      method: req.method, route: query.route, site: query.site, patientUuid: req.method === 'POST' ? body.patient_uuid : query.patient_uuid,
      contentSha256: req.method === 'POST' ? body.content_sha256 : '', bodySha256: header('x-agentforge-content-sha256'), timestamp: header('x-agentforge-timestamp'),
      nonce: header('x-agentforge-nonce'), query, contextTokenSha256: contextToken ? sha256Hex(contextToken) : '',
    });
    if (header('x-agentforge-key-id') !== 'v1' || sha256Hex(rawBody) !== header('x-agentforge-content-sha256') || !verifyCanonicalSignature(secret, canonical, header('x-agentforge-signature'))) { counts.rejected += 1; return reply(res, 401, { error: 'signature_invalid' }); }
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(header('x-agentforge-timestamp'))) > 300) return reply(res, 401, { error: 'timestamp_skew' });
    if (nonces.has(header('x-agentforge-nonce'))) return reply(res, 409, { error: 'nonce_replayed' });
    nonces.add(header('x-agentforge-nonce'));
    if (query.route === 'health') return reply(res, 200, { status: 'ok', persistence_boundary: 'openemr-module' });
    const claims = verifySignedContext(contextToken, secret);
    const patientUuid = req.method === 'POST' ? body.patient_uuid : query.patient_uuid;
    if (!claims) return reply(res, 401, { error: 'context_invalid' });
    if (claims.patient_uuid !== patientUuid) return reply(res, 403, { error: 'patient_scope_mismatch' });
    if (claims.issuer === 'synthetic-demo' && !allowlist.includes(patientUuid)) return reply(res, 403, { error: 'demo_patient_not_allowed' });
    if (req.method === 'POST' && claims.scope !== 'write-source-document') return reply(res, 403, { error: 'acl_denied' });

    if (req.method === 'POST' && query.route === 'documents') {
      const content = Buffer.from(body.content_base64, 'base64');
      if (sha256Hex(content) !== body.content_sha256) return reply(res, 400, { error: 'invalid_request', issues: ['content_sha256_mismatch'] });
      if (body.mime_type === 'application/pdf' && content.subarray(0, 5).toString() !== '%PDF-') return reply(res, 400, { error: 'invalid_request', issues: ['content_not_pdf'] });
      const key = body.document_type === 'derived_facts' ? `derived:v1:${patientUuid}:${body.source_document_id}` : `doc:v1:${patientUuid}:${body.document_type}:${body.content_sha256}`;
      const [status, response] = idempotent(key, () => {
        const id = nextDocumentId++;
        counts.documents += 1;
        documents.set(id, { patientUuid, content, documentType: body.document_type, filename: body.filename, mimeType: body.mime_type, sourceDocumentId: body.source_document_id ?? null });
        return { document_id: id, document_uuid: crypto.randomUUID(), document_type: body.document_type, category: body.document_type === 'lab_pdf' ? 'Lab Report' : 'Medical Record', content_sha256: body.content_sha256, size_bytes: content.length, mime_type: body.mime_type, source_document_id: body.source_document_id ?? null, persistence_boundary: 'openemr-module' };
      });
      return reply(res, status, response);
    }
    if (req.method === 'GET' && query.route === 'documents') {
      const document = documents.get(Number(query.document_id));
      if (!document || document.patientUuid !== patientUuid) return reply(res, 404, { error: 'document_not_found' });
      return reply(res, 200, { document_id: Number(query.document_id), document_type: document.documentType, filename: document.filename, mime_type: document.mimeType, size_bytes: document.content.length, content_sha256: sha256Hex(document.content), content_base64: document.content.toString('base64'), read_path: 'openemr-document-get-data' });
    }
    if (req.method === 'POST' && query.route === 'lab-results') {
      const source = documents.get(body.source_document_id);
      if (!source || source.patientUuid !== patientUuid || source.documentType !== 'lab_pdf') return reply(res, 404, { error: 'document_not_found' });
      if (sha256Hex(source.content) !== body.source_sha256) return reply(res, 400, { error: 'invalid_request', issues: ['source_sha256_mismatch'] });
      const [status, response] = idempotent(`lab:v1:${patientUuid}:${body.source_sha256}`, () => {
        const orderId = nextOrderId++;
        counts.procedure_orders += 1;
        const results = body.results.map((row) => { counts.procedure_results += 1; return { field_id: row.field_id, procedure_result_id: nextResultId++, observation_id: crypto.randomUUID(), row }; });
        labBySource.set(body.source_document_id, results);
        return { source_document_id: body.source_document_id, procedure_order_id: orderId, procedure_report_id: orderId, results: results.map(({ row: _row, ...result }) => result), observation_ids: results.map((result) => result.observation_id) };
      });
      return reply(res, status, response);
    }
    if (req.method === 'GET' && query.route === 'lab-observations') {
      const results = labBySource.get(Number(query.source_document_id));
      if (!results) return reply(res, 404, { error: 'document_not_found' });
      return reply(res, 200, { resourceType: 'Bundle', type: 'searchset', total: results.length, read_path: 'openemr-fhir-service-in-process', source_document_id: Number(query.source_document_id), missing_observation_ids: [], entry: results.map(({ observation_id, row }) => ({ resource: { resourceType: 'Observation', id: observation_id, status: 'final', code: { coding: [{ system: 'http://loinc.org', code: row.loinc_code, display: row.test_name }] }, valueQuantity: { value: Number(row.value), unit: row.unit } } })) });
    }
    return reply(res, 404, { error: 'route_not_found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/interface/modules/custom_modules/oe-module-agentforge/public/api.php`,
    counts: () => ({ ...counts }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

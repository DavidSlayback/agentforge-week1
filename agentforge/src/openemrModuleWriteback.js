import { authorizeRequest, issueSignedContext, signedTokenFor } from './accessContext.js';
import { validateSourceDocumentInput } from './sourceDocuments.js';
import { SyntheticClinicalActionStore } from './clinicalActions.js';
import { MODULE_OBSERVATION_READ_PATH, OpenEMRModuleClient, OpenEMRModuleError, sha256Hex } from './openemrModuleClient.js';

export const OPENEMR_MODULE_PERSISTENCE_BOUNDARY = 'openemr-module';
export const IN_MEMORY_SYNTHETIC_PERSISTENCE_BOUNDARY = 'in-memory-synthetic';

/** LOINC codes for the only two analytes the extractor emits today. */
export const LAB_LOINC_MAP = Object.freeze({
  'lab.hgb': Object.freeze({ code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' }),
  'lab.a1c': Object.freeze({ code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood' }),
});

const SOURCE_TYPES = new Set(['lab_pdf', 'intake_form']);
const OPENEMR_DOCUMENT_ID = /^openemr-doc-([1-9][0-9]{0,15})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Module tokens are minted a little under the module's 300 s ceiling.
const MODULE_TOKEN_TTL_SECONDS = 240;

const codedError = (code) => Object.assign(new Error(code), { code });

/** `fixture-patient-001=<openemr uuid>,...` -> Map. Throws on malformed entries so misconfiguration fails at startup. */
export function parsePatientMap(raw = '') {
  const map = new Map();
  for (const entry of String(raw).split(/[\s,]+/).filter(Boolean)) {
    const [ref, uuid] = entry.split('=');
    if (!ref || !uuid || !UUID.test(uuid.toLowerCase())) throw codedError('OPENEMR_DEMO_PATIENT_MAP_INVALID');
    map.set(ref, uuid.toLowerCase());
  }
  return map;
}

export function parseUuidAllowlist(raw = '') {
  return new Set(String(raw).split(/[\s,]+/).map((value) => value.toLowerCase()).filter((value) => UUID.test(value)));
}

export function openemrDocumentNumber(id) {
  const match = OPENEMR_DOCUMENT_ID.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

/** The strict AbnormalFlag enum -> OpenEMR proc_res_abnormal. Never infers high/low; unknown stays empty. */
export function abnormalForOpenEMR(flag) {
  return { high: 'high', low: 'low', normal: 'no', abnormal: 'yes' }[flag] ?? '';
}

function collectionDateForOpenEMR(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : null;
}

/**
 * Map typed LabResult[] onto the module's lab-results rows. A result without a
 * LOINC mapping or a parseable date is reported in `unmapped`, never dropped
 * silently and never written with a guessed code.
 */
export function labResultsForModule(extraction) {
  const results = [];
  const unmapped = [];
  for (const result of extraction?.lab_results || []) {
    const fieldId = /^(lab\.[a-z0-9_]+)\./.exec(result?.citation?.field_or_chunk_id || '')?.[1] || null;
    const loinc = fieldId ? LAB_LOINC_MAP[fieldId] : null;
    const collectionDate = collectionDateForOpenEMR(result.collection_date);
    if (!loinc) { unmapped.push({ field_id: fieldId, reason: 'loinc_unmapped' }); continue; }
    if (!collectionDate) { unmapped.push({ field_id: fieldId, reason: 'collection_date_unparsed' }); continue; }
    const page = Number(/page\s+(\d+)/i.exec(result.citation?.page_or_section || '')?.[1] || 1);
    results.push({ field_id: fieldId, loinc_code: loinc.code, test_name: result.test_name, value: result.value, unit: result.unit || '', reference_range: result.reference_range || '', abnormal: abnormalForOpenEMR(result.abnormal_flag), collection_date: collectionDate, page });
  }
  return { results, unmapped };
}

/** Derived-facts JSON stored next to the source. Deterministic: no timestamps. */
export function derivedFactsDocument({ sourceDocument, extraction }) {
  return {
    schema: 'agentforge-derived-facts-v1',
    source_document_id: sourceDocument.openemr?.document_id ?? openemrDocumentNumber(sourceDocument.id),
    source_content_sha256: sourceDocument.content_sha256,
    document_type: sourceDocument.document_type,
    extraction_contract_version: extraction.contract_version || null,
    extraction_provider: extraction.provider || null,
    extraction_status: extraction.status,
    facts: (extraction.facts || []).map((fact) => ({ field_id: fact.field_id, value: fact.value, confidence: fact.confidence, citation: fact.citation })),
    lab_results: extraction.lab_results || [],
    intake_form: extraction.intake_form ?? null,
    review_status: 'not_clinician_reviewed',
  };
}

/** Every stored result must come back from OpenEMR's FHIR service with the same code and value. */
export function verifyObservationReadBack(bundle, labResponse, rows) {
  const byId = new Map((bundle.entry || []).map((entry) => [entry?.resource?.id, entry.resource]));
  const missing = [];
  const mismatched = [];
  for (const stored of labResponse.results || []) {
    const resource = byId.get(stored.observation_id);
    if (!resource) { missing.push(stored.observation_id); continue; }
    const row = rows.find((item) => item.field_id === stored.field_id);
    const codes = (resource.code?.coding || []).map((coding) => coding?.code);
    const value = resource.valueQuantity?.value ?? resource.valueString;
    const valueMatches = value !== undefined && value !== null && (String(value) === row?.value || Number(value) === Number(row?.value));
    if (!row || !codes.includes(row.loinc_code) || !valueMatches) mismatched.push(stored.field_id);
  }
  const expected = (labResponse.results || []).length;
  return { verified: expected > 0 && missing.length === 0 && mismatched.length === 0, read_path: bundle.read_path, observation_count: expected - missing.length, missing_observation_ids: missing, mismatched_field_ids: mismatched };
}

/**
 * Writeback that persists W2 source documents and derived facts in the deployed
 * OpenEMR through oe-module-agentforge. Implements the SyntheticWriteback
 * surface asynchronously; it keeps no local copy of documents.
 *
 * Identity: tokens issued by the OpenEMR launcher (issuer openemr-module) are
 * forwarded unchanged and the module takes the actor from them. For the public
 * synthetic demo (issuer synthetic-demo), the fixture patient is mapped to its
 * allowlisted OpenEMR uuid and a synthetic-demo token is minted for the module.
 * This service already hands synthetic-demo write tokens to any caller for those
 * patients, so this adds no authority; the module attributes the write to its
 * configured demo actor and records the issuer.
 */
export class OpenEMRModuleWriteback {
  constructor({ client, secret, patientMap = new Map(), demoPatientAllowlist = new Set(), clinicalActionStore = new SyntheticClinicalActionStore() }) {
    if (!client || !secret) throw codedError('OPENEMR_MODULE_NOT_CONFIGURED');
    for (const uuid of patientMap.values()) if (!demoPatientAllowlist.has(uuid)) throw codedError('OPENEMR_DEMO_PATIENT_MAP_NOT_ALLOWLISTED');
    this.client = client;
    this.secret = secret;
    this.patientMap = patientMap;
    this.demoPatientAllowlist = demoPatientAllowlist;
    // Clinical-action drafts and diagnosis/order confirmations stay in the
    // in-memory synthetic ledger (labelled synthetic_only); nothing here writes them to OpenEMR.
    this.clinicalActionStore = clinicalActionStore;
    this.name = 'openemr-module-writeback';
    this.persistenceBoundary = OPENEMR_MODULE_PERSISTENCE_BOUNDARY;
  }

  authorize(request, verifiedContext = null, options = {}) {
    return authorizeRequest({ request, verifiedContext, ...options });
  }

  moduleContext(verifiedContext, patientRef, scope) {
    if (!verifiedContext) throw new OpenEMRModuleError('OPENEMR_CONTEXT_REQUIRED', { httpStatus: 403 });
    if (verifiedContext.issuer === 'openemr-module') {
      const token = signedTokenFor(verifiedContext);
      if (!token || verifiedContext.patient_uuid !== patientRef) throw new OpenEMRModuleError('OPENEMR_CONTEXT_REQUIRED', { httpStatus: 403 });
      return { patientUuid: verifiedContext.patient_uuid, contextToken: token };
    }
    if (verifiedContext.issuer === 'synthetic-demo') {
      const patientUuid = this.patientMap.get(patientRef) || (this.demoPatientAllowlist.has(patientRef) ? patientRef : null);
      if (!patientUuid || !this.demoPatientAllowlist.has(patientUuid)) throw new OpenEMRModuleError('OPENEMR_DEMO_PATIENT_NOT_ALLOWED', { httpStatus: 403 });
      const contextToken = issueSignedContext({ patient_uuid: patientUuid, clinician_uuid: verifiedContext.clinician_uuid, scope, acl: scope === 'read-briefing' ? 'read' : 'write', ttlSeconds: MODULE_TOKEN_TTL_SECONDS, issuer: 'synthetic-demo', authn: 'synthetic', secret: this.secret });
      return { patientUuid, contextToken };
    }
    throw new OpenEMRModuleError('OPENEMR_CONTEXT_ISSUER_UNSUPPORTED', { httpStatus: 403 });
  }

  publicDocument({ patientRef, patientUuid, module, documentType, filename, uploadedBy = null }) {
    return {
      id: `openemr-doc-${module.document_id}`,
      patient_ref: patientRef,
      document_type: documentType,
      filename,
      content_sha256: module.content_sha256,
      size_bytes: module.size_bytes,
      ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
      synthetic_only: true,
      source_system: 'openemr',
      persistence_boundary: OPENEMR_MODULE_PERSISTENCE_BOUNDARY,
      openemr: { document_id: module.document_id, document_uuid: module.document_uuid ?? null, patient_uuid: patientUuid, ...(module.category ? { category: module.category } : {}) },
    };
  }

  async persistSourceDocument({ patientRef, documentType, filename, content, uploadedBy, verifiedContext = null }) {
    validateSourceDocumentInput({ patientRef, documentType, filename, content, uploadedBy });
    const pdf = content.subarray(0, 5).toString('latin1') === '%PDF-';
    const text = !pdf && filename.toLowerCase().endsWith('.txt') && !content.includes(0);
    if (!pdf && !text) throw codedError('SOURCE_DOCUMENT_TYPE_UNSUPPORTED_FOR_OPENEMR');
    const { patientUuid, contextToken } = this.moduleContext(verifiedContext, patientRef, 'write-source-document');
    const module = await this.client.storeDocument({ patientUuid, contextToken, documentType, filename, mimeType: pdf ? 'application/pdf' : 'text/plain', content });
    if (module.content_sha256 !== sha256Hex(content)) throw new OpenEMRModuleError('OPENEMR_MODULE_CONTENT_HASH_MISMATCH');
    return { duplicate: module.status === 'duplicate', document: this.publicDocument({ patientRef, patientUuid, module, documentType, filename, uploadedBy }) };
  }

  async getSourceDocument(id, { patientRef, verifiedContext = null } = {}) {
    const documentId = openemrDocumentNumber(id);
    if (!documentId) throw codedError('DOCUMENT_NOT_FOUND');
    const { patientUuid, contextToken } = this.moduleContext(verifiedContext, patientRef, 'read-briefing');
    const module = await this.client.getDocument({ patientUuid, contextToken, documentId });
    if (!SOURCE_TYPES.has(module.document_type)) throw codedError('DOCUMENT_NOT_FOUND');
    return { document: this.publicDocument({ patientRef, patientUuid, module, documentType: module.document_type, filename: module.filename }), content: module.content };
  }

  /**
   * After extraction: store the derived-facts JSON (linked to the source) and,
   * for a lab PDF, the lab results as procedure rows, then read the results
   * back through OpenEMR's FHIR service and require every value to match.
   */
  async persistDerivedEvidence({ patientRef, sourceDocument, extraction, verifiedContext = null }) {
    const sourceId = openemrDocumentNumber(sourceDocument?.id);
    if (!sourceId) throw codedError('DOCUMENT_NOT_FOUND');
    const base = { persistence_boundary: OPENEMR_MODULE_PERSISTENCE_BOUNDARY, document_id: sourceId, derived_document_id: null, procedure_order_id: null, observation_ids: [], read_path: null };
    if (!extraction?.facts?.length) return { ...base, status: 'not_persisted', reason: 'no_extracted_facts', duplicate: false };
    const { patientUuid, contextToken } = this.moduleContext(verifiedContext, patientRef, 'write-source-document');
    const derivedContent = Buffer.from(JSON.stringify(derivedFactsDocument({ sourceDocument, extraction })));
    const derived = await this.client.storeDocument({ patientUuid, contextToken, documentType: 'derived_facts', filename: `agentforge-derived-facts-${sourceId}.json`, mimeType: 'application/json', content: derivedContent, sourceDocumentId: sourceId });
    const result = { ...base, status: 'persisted', derived_document_id: derived.document_id, unmapped_lab_results: [] };
    let duplicate = derived.status === 'duplicate';
    if (sourceDocument.document_type === 'lab_pdf') {
      const mapped = labResultsForModule(extraction);
      result.unmapped_lab_results = mapped.unmapped;
      if (mapped.results.length) {
        const lab = await this.client.storeLabResults({ patientUuid, contextToken, sourceDocumentId: sourceId, sourceSha256: sourceDocument.content_sha256, results: mapped.results });
        const bundle = await this.client.getLabObservations({ patientUuid, contextToken, sourceDocumentId: sourceId });
        const readBack = verifyObservationReadBack(bundle, lab, mapped.results);
        if (!readBack.verified) throw new OpenEMRModuleError('OPENEMR_OBSERVATION_READBACK_MISMATCH', { httpStatus: 502 });
        duplicate = duplicate && lab.status === 'duplicate';
        Object.assign(result, { procedure_order_id: lab.procedure_order_id, observation_ids: lab.observation_ids, read_path: MODULE_OBSERVATION_READ_PATH, read_back: readBack });
      }
    }
    return { ...result, duplicate };
  }

  async readLabObservations(id, { patientRef, verifiedContext = null } = {}) {
    const documentId = openemrDocumentNumber(id);
    if (!documentId) throw codedError('DOCUMENT_NOT_FOUND');
    const { patientUuid, contextToken } = this.moduleContext(verifiedContext, patientRef, 'read-briefing');
    return this.client.getLabObservations({ patientUuid, contextToken, sourceDocumentId: documentId });
  }

  draftClinicalAction(input) { return this.clinicalActionStore.draft(input); }
  confirmClinicalAction(id, input) { return this.clinicalActionStore.confirm(id, input); }
  getClinicalAction(id, options) { return this.clinicalActionStore.get(id, options); }

  /** A3: only clinician-confirmed intake items. Implemented; not yet called from the clinical-action lane. */
  async confirmClinicalListItems({ patientRef, sourceDocumentId, confirmationEventId, items, verifiedContext = null }) {
    const documentId = openemrDocumentNumber(sourceDocumentId);
    if (!documentId) throw codedError('DOCUMENT_NOT_FOUND');
    const { patientUuid, contextToken } = this.moduleContext(verifiedContext, patientRef, 'write-clinical-action');
    return this.client.storeClinicalListItems({ patientUuid, contextToken, sourceDocumentId: documentId, confirmationEventId, items });
  }
}

/** Build the module writeback from the environment; throws when required settings are missing. */
export function createOpenEMRModuleWritebackFromEnv(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const client = new OpenEMRModuleClient({ baseUrl: env.AGENTFORGE_OPENEMR_MODULE_URL, secret: env.AGENTFORGE_DEMO_SECRET, timeoutMs: Number(env.AGENTFORGE_OPENEMR_MODULE_TIMEOUT_MS || 15000), fetchImpl });
  return new OpenEMRModuleWriteback({ client, secret: env.AGENTFORGE_DEMO_SECRET, patientMap: parsePatientMap(env.AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP), demoPatientAllowlist: parseUuidAllowlist(env.AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS) });
}

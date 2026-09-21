import { FixtureAdapter } from './fixtureAdapter.js';
import { authorizeRequest } from './accessContext.js';
import { SyntheticSourceDocumentStore } from './sourceDocuments.js';
import { SyntheticObservationStore } from './observations.js';
import fs from 'node:fs/promises';

const REST_PREFIX = '/apis/default/api';
const READ_GROUPS = Object.freeze([
  ['encounters', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/encounter`, mapEncounter],
  ['problems', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/medical_problem`, mapProblem],
  ['medications', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.pid)}/medication`, mapMedication],
  ['allergies', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/allergy`, mapAllergy],
  ['notes', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.pid)}/document`, mapNote],
]);

/**
 * Live OpenEMR read adapter. Chart reads use GET only; the separate OAuth
 * refresh exchange uses POST and writes only the local token cache.
 */
export class OpenEMRRestAdapter {
  constructor({ baseUrl, accessToken, tokenProvider = null, requiredIssuer = 'openemr-module', requiredAuthn = 'openemr-session', requiredRole = 'clinician', timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.tokenProvider = tokenProvider;
    this.requiredIssuer = requiredIssuer;
    this.requiredAuthn = requiredAuthn;
    this.requiredRole = requiredRole;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.name = 'openemr-rest';
  }

  /** Validate caller context; this adapter does not establish or bind a
   * clinician's OpenEMR session to the request identity. */
  authorize(request, verifiedContext = null, options = {}) {
    return authorizeRequest({ request, verifiedContext, requiredIssuer: this.requiredIssuer, requiredAuthn: this.requiredAuthn, requiredRole: this.requiredRole, ...options });
  }

  /** Probe the authenticated patient GET endpoint; this is only a dependency check. */
  async checkReady() {
    if (!this.baseUrl || (!this.accessToken && !this.tokenProvider)) return false;
    try {
      const response = await this.request(`${REST_PREFIX}/patient?limit=1`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getCase(patientRef, _caseId, { signal } = {}) {
    const patientResponse = await this.request(`${REST_PREFIX}/patient/${encodeURIComponent(patientRef)}`, { signal });
    const patientRecord = firstRecord(patientResponse.body);
    if (!patientRecord) throw new Error('PATIENT_NOT_FOUND');
    const returnedRefs = [patientRecord.uuid, patientRecord.puuid, patientRecord.patient_uuid, patientRecord.pid, patientRecord.patient_id, patientRecord.id].filter((value) => value !== undefined && value !== null && String(value));
    if (!returnedRefs.length || !returnedRefs.some((value) => String(value) === String(patientRef))) throw new Error('PATIENT_SCOPE_MISMATCH');
    const patient = normalizePatient(patientRecord, patientRef);
    return { id: `openemr-${patientRef}`, patient: publicPatient(patient), openemr_patient: patient, expected: {} };
  }

  /**
   * Read chart groups with per-group coverage. Non-encounter rows must match
   * the patient UUID or PID; unmatched rows are dropped. Encounter rows rely
   * on OpenEMR's patient-scoped endpoint.
   */
  async retrieve(item, { correlationId = '', signal } = {}) {
    const patient = item.openemr_patient;
    const groups = [{ group: 'identity', status: 'success', records: 1, attempts: 1, error_class: null }];
    const records = [mapIdentity(patient)];
    const results = await Promise.all(READ_GROUPS.map(async ([group, pathFor, mapper]) => {
      try {
        const result = await this.request(pathFor(patient), { correlationId, signal });
        const rows = recordsFrom(result.body);
        const scopedRows = rows.filter((row) => rowBelongsToPatient(row, patient, group));
        const mapped = scopedRows.flatMap((row, index) => mapper(row, index));
        return { records: mapped, coverage: { group, status: mapped.length ? 'success' : 'empty', records: mapped.length, attempts: 1, error_class: null } };
      } catch (error) {
        return { records: [], coverage: { group, status: error.code === 'OPENEMR_UNAUTHORIZED' ? 'unauthorized' : error.code === 'OPENEMR_TIMEOUT' ? 'timeout' : 'failed', records: 0, attempts: 1, error_class: error.code || 'openemr_read_failed' } };
      }
    }));
    for (const result of results) { records.push(...result.records); groups.push(result.coverage); }
    return { records, coverage: groups };
  }

  /** Perform one read-only OpenEMR GET, optionally with bearer auth. */
  async request(path, { includeAuth = true, correlationId = '', signal } = {}) {
    if (!this.baseUrl) throw Object.assign(new Error('OPENEMR_NOT_CONFIGURED'), { code: 'OPENEMR_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromParent = () => controller.abort();
    if (signal) {
      if (signal.aborted) abortFromParent();
      else signal.addEventListener('abort', abortFromParent, { once: true });
    }
    const headers = { accept: 'application/json' };
    if (correlationId) headers['x-correlation-id'] = correlationId;
    if (includeAuth) {
      const accessToken = this.tokenProvider ? await this.tokenProvider.getAccessToken() : this.accessToken;
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'GET', headers, signal: controller.signal });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'OPENEMR_UNAUTHORIZED' : `OPENEMR_HTTP_${response.status}`;
        throw Object.assign(new Error(code), { code });
      }
      return { ok: true, body: await response.json() };
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw Object.assign(new Error('OPENEMR_TIMEOUT'), { code: 'OPENEMR_TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromParent);
    }
  }
}

/** Cache and refresh OAuth credentials used only for GET chart reads. */
export class OpenEMRRefreshTokenProvider {
  constructor({ tokenUrl, clientId, clientSecret, cachePath, fetchImpl = globalThis.fetch, timeoutMs = 5000, skewMs = 15000, now = () => Date.now() }) {
    this.tokenUrl = tokenUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.cachePath = cachePath;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.skewMs = skewMs;
    this.now = now;
    this.state = null;
    this.loadPromise = null;
    this.refreshPromise = null;
  }

  async getAccessToken() {
    await this.loadCache();
    if (this.state?.access_token && Number(this.state.expires_at || 0) > this.now() + this.skewMs) return this.state.access_token;
    if (!this.state?.refresh_token) throw Object.assign(new Error('OPENEMR_REFRESH_TOKEN_MISSING'), { code: 'OPENEMR_REFRESH_TOKEN_MISSING' });
    if (!this.refreshPromise) this.refreshPromise = this.refresh().finally(() => { this.refreshPromise = null; });
    await this.refreshPromise;
    return this.state.access_token;
  }

  async loadCache() {
    if (this.state || this.loadPromise || !this.cachePath) return this.loadPromise;
    this.loadPromise = fs.readFile(this.cachePath, 'utf8')
      .then((raw) => { this.state = JSON.parse(raw); })
      .catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    return this.loadPromise;
  }

  async refresh() {
    if (!this.tokenUrl || !this.clientId || !this.clientSecret) throw Object.assign(new Error('OPENEMR_TOKEN_PROVIDER_NOT_CONFIGURED'), { code: 'OPENEMR_TOKEN_PROVIDER_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.state.refresh_token });
    try {
      const response = await this.fetchImpl(this.tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error(`OPENEMR_TOKEN_HTTP_${response.status}`), { code: `OPENEMR_TOKEN_HTTP_${response.status}` });
      const body = await response.json();
      if (!body.access_token) throw Object.assign(new Error('OPENEMR_TOKEN_RESPONSE_INVALID'), { code: 'OPENEMR_TOKEN_RESPONSE_INVALID' });
      this.state = { access_token: body.access_token, refresh_token: body.refresh_token || this.state.refresh_token, expires_at: this.now() + Number(body.expires_in || 3600) * 1000, scope: body.scope || this.state.scope || '' };
      if (this.cachePath) {
        await fs.writeFile(this.cachePath, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
      }
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('OPENEMR_TOKEN_TIMEOUT'), { code: 'OPENEMR_TOKEN_TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Synthetic local fixture implementation of the adapter boundary. */
export class SimulatedOpenEMRAdapter {
  constructor({ fixturePath, sourceDocumentStore = new SyntheticSourceDocumentStore(), observationStore = new SyntheticObservationStore() }) {
    this.fixture = new FixtureAdapter(fixturePath);
    this.sourceDocumentStore = sourceDocumentStore;
    this.observationStore = observationStore;
    this.name = 'simulated-openemr';
  }

  authorize(request, verifiedContext = null, options = {}) {
    return authorizeRequest({ request, verifiedContext, ...options });
  }

  // Synthetic local mode preserves the authorization/retrieval seam without
  // contacting OpenEMR.
  getCase(patientRef, caseId) { return this.fixture.getCase(patientRef, caseId); }
  retrieve(item) { return this.fixture.retrieve(item); }
  persistSourceDocument(input) { return this.sourceDocumentStore.persist(input); }
  getSourceDocument(id, options) { return this.sourceDocumentStore.get(id, options); }
  listSourceDocuments(patientRef) { return this.sourceDocumentStore.list(patientRef); }
  persistObservation(input) { return this.observationStore.persist(input); }
  listObservations(patientRef) { return this.observationStore.list(patientRef); }
  async checkReady() { return this.fixture.checkReady(); }
}

function recordsFrom(body) {
  const data = body?.data ?? body;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

function firstRecord(body) { return recordsFrom(body)[0] || null; }

function normalizePatient(record, fallbackRef) {
  const patientRef = record.uuid || record.puuid || record.patient_uuid || fallbackRef;
  const displayName = record.display_name || record.name || [record.fname, record.mname, record.lname].filter(Boolean).join(' ') || `OpenEMR patient ${patientRef}`;
  return { patient_ref: String(patientRef), display_name: String(displayName), dob: record.DOB || record.dob || null, pid: record.pid || record.patient_id || record.id || null };
}

function mapIdentity(patient) { return { field: 'identity.patient', value: patient.display_name, recorded_at: null, author: null, source_ref: `openemr-patient-${patient.patient_ref}` }; }
function publicPatient(patient) { return { patient_ref: patient.patient_ref, display_name: patient.display_name, dob: patient.dob }; }
function mapProblem(record, index) { return [mappedRecord(`problem.${slug(record.title || record.problem || record.diagnosis || record.name || 'unknown')}.status`, record.status || record.active || record.title || record.problem || 'documented', record, index, 'problem')]; }
function mapMedication(record, index) { return [mappedRecord(`medication.${slug(record.title || record.medication || record.name || 'unknown')}.status`, record.status || record.active || record.title || record.medication || 'documented', record, index, 'medication')]; }
function mapEncounter(record, index) { return [mappedRecord('encounter.reason', record.reason || record.chief_complaint || record.encounter || record.type || 'encounter recorded', record, index, 'encounter')]; }
function mapAllergy(record, index) { return [mappedRecord(`allergy.${slug(record.title || record.name || record.allergy || 'unknown')}`, record.reaction || record.status || record.title || record.name || 'documented', record, index, 'allergy')]; }
function mapNote(record, index) { return [mappedRecord(`note.${slug(record.title || record.filename || record.name || 'document')}`, record.title || record.filename || record.name || 'document recorded', record, index, 'note')]; }

function mappedRecord(field, value, record, index, group) {
  const patientRef = record.puuid || record.patient_uuid || record.patient_ref || null;
  return { field, value, recorded_at: record.recorded_at || record.date || record.date_created || record.created_at || record.begdate || null, author: record.author || record.provider_name || record.provider || null, source_ref: String(record.uuid || record.euuid || record.id || record.source_ref || `openemr-${group}-${index}`), ...(patientRef ? { patient_ref: String(patientRef) } : {}), reassessment_documented: Boolean(record.reassessment_documented) };
}

/** Fail closed when any chart row lacks or disagrees with patient identity. */
function rowBelongsToPatient(record, patient, group) {
  const rowRefs = [record.puuid, record.patient_uuid, record.patient_ref].filter((value) => value !== undefined && value !== null && String(value));
  const rowPids = [record.pid, record.patient_id].filter((value) => value !== undefined && value !== null && String(value));
  if (!rowRefs.length && !rowPids.length) return false;
  if (rowRefs.some((value) => String(value).toLowerCase() !== String(patient.patient_ref).toLowerCase())) return false;
  if (rowPids.some((value) => patient.pid === undefined || patient.pid === null || String(patient.pid) === '' || String(value) !== String(patient.pid))) return false;
  return true;
}

function slug(value) { return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown'; }

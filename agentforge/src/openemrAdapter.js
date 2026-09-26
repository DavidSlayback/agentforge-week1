import { authorizeRequest } from './accessContext.js';
import fs from 'node:fs/promises';

const REST_PREFIX = '/apis/default/api';
/**
 * E9b, OpenEMR 8.0.0 finding (unresolved upstream): the patient-scoped
 * `/patient/{puuid}/medical_problem` and `/patient/{puuid}/allergy` routes
 * answer 200 `[]` for patients who have rows, so an empty answer from them is
 * not a confirmed absence. Those groups report `unverified_empty`
 * (`openemr_scoped_list_empty`), which qualifies the briefing and answer. The
 * medication route (by pid) returns the patient's rows and an empty
 * encounter list is a 404 (failed), so their empty results stay `empty`.
 * The numeric-pid variant of these routes is not used: it works only because
 * this build compares `:puuid` against the pid.
 */
const UNTRUSTED_EMPTY = 'openemr_scoped_list_empty';
const READ_GROUPS = Object.freeze([
  ['encounters', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/encounter`, mapEncounter],
  ['problems', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/medical_problem`, mapProblem, UNTRUSTED_EMPTY],
  ['medications', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.pid)}/medication`, mapMedication],
  ['allergies', (patient) => `${REST_PREFIX}/patient/${encodeURIComponent(patient.patient_ref)}/allergy`, mapAllergy, UNTRUSTED_EMPTY],
]);
/**
 * F-LIVE: groups this adapter does not read, reported as `not_requested` with
 * the reason, never as success or a silent gap. Notes: the only standard REST
 * route for a patient's documents, `GET /patient/{pid}/document`, requires a
 * `path` query naming one document category and lists that category only
 * (`DocumentService::getAllAtPath`). Without `path` it answers 404 on this
 * repo's 8.2.0-dev code and 500 on the production OpenEMR 8.0.0 image. Its
 * rows (`filename`, `hash`, `id`, `mimetype`, `docdate`) carry no pid or
 * patient uuid, so they could never pass `rowBelongsToPatient`. The SOAP-note
 * route needs `user/soap_note.rs` and one call per encounter; FHIR
 * DocumentReference needs FHIR scopes. The service's grant has neither.
 */
const NOT_READ_GROUPS = Object.freeze([
  ['notes', 'openemr_notes_route_unavailable'],
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

  // No `listPatientIdentifiers()`: this adapter cannot list patients, so the
  // other-patient question check (patientMentions.js) sees only identifier
  // shapes (synthetic refs, UUIDs) here, never another patient's name or MRN.

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

  async getCase(patientRef, _caseId, { signal, correlationId = '' } = {}) {
    const patientResponse = await this.request(`${REST_PREFIX}/patient/${encodeURIComponent(patientRef)}`, { signal, correlationId });
    const patientRecord = firstRecord(patientResponse.body);
    if (!patientRecord) throw new Error('PATIENT_NOT_FOUND');
    const returnedRefs = [patientRecord.uuid, patientRecord.puuid, patientRecord.patient_uuid, patientRecord.pid, patientRecord.patient_id, patientRecord.id].filter((value) => value !== undefined && value !== null && String(value));
    if (!returnedRefs.length || !returnedRefs.some((value) => String(value) === String(patientRef))) throw new Error('PATIENT_SCOPE_MISMATCH');
    const patient = normalizePatient(patientRecord, patientRef);
    return { id: `openemr-${patientRef}`, patient: publicPatient(patient), openemr_patient: patient };
  }

  /**
   * PatientDemographicsSource for the live path: the OpenEMR patient's
   * `{name, dob}` for the scan identity check, or `null` when OpenEMR has no
   * such patient (the check then reports `unverified`, never a match).
   */
  async getPatientDemographics(patientRef, { correlationId = '' } = {}) {
    try {
      const item = await this.getCase(patientRef, null, { correlationId });
      return { name: item.openemr_patient.display_name, dob: item.openemr_patient.dob };
    } catch (error) {
      if (error.message === 'PATIENT_NOT_FOUND') return null;
      throw error;
    }
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
    const results = await Promise.all(READ_GROUPS.map(async ([group, pathFor, mapper, untrustedEmpty = null]) => {
      try {
        const result = await this.request(pathFor(patient), { correlationId, signal });
        const rows = recordsFrom(result.body);
        const scopedRows = rows.filter((row) => rowBelongsToPatient(row, patient, group));
        const mapped = scopedRows.flatMap((row, index) => mapper(row, index));
        if (mapped.length) return { records: mapped, coverage: { group, status: 'success', records: mapped.length, attempts: 1, error_class: null } };
        // Rows that all belong to other patients prove nothing about this one,
        // on any route; an empty answer from a route known to return empty
        // wrongly (above) proves nothing either. Neither is a confirmed absence.
        const unverifiedReason = rows.length ? 'openemr_rows_for_other_patients_only' : untrustedEmpty;
        return { records: [], coverage: { group, status: unverifiedReason ? 'unverified_empty' : 'empty', records: 0, attempts: 1, error_class: unverifiedReason } };
      } catch (error) {
        return { records: [], coverage: { group, status: error.code === 'OPENEMR_UNAUTHORIZED' ? 'unauthorized' : error.code === 'OPENEMR_TIMEOUT' ? 'timeout' : 'failed', records: 0, attempts: 1, error_class: error.code || 'openemr_read_failed' } };
      }
    }));
    for (const result of results) { records.push(...result.records); groups.push(result.coverage); }
    for (const [group, reason] of NOT_READ_GROUPS) groups.push({ group, status: 'not_requested', records: 0, attempts: 0, error_class: reason });
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
      const accessToken = this.tokenProvider ? await this.tokenProvider.getAccessToken({ correlationId }) : this.accessToken;
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

  /** `correlationId` is the calling request's; it rides on the refresh call and on any refresh error. */
  async getAccessToken({ correlationId = '' } = {}) {
    await this.loadCache();
    if (this.state?.access_token && Number(this.state.expires_at || 0) > this.now() + this.skewMs) return this.state.access_token;
    if (!this.state?.refresh_token) throw Object.assign(new Error('OPENEMR_REFRESH_TOKEN_MISSING'), { code: 'OPENEMR_REFRESH_TOKEN_MISSING' });
    // Concurrent callers share one refresh; it carries the first caller's id.
    if (!this.refreshPromise) this.refreshPromise = this.refresh({ correlationId }).finally(() => { this.refreshPromise = null; });
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

  async refresh({ correlationId = '' } = {}) {
    if (!this.tokenUrl || !this.clientId || !this.clientSecret) throw Object.assign(new Error('OPENEMR_TOKEN_PROVIDER_NOT_CONFIGURED'), { code: 'OPENEMR_TOKEN_PROVIDER_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.state.refresh_token });
    try {
      const response = await this.fetchImpl(this.tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) }, body: form.toString(), signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error(`OPENEMR_TOKEN_HTTP_${response.status}`), { code: `OPENEMR_TOKEN_HTTP_${response.status}` });
      const body = await response.json();
      if (!body.access_token) throw Object.assign(new Error('OPENEMR_TOKEN_RESPONSE_INVALID'), { code: 'OPENEMR_TOKEN_RESPONSE_INVALID' });
      this.state = { access_token: body.access_token, refresh_token: body.refresh_token || this.state.refresh_token, expires_at: this.now() + Number(body.expires_in || 3600) * 1000, scope: body.scope || this.state.scope || '' };
      if (this.cachePath) {
        await fs.writeFile(this.cachePath, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
      }
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('OPENEMR_TOKEN_TIMEOUT'), { code: 'OPENEMR_TOKEN_TIMEOUT', ...(correlationId ? { correlationId } : {}) });
      if (correlationId && error && typeof error === 'object') error.correlationId = correlationId;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
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
function mapProblem(record, index) { return [mappedRecord(`problem.${slug(record.title || record.problem || record.diagnosis || record.name || 'unknown')}.status`, record.status || record.active || listStatus(record) || record.title || record.problem || 'documented', record, index, 'problem')]; }
function mapMedication(record, index) {
  const name = slug(record.title || record.medication || record.name || 'unknown');
  return [
    mappedRecord(`medication.${name}.status`, record.status || record.active || listStatus(record) || record.title || record.medication || 'documented', record, index, 'medication'),
    mappedRecord(`medication.${name}.dose`, medicationDose(record), record, index, 'medication'),
  ];
}
/** A dose that is not recorded is said so, never left blank or guessed. */
export const MEDICATION_DOSE_NOT_RECORDED = 'not recorded';
/**
 * The dose, frequency or instructions an OpenEMR medication row carries.
 * `GET /patient/{pid}/medication` returns `SELECT * FROM lists` rows
 * (`ListService::getAll`): `lists` has no dose column, and the structured
 * `lists_medication.drug_dosage_instructions` is not joined. So on OpenEMR
 * 8.0 the only place a dose appears is the row's free-text `comments` (where
 * the medication-issue form and the E9 seed put it). A dose-specific field is
 * preferred when a build returns one.
 */
function medicationDose(record) {
  const text = [record.drug_dosage_instructions, record.dosage, record.dose, record.comments].map(textValue).find(Boolean);
  return text ? text.trim() : MEDICATION_DOSE_NOT_RECORDED;
}
/**
 * OpenEMR `lists` rows (problems, medications) have no status column; the
 * chart shows a row with no end date as active. Returns null when the row has
 * neither field, so the caller keeps its own fallback.
 */
function listStatus(record) {
  if (!('enddate' in record) && !('begdate' in record)) return null;
  return record.enddate ? `ended ${String(record.enddate).slice(0, 10)}` : 'active';
}
/** OpenEMR returns a coded reaction as an object keyed by code; its readable text is `reaction_title`. */
function textValue(value) { return typeof value === 'string' && value.trim() ? value : null; }
function mapEncounter(record, index) { return [mappedRecord('encounter.reason', record.reason || record.chief_complaint || record.encounter || record.type || 'encounter recorded', record, index, 'encounter')]; }
function mapAllergy(record, index) { return [mappedRecord(`allergy.${slug(record.title || record.name || record.allergy || 'unknown')}`, textValue(record.reaction_title) || textValue(record.reaction) || textValue(record.status) || record.title || record.name || 'documented', record, index, 'allergy')]; }

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

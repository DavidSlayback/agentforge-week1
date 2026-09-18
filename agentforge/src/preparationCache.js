/**
 * Server-owned preparation state. The client only receives the correlation ID;
 * scope, source revisions, and expiry are owned by this process.
 */
export class PreparationCache {
  constructor({ ttlMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('CACHE_TTL_INVALID');
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  put({ correlationId, patientRef, clinicianRef, verifiedContext, request, response, sourceRevision = 'fixture-v1', scheduleRevision = 'fixture-calendar-v1' }) {
    const preparedAt = this.now();
    const entry = {
      correlationId,
      patientRef,
      clinicianRef,
      verifiedContext,
      request: { patient_uuid: request.patient_uuid, clinician_uuid: request.clinician_uuid, case_id: request.case_id },
      response,
      sourceRevision,
      scheduleRevision,
      preparedAt,
      expiresAt: preparedAt + this.ttlMs,
    };
    this.entries.set(correlationId, entry);
    return { status: 'stored', expiresAt: entry.expiresAt, sourceRevision, scheduleRevision };
  }

  get(correlationId) {
    const entry = this.entries.get(correlationId);
    if (!entry) return { status: 'miss', entry: null };
    if (entry.expiresAt <= this.now()) return { status: 'stale', entry };
    return { status: 'hit', entry };
  }

  delete(correlationId) {
    return this.entries.delete(correlationId);
  }
}

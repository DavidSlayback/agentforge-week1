/**
 * Server-owned preparation state. The client only receives the correlation ID;
 * scope, source revisions, and expiry are owned by this process.
 */
export class PreparationCache {
  constructor({ ttlMs = 5 * 60 * 1000, maxEntries = 1000, now = () => Date.now() } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('CACHE_TTL_INVALID');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('CACHE_MAX_ENTRIES_INVALID');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  put({ correlationId, patientRef, clinicianRef, verifiedContext, request, response, sourceRevision = 'fixture-v1', scheduleRevision = 'fixture-calendar-v1' }) {
    const preparedAt = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= preparedAt) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
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
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(correlationId);
      return { status: 'stale', entry };
    }
    return { status: 'hit', entry };
  }

  /** Find a prepared visit by its server-owned schedule/source binding. */
  findByBinding({ patientRef, clinicianRef, scheduleRevision, sourceRevision = null }) {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) { this.entries.delete(key); continue; }
      if (entry.patientRef === patientRef && entry.clinicianRef === clinicianRef && entry.scheduleRevision === scheduleRevision && (!sourceRevision || entry.sourceRevision === sourceRevision)) return { status: 'hit', entry };
    }
    return { status: 'miss', entry: null };
  }

  delete(correlationId) {
    return this.entries.delete(correlationId);
  }
}

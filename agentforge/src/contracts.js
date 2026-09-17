export const COVERAGE_STATUSES = new Set(['success', 'empty', 'failed', 'timeout', 'unauthorized', 'not_requested']);
export const MAX_RETRIES = 2;

export function correlationId(value) {
  return value || `af-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function blockedResult(correlation_id, reason) {
  return { contract_version: '0.1', correlation_id, disposition: 'blocked', patient: null,
    claims: [], withheld_fields: [], coverage: [], qualification: { required: true, reasons: [reason] },
    verification: { status: 'blocked' }, operations: [] };
}

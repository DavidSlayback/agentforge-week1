import { isVerifiedContext } from './accessContext.js';
import { CHART_RECORD_SOURCES, chartReadOrigin, chartRecordCitationSource } from './chartSource.js';

/**
 * E9: pick the chart adapter per request from the signature-verified context
 * claims, and only from them.
 *
 * - `issuer: 'openemr-module'`, `authn: 'openemr-session'` (minted by the
 *   module launcher, `oe-module-agentforge/public/index.php`, from a logged-in
 *   OpenEMR session) reads the chart through `OpenEMRRestAdapter`, but only
 *   when live reads are on (`AGENTFORGE_OPENEMR_LIVE_READS=on`). When they are
 *   off, the request is blocked with `openemr_live_reads_disabled`; it never
 *   falls back to the fixture chart.
 * - `issuer: 'synthetic-demo'`, `authn: 'synthetic'` (the public demo's own
 *   tokens) reads the synthetic `FixtureAdapter`.
 * - Anything else is blocked.
 *
 * Labels come from `chartSource.js` (`CHART_RECORD_SOURCES`), the single
 * source-label table.
 *
 * No query parameter, header or body field takes part in the choice: the
 * router reads `verifiedContext`, which exists only after `verifySignedContext`
 * checked the signature (HMAC for synthetic-demo, Ed25519 for openemr-module;
 * W3 H1) and a copied plain object is rejected by `isVerifiedContext`.
 */
export const LIVE_READS_VALUES = Object.freeze(['on', 'off']);

/**
 * E9 egress rule, per patient: data from a live OpenEMR read may leave the
 * process only with AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED **and** the
 * verified patient on AGENTFORGE_LIVE_PATIENT_UUIDS (the designated
 * synthetic patients). A missing allowlist allows nobody.
 */
export function liveEgressAllowed({ approved, livePatientAllowlist }, patientRef) {
  return Boolean(approved) && typeof patientRef === 'string' && Boolean(livePatientAllowlist?.has(patientRef.toLowerCase()));
}

/** Scopes whose context may read the chart it names (a write-source-document context reads to answer its own scan). */
export const CHART_READ_SCOPES = Object.freeze(['read-briefing', 'write-source-document']);

const codedError = (code) => Object.assign(new Error(code), { code });

/** `AGENTFORGE_OPENEMR_LIVE_READS`: `on` or `off` (default `off`); anything else throws at startup. */
export function parseLiveReads(raw) {
  const value = raw === undefined || raw === null || raw === '' ? 'off' : String(raw).trim().toLowerCase();
  if (!LIVE_READS_VALUES.includes(value)) throw codedError('AGENTFORGE_OPENEMR_LIVE_READS_INVALID');
  return value === 'on';
}

export class ChartSourceRouter {
  constructor({ fixtureAdapter, liveAdapter = null, liveReads = false, liveConfigured = true }) {
    if (!fixtureAdapter) throw codedError('CHART_SOURCE_FIXTURE_ADAPTER_REQUIRED');
    if (liveReads && chartReadOrigin(liveAdapter) !== 'openemr') throw codedError('CHART_SOURCE_LIVE_ADAPTER_REQUIRED');
    this.fixtureAdapter = fixtureAdapter;
    this.liveAdapter = liveReads ? liveAdapter : null;
    this.liveReads = Boolean(liveReads);
    // Live reads on without the OpenEMR access settings: refused loudly per
    // request (and /ready is 503), never a silent fallback.
    this.liveConfigured = Boolean(liveConfigured);
    this.name = 'chart-source-router';
  }

  /**
   * `{status: 'selected', adapter, ...CHART_RECORD_SOURCES[x]}` or
   * `{status: 'blocked', reason}`, from the verified claims only.
   */
  select(verifiedContext) {
    if (!isVerifiedContext(verifiedContext)) return { status: 'blocked', reason: 'server_context_missing_or_invalid' };
    const { issuer, authn } = verifiedContext;
    if (issuer === 'openemr-module' && authn === 'openemr-session') {
      if (!this.liveReads) return { status: 'blocked', reason: 'openemr_live_reads_disabled' };
      if (!this.liveConfigured) return { status: 'blocked', reason: 'openemr_live_reads_not_configured' };
      return { status: 'selected', adapter: this.liveAdapter, ...CHART_RECORD_SOURCES.openemr };
    }
    if (issuer === 'synthetic-demo' && authn === 'synthetic') return { status: 'selected', adapter: this.fixtureAdapter, ...CHART_RECORD_SOURCES.fixture };
    return { status: 'blocked', reason: 'chart_source_issuer_unsupported' };
  }

  /** Authorize with the selected adapter, pinning the issuer it serves. */
  authorize(request, verifiedContext = null, options = {}) {
    const selection = this.select(verifiedContext);
    if (selection.status !== 'selected') return { status: 'blocked', reason: selection.reason };
    const pinned = selection.chart_source === 'openemr_live'
      ? { requiredIssuer: 'openemr-module', requiredAuthn: 'openemr-session', requiredRole: 'clinician' }
      : { requiredIssuer: 'synthetic-demo', requiredAuthn: 'synthetic', requiredRole: 'clinician' };
    const authorization = selection.adapter.authorize(request, verifiedContext, { ...options, ...pinned });
    return authorization.status === 'authorized' ? { ...authorization, chart_source: selection.chart_source } : authorization;
  }

  /** The adapter for an already-authorized request; throws (never guesses) when the claims select none. */
  adapterFor(verifiedContext) {
    const selection = this.select(verifiedContext);
    if (selection.status !== 'selected') throw codedError(selection.reason === 'openemr_live_reads_disabled' ? 'OPENEMR_LIVE_READS_DISABLED' : 'CHART_SOURCE_UNRESOLVED');
    return selection.adapter;
  }

  // The router has no chart of its own. A caller that reads without resolving
  // the request's adapter first fails loudly instead of reading a default.
  getCase() { throw codedError('CHART_SOURCE_CONTEXT_REQUIRED'); }
  retrieve() { throw codedError('CHART_SOURCE_CONTEXT_REQUIRED'); }
  getPatientDemographics() { throw codedError('CHART_SOURCE_CONTEXT_REQUIRED'); }

  /** Fixture readiness always; the OpenEMR REST probe too when live reads are on. */
  async checkReady() {
    if (!await this.fixtureAdapter.checkReady()) return false;
    return this.liveReads ? this.liveAdapter.checkReady() : true;
  }
}

/**
 * The chart adapter a request reads through: the router's pick for the
 * verified context, or the adapter itself when it is not a router (the W1
 * live/synthetic modes, tests and the 50-case gate harness).
 */
export function resolveChartAdapter(adapter, verifiedContext) {
  return typeof adapter?.adapterFor === 'function' ? adapter.adapterFor(verifiedContext) : adapter;
}

/** Like `resolveChartAdapter`, but returns a blocked result instead of throwing. */
export function selectChartSource(adapter, verifiedContext) {
  if (typeof adapter?.select === 'function') return adapter.select(verifiedContext);
  return { status: 'selected', adapter, ...chartRecordCitationSource(adapter) };
}

/** What the UI shows before any request: from the verified launch claims and the live-reads setting. */
export function describeLaunchChartSource(router, verifiedContext) {
  if (!verifiedContext) return null;
  const selection = selectChartSource(router, verifiedContext);
  if (selection.status === 'selected') return { chart_source: selection.chart_source, label: selection.label, status: 'selected' };
  return { chart_source: 'none', label: selection.reason === 'openemr_live_reads_disabled' ? 'unavailable (OpenEMR live reads are off)' : 'unavailable', status: 'blocked', reason: selection.reason };
}

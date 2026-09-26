/**
 * Which chart source a record came from, decided once from the adapter that
 * produced it. The trace's retrieval label and the W2 chart-fact citation
 * both use this, so a fixture record is never presented as an OpenEMR read
 * (AGENTS.md: "Fixture data is not openemr-live").
 *
 * Only the real `OpenEMRRestAdapter` counts as OpenEMR. Every other adapter
 * (the synthetic `FixtureAdapter`, test doubles) is labeled a fixture. This
 * is an operational label only; it does not prove OpenEMR reachability.
 */
/*
 * This is the one source-label table. E9 (`chartSourceRouter.js`) picks the
 * adapter per request; every label a response, trace or page shows comes
 * from here: `chart_source` (scan and follow-up responses, the page badge's
 * value), `label` (the badge text) and `operation` (the briefing's read
 * operation, `contracts.js#ALLOWED_READ_OPERATIONS`).
 */
export const CHART_RECORD_SOURCES = Object.freeze({
  openemr: Object.freeze({ source_type: 'openemr_record', page_or_section: 'OpenEMR chart record', chart_source: 'openemr_live', label: 'OpenEMR (live)', operation: 'retrieve_openemr_read' }),
  fixture: Object.freeze({ source_type: 'synthetic_chart_fixture', page_or_section: 'Synthetic chart fixture', chart_source: 'synthetic_fixture', label: 'synthetic fixture', operation: 'retrieve_synthetic_fixture_read' }),
});

/** `'openemr'` for the live OpenEMR REST adapter, else `'fixture'`. */
export function chartReadOrigin(adapter) {
  return adapter?.constructor?.name === 'OpenEMRRestAdapter' ? 'openemr' : 'fixture';
}

/** The labels (citation `source_type` and `page_or_section`, `chart_source`, `label`, `operation`) for a read through `adapter`. */
export function chartRecordCitationSource(adapter) {
  return CHART_RECORD_SOURCES[chartReadOrigin(adapter)];
}

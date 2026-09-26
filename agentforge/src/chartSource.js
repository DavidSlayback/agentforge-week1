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
export const CHART_RECORD_SOURCES = Object.freeze({
  openemr: Object.freeze({ source_type: 'openemr_record', page_or_section: 'OpenEMR chart record' }),
  fixture: Object.freeze({ source_type: 'synthetic_chart_fixture', page_or_section: 'Synthetic chart fixture' }),
});

/** `'openemr'` for the live OpenEMR REST adapter, else `'fixture'`. */
export function chartReadOrigin(adapter) {
  return adapter?.constructor?.name === 'OpenEMRRestAdapter' ? 'openemr' : 'fixture';
}

/** The citation `source_type` and `page_or_section` for a record read through `adapter`. */
export function chartRecordCitationSource(adapter) {
  return CHART_RECORD_SOURCES[chartReadOrigin(adapter)];
}

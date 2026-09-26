import { citationBoxId } from './ui.js';

/**
 * E5 lab trend chart (PRD X-4): shape a patient's lab history, read back
 * from OpenEMR (or the in-memory synthetic store in fixture mode), into one
 * series per test and unit, and render each series as a server-side inline
 * SVG with a data-table fallback.
 *
 * Input is the normalized history a writeback returns from
 * `readLabObservationHistory`: `{ read_path, persistence_boundary,
 * missing_observation_ids, entries: [{ resource, source_document_id,
 * field_id, page, collection_date }] }`, where `resource` is a FHIR
 * Observation. Nothing here reads an upload or extraction response: a point
 * exists only if the persistence layer returned it.
 *
 * Values in different units are never drawn on one line: each (test, unit)
 * pair is its own series, and a test reported in more than one unit says so.
 */

const LOINC = 'http://loinc.org';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

/** OpenEMR proc_res_abnormal (and HL7 v3 interpretation codes) -> the AbnormalFlag vocabulary. */
function abnormalFlag(resource) {
  const interpretation = (resource.interpretation || [])[0];
  const raw = String(interpretation?.coding?.[0]?.code ?? interpretation?.text ?? '').trim().toLowerCase();
  return { no: 'normal', n: 'normal', normal: 'normal', yes: 'abnormal', a: 'abnormal', abnormal: 'abnormal', high: 'high', h: 'high', vhigh: 'high', hh: 'high', low: 'low', l: 'low', vlow: 'low', ll: 'low' }[raw] ?? 'unknown';
}

function referenceRange(resource) {
  const range = (resource.referenceRange || [])[0];
  const low = range?.low?.value;
  const high = range?.high?.value;
  if (Number.isFinite(low) && Number.isFinite(high) && low <= high) return { low, high, text: `${low}-${high}` };
  return null;
}

function observationValue(resource) {
  if (resource.valueQuantity && resource.valueQuantity.value !== undefined && resource.valueQuantity.value !== null) {
    return { raw: String(resource.valueQuantity.value), unit: String(resource.valueQuantity.unit ?? '').trim() };
  }
  if (typeof resource.valueString === 'string') return { raw: resource.valueString.trim(), unit: '' };
  return { raw: '', unit: '' };
}

function testCode(resource) {
  const codings = resource.code?.coding || [];
  const loinc = codings.find((coding) => coding?.system === LOINC && coding.code) || codings.find((coding) => coding?.code);
  return { code: loinc?.code || null, name: loinc?.display || resource.code?.text || loinc?.code || 'Unnamed test' };
}

/** The 5-key document citation for one read-back point: its own source document and field. */
export function pointCitation({ sourceDocumentId, fieldId, page, value }) {
  return {
    source_type: 'document',
    source_id: sourceDocumentId,
    page_or_section: `page ${Number.isInteger(page) && page > 0 ? page : 1}`,
    field_or_chunk_id: `${fieldId}.value`,
    quote_or_value: value,
  };
}

/**
 * Group read-back Observations into chartable series.
 *
 * Returns `{ read_path, persistence_boundary, tests, excluded,
 * missing_observation_count }`. Each test is `{ series_id, loinc_code,
 * test_name, unit, other_units, chart, reference_band, points }`, with
 * points sorted by collection date and `chart` = `line` (>= 2 points) or
 * `single_point`. Entries that cannot be charted (no numeric value, no
 * collection date, no source document or field) are listed in `excluded`
 * with a reason code and never plotted.
 */
export function buildLabTrends(history) {
  const excluded = [];
  const series = new Map();
  for (const entry of history?.entries || []) {
    const resource = entry?.resource || {};
    const { code, name } = testCode(resource);
    const { raw, unit } = observationValue(resource);
    const base = { observation_id: resource.id ?? null, loinc_code: code, test_name: name };
    if (typeof entry.source_document_id !== 'string' || !entry.source_document_id || typeof entry.field_id !== 'string' || !/^lab\.[a-z0-9_]+$/.test(entry.field_id)) { excluded.push({ ...base, reason: 'source_document_missing' }); continue; }
    if (!DATE.test(String(entry.collection_date || ''))) { excluded.push({ ...base, reason: 'collection_date_missing' }); continue; }
    if (!NUMBER.test(raw)) { excluded.push({ ...base, reason: 'value_not_numeric' }); continue; }
    const key = `${code || name}|${unit}`;
    if (!series.has(key)) series.set(key, { series_id: key, loinc_code: code, test_name: name, unit, points: [] });
    series.get(key).points.push({
      collection_date: entry.collection_date,
      value: Number(raw),
      unit,
      reference_range: referenceRange(resource)?.text ?? null,
      abnormal_flag: abnormalFlag(resource),
      source_document_id: entry.source_document_id,
      citation: pointCitation({ sourceDocumentId: entry.source_document_id, fieldId: entry.field_id, page: entry.page, value: raw }),
      reference: referenceRange(resource),
    });
  }
  const tests = [...series.values()].map((item) => {
    const points = [...item.points].sort((a, b) => a.collection_date.localeCompare(b.collection_date) || a.source_document_id.localeCompare(b.source_document_id, 'en', { numeric: true }));
    const bands = points.map((point) => point.reference).filter(Boolean);
    // One band only when every point states the same parseable range.
    const band = bands.length === points.length && bands.every((b) => b.low === bands[0].low && b.high === bands[0].high) ? { low: bands[0].low, high: bands[0].high } : null;
    const otherUnits = [...series.values()].filter((other) => other !== item && (other.loinc_code || other.test_name) === (item.loinc_code || item.test_name)).map((other) => other.unit);
    return { series_id: item.series_id, loinc_code: item.loinc_code, test_name: item.test_name, unit: item.unit, other_units: otherUnits, chart: points.length >= 2 ? 'line' : 'single_point', reference_band: band, points: points.map(({ reference: _reference, ...point }) => point) };
  }).sort((a, b) => a.test_name.localeCompare(b.test_name) || a.unit.localeCompare(b.unit));
  return {
    read_path: history?.read_path ?? null,
    persistence_boundary: history?.persistence_boundary ?? null,
    missing_observation_count: (history?.missing_observation_ids || []).length,
    skipped_lab_row_count: Number.isInteger(history?.skipped_lab_rows) ? history.skipped_lab_rows : 0,
    tests,
    excluded,
  };
}

const CHART = Object.freeze({ width: 480, height: 200, left: 52, right: 20, top: 16, bottom: 40 });
const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const formatNumber = (value) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))));

/** Source-preview link for one point, landing on its field's box (same pattern as the answer panel). */
export function pointHref(point, { basePath = '', patient_uuid = '', demo_token = '' } = {}) {
  return `${basePath}/v1/source-documents/${encodeURIComponent(point.source_document_id)}/source-preview?patient_uuid=${encodeURIComponent(patient_uuid)}&demo_token=${encodeURIComponent(demo_token)}#${citationBoxId(point.citation.field_or_chunk_id)}`;
}

/** Inline SVG for a series with >= 2 points: value against date, reference band, a linked marker per point. */
export function renderTrendSvg(test, links = {}) {
  const { width, height, left, right, top, bottom } = CHART;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const days = test.points.map((point) => dayNumber(point.collection_date));
  const minDay = Math.min(...days);
  const spanDay = Math.max(...days) - minDay;
  const values = test.points.map((point) => point.value);
  const band = test.reference_band;
  let low = Math.min(...values, ...(band ? [band.low] : []));
  let high = Math.max(...values, ...(band ? [band.high] : []));
  const pad = (high - low) * 0.1 || Math.abs(high) * 0.1 || 1;
  low -= pad; high += pad;
  const x = (day) => left + (spanDay ? ((day - minDay) / spanDay) * plotW : plotW / 2);
  const y = (value) => top + (1 - (value - low) / (high - low)) * plotH;
  const unit = test.unit ? ` ${test.unit}` : '';
  const id = `trend-${test.series_id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const title = `${test.test_name}${unit ? ` (${test.unit})` : ''} over time`;
  const desc = `${test.points.length} results from ${test.points[0].collection_date} to ${test.points.at(-1).collection_date}: ${test.points.map((point) => `${point.collection_date} ${formatNumber(point.value)}${unit}`).join('; ')}.${band ? ` Reference range ${band.low}-${band.high}${unit}.` : ' No parseable reference range.'}`;
  const coords = test.points.map((point) => [x(dayNumber(point.collection_date)), y(point.value)].map((n) => n.toFixed(1)));
  const parts = [
    `<svg class="lab-trend-svg" role="img" viewBox="0 0 ${width} ${height}" width="100%" aria-labelledby="${id}-title ${id}-desc">`,
    `<title id="${id}-title">${escapeHtml(title)}</title><desc id="${id}-desc">${escapeHtml(desc)}</desc>`,
    band ? `<rect class="reference-band" x="${left}" y="${y(band.high).toFixed(1)}" width="${plotW}" height="${(y(band.low) - y(band.high)).toFixed(1)}" fill="#d9f2e6"><title>Reference range ${escapeHtml(`${band.low}-${band.high}${unit}`)}</title></rect>` : '',
    `<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#9fb3c8"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#9fb3c8"/>`,
    `<text x="${left - 6}" y="${top + 10}" text-anchor="end" font-size="11" fill="#52606d">${escapeHtml(formatNumber(high))}</text><text x="${left - 6}" y="${top + plotH}" text-anchor="end" font-size="11" fill="#52606d">${escapeHtml(formatNumber(low))}</text>`,
    `<text x="${left}" y="${height - 12}" font-size="11" fill="#52606d">${escapeHtml(test.points[0].collection_date)}</text><text x="${left + plotW}" y="${height - 12}" text-anchor="end" font-size="11" fill="#52606d">${escapeHtml(test.points.at(-1).collection_date)}</text>`,
    `<polyline class="trend-line" fill="none" stroke="#174a7e" stroke-width="2" points="${coords.map(([cx, cy]) => `${cx},${cy}`).join(' ')}"/>`,
    ...test.points.map((point, index) => `<a class="trend-point" href="${escapeHtml(pointHref(point, links))}" target="_blank" data-source-document-id="${escapeHtml(point.source_document_id)}"><circle cx="${coords[index][0]}" cy="${coords[index][1]}" r="5" fill="${point.abnormal_flag === 'normal' ? '#174a7e' : '#b45309'}"><title>${escapeHtml(`${point.collection_date}: ${formatNumber(point.value)}${unit} (${point.abnormal_flag}); open source document`)}</title></circle></a>`),
    '</svg>',
  ];
  return parts.join('');
}

function dataTable(test, links) {
  const rows = test.points.map((point) => `<tr><td>${escapeHtml(point.collection_date)}</td><td>${escapeHtml(formatNumber(point.value))}</td><td>${escapeHtml(point.unit || 'not stated')}</td><td>${escapeHtml(point.reference_range ?? 'not parseable')}</td><td>${escapeHtml(point.abnormal_flag)}</td><td><a class="citation-source-link" href="${escapeHtml(pointHref(point, links))}" target="_blank">[${escapeHtml(point.citation.page_or_section)}]</a></td></tr>`).join('');
  return `<table class="lab-trend-table"><caption>${escapeHtml(test.test_name)} results${test.unit ? ` (${escapeHtml(test.unit)})` : ''}</caption><thead><tr><th scope="col">Collected</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Reference range</th><th scope="col">Flag</th><th scope="col">Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * HTML fragment for the "Lab trends" section: one figure per series, a
 * "one result so far" state for a single point, an explicit empty state,
 * and labeled notes for split units, excluded entries and results the
 * read-back did not return.
 */
export function renderLabTrendSection(trends, links = {}) {
  const synthetic = trends.persistence_boundary !== 'openemr-module';
  const source = synthetic ? 'the in-memory synthetic lab store (fixture mode, not OpenEMR)' : "OpenEMR's FHIR Observation service (read back after the upload)";
  const notes = [];
  if (trends.missing_observation_count) notes.push(`<p class="lab-trend-note" data-reason="observations_missing">${trends.missing_observation_count} stored result(s) were not returned by the read-back and are not shown.</p>`);
  if (trends.skipped_lab_row_count) notes.push(`<p class="lab-trend-note" data-reason="lab_rows_unlinked">${trends.skipped_lab_row_count} stored lab record(s) are not linked to a lab document stored for this patient and are not shown.</p>`);
  if (trends.excluded.length) notes.push(`<p class="lab-trend-note" data-reason="excluded">${trends.excluded.length} result(s) cannot be charted: ${escapeHtml([...new Set(trends.excluded.map((item) => item.reason.replaceAll('_', ' ')))].join(', '))}.</p>`);
  const figures = trends.tests.map((test) => {
    const unitNote = test.other_units.length ? `<p class="lab-trend-note" data-reason="mixed_units">Also reported in ${escapeHtml(test.other_units.map((unit) => unit || 'no unit').join(', '))}. Different units are charted separately, never on one line.</p>` : '';
    const body = test.chart === 'line'
      ? renderTrendSvg(test, links)
      : `<p class="lab-trend-single" data-chart="single_point">One result so far (${escapeHtml(test.points[0].collection_date)}). A trend line needs a second result.</p>`;
    return `<figure class="lab-trend" data-series="${escapeHtml(test.series_id)}" data-chart="${test.chart}"><figcaption><strong>${escapeHtml(test.test_name)}</strong>${test.unit ? ` (${escapeHtml(test.unit)})` : ' (unit not stated)'}</figcaption>${unitNote}${body}${dataTable(test, links)}</figure>`;
  }).join('');
  const empty = trends.tests.length ? '' : '<p class="lab-trend-empty" data-chart="empty">No lab results have been read back for this patient yet.</p>';
  const style = '<style>.lab-trends .lab-trend{margin:.8rem 0;padding:.6rem;border:1px solid #d6e0e3;border-radius:.6rem;background:#fff}.lab-trends .lab-trend-svg{max-width:480px;display:block}.lab-trends .lab-trend-table{border-collapse:collapse;font-size:.82rem;margin-top:.4rem}.lab-trends .lab-trend-table th,.lab-trends .lab-trend-table td{border:1px solid #d6e0e3;padding:.2rem .45rem;text-align:left}.lab-trends .lab-trend-note{color:#9b5b00}</style>';
  return `${style}<section class="lab-trends" aria-labelledby="lab-trends-heading"><h4 id="lab-trends-heading">Lab trends</h4><p class="hint">Read from ${escapeHtml(source)}. Values are unreviewed extractions; each point links to its source document.</p>${notes.join('')}${empty}${figures}</section>`;
}

/**
 * HTTP route: `GET /v1/patients/:patient/lab-trends` (JSON) and
 * `GET /v1/patients/:patient/lab-trends/chart` (the HTML fragment above).
 * Same demo-context check as the neighbouring source-document routes: a
 * read-scoped signed token for exactly this patient. Returns false when the
 * request is not for this route.
 */
export async function handleLabTrendRoute(req, res, { service, verifyToken, json, html, basePath = '', errorStatus, correlationId = null }) {
  const match = req.method === 'GET' ? req.url.match(/^\/v1\/patients\/([^/?]+)\/lab-trends(\/chart)?(?:\?.*)?$/) : null;
  if (!match) return false;
  let patient_uuid;
  try { patient_uuid = decodeURIComponent(match[1]); } catch { json(res, 400, { error: 'invalid_patient' }); return true; }
  const demo_token = new URL(req.url, 'http://localhost').searchParams.get('demo_token') || '';
  const token = verifyToken(demo_token);
  if (!token || token.patient_uuid !== patient_uuid) { json(res, 403, { error: 'invalid_demo_context' }); return true; }
  try {
    const result = await service.readLabTrends({ patient_uuid, clinician_uuid: token.clinician_uuid }, { verifiedContext: token, correlationId });
    if (result.status !== 'read') { json(res, 403, { error: result.reason }); return true; }
    if (match[2]) html(res, renderLabTrendSection(result, { basePath, patient_uuid, demo_token }));
    else json(res, 200, result);
  } catch (error) {
    if (error?.name === 'OpenEMRModuleError') throw error;
    json(res, errorStatus(error), { error: error.code || error.message });
  }
  return true;
}

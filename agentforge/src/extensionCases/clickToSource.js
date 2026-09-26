import { citationBoxId, renderScanSourcePreview } from '../ui.js';

/**
 * X-1 click-to-source: the source preview the deployed `/source-preview`
 * route serves must draw a box on the page image for every citation it links,
 * and every "View source region" link must land on a box that exists (and
 * every box must link back to an evidence row). Rendered from the real
 * post-OCR extraction of a golden PDF, the same call `server.js` makes.
 */
export async function checkClickToSource(run, { minLinks = 1 } = {}) {
  const [sourceId] = run.sourceIds;
  const patient = run.patient;
  const evidence = await run.h.service.extractScanFormEvidence(sourceId, { patient_uuid: patient, clinician_uuid: run.clinician }, { verifiedContext: run.h.context(patient) });
  if (evidence.status === 'blocked' || evidence.status === 'failed' || !evidence.extraction) return [`source_preview_unavailable:${evidence.reason || evidence.status}`];
  const html = renderScanSourcePreview({ sourceDocument: evidence.source_document, extraction: evidence.extraction, pageUrl: (page) => `page-${page}.png` });
  return clickToSourceIssues(html, evidence.extraction, { minLinks });
}

/** Pure check over the rendered preview HTML (exported for unit tests). */
export function clickToSourceIssues(html, extraction, { minLinks = 1 } = {}) {
  const issues = [];
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const links = [...html.matchAll(/class="citation-source-link" href="#([^"]+)"/g)].map((match) => match[1]);
  const boxes = [...html.matchAll(/class="source-box [^"]*" id="([^"]+)" href="#([^"]+)"/g)].map((match) => ({ id: match[1], target: match[2] }));
  if (!/class="pdf-page"/.test(html)) issues.push('no_page_image');
  if (links.length < minLinks) issues.push(`too_few_source_links:${links.length}`);
  for (const target of links) if (!boxes.some((box) => box.id === target)) issues.push(`link_without_box:${target}`);
  for (const box of boxes) if (!ids.has(box.target)) issues.push(`box_without_row:${box.id}`);
  const boxedFacts = (extraction?.facts || []).filter((fact) => fact.citation?.bounding_box?.length === 4);
  for (const fact of boxedFacts) if (!boxes.some((box) => box.id === citationBoxId(fact.citation.field_or_chunk_id))) issues.push(`cited_fact_without_box:${fact.field_id}`);
  return issues;
}

export function clickToSourceCases({ kase, scan }) {
  return [
    kase('x1-click-to-source-lab-a', 'citation_present', 'The source preview stops drawing a box for a cited field, or a "View source region" link no longer lands on its box (click-to-source broken on a vector lab PDF).', scan('lab-a', 'lab_pdf'), { custom: (run) => checkClickToSource(run, { minLinks: 3 }) }),
    kase('x1-click-to-source-intake-b', 'citation_present', 'Click-to-source breaks on a rasterized intake PDF: a cited field has no box on the page image, or a link targets a missing box.', scan('intake-b', 'intake_form'), { custom: (run) => checkClickToSource(run, { minLinks: 3 }) }),
  ];
}

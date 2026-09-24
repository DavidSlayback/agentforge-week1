import { clinicalLabel } from './clinicalLanguage.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const SYNTHETIC_DEMO_PATIENTS = [
  ['fixture-patient-001', 'Test Patient One · complete return visit'],
  ['fixture-patient-002', 'Test Conflict · unresolved latest values'],
  ['fixture-patient-003', 'Test Stale · stale field'],
  ['fixture-patient-004', 'Test Provenance · missing author'],
  ['fixture-patient-005', 'Test Note · untrusted narrative'],
  ['fixture-patient-006', 'Test Partial · failed and timed-out groups'],
  ['fixture-patient-007', 'Test Empty · successful empty lookup'],
  ['fixture-patient-008', 'Test No Baseline · no prior comparison'],
  ['fixture-patient-dup', 'Test Duplicate · duplicate identity'],
];

export function renderAgentForgePage({ token = '', payload = null, publicBasePath = '', liveOpenEMR = false } = {}) {
  const patient = payload?.patient_uuid || '';
  const clinician = liveOpenEMR ? (payload?.clinician_uuid || '') : 'fixture-physician-001';
  const primaryProbePatient = liveOpenEMR ? '' : 'fixture-patient-001';
  const secondaryProbePatient = liveOpenEMR ? '' : 'fixture-patient-006';
  const patientControl = payload
    ? `<input type="hidden" name="patient_uuid" value="${escapeHtml(patient)}"><span class="patient-value" aria-label="Patient">${escapeHtml(patient)}</span>`
    : liveOpenEMR ? '<span class="patient-value" aria-label="Patient">Open this page from an authenticated OpenEMR patient context.</span>' : `<select name="patient_uuid" aria-label="Patient">${SYNTHETIC_DEMO_PATIENTS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AgentForge</title>
<style>
*{box-sizing:border-box}body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:66rem;margin:0 auto;padding:1.25rem;color:#17202a;background:#eef3f8;line-height:1.45}
main{background:#fff;border:1px solid #d9e2ec;border-radius:1rem;padding:clamp(1rem,3vw,2rem);box-shadow:0 8px 28px #17202a12}.eyebrow{color:#53657a;font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.header-row{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.subtitle{color:#52606d;margin:.2rem 0 0}.context{display:flex;flex-wrap:wrap;gap:.5rem;margin:1.2rem 0;padding:.8rem 1rem;border:1px solid #d9e2ec;border-radius:.7rem;background:#f7fbff}.context strong{color:#174a7e}.badge{display:inline-block;border-radius:999px;padding:.25rem .65rem;font-size:.8rem;font-weight:750;background:#e8f1fb;color:#174a7e;white-space:nowrap}.badge[data-disposition="blocked"],.badge[data-disposition="deadline-exceeded"]{background:#fde8e7;color:#9b1c1c}.badge[data-disposition="partial"],.badge[data-disposition="qualified"]{background:#fff4cc;color:#6b4e00}
h1{font-size:clamp(1.7rem,4vw,2.4rem);line-height:1.05;margin:.25rem 0}.section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-top:1.6rem}h2{font-size:1.1rem}h3{font-size:.92rem;margin:0}.hint{color:#66788a;font-size:.82rem}form{display:grid;gap:.6rem;margin:1rem 0}label{font-weight:700;display:grid;gap:.25rem}select,input,button{font:inherit;padding:.68rem .75rem;border:1px solid #9fb3c8;border-radius:.5rem}input:focus,select:focus,button:focus{outline:3px solid #b9d8f5;outline-offset:1px}button{cursor:pointer;background:#174a7e;color:#fff;border-color:#174a7e;font-weight:700}button:hover{background:#123f6b}button.secondary{background:#fff;color:#174a7e}.samples{display:flex;flex-wrap:wrap;gap:.5rem}.samples button{font-size:.88rem}.hidden{display:none!important}.status{min-height:1.5rem;color:#52606d}.status.error{color:#9b1c1c}
#transcript{display:grid;gap:.9rem;list-style:none;padding:0}.message{border:1px solid #d9e2ec;border-radius:.8rem;padding:1rem}.message[data-role="assistant"]{background:#f7fbff}.message[data-role="user"]{background:#f7f7f7}.message header{display:flex;justify-content:space-between;gap:1rem;font-size:.85rem;color:#52606d;margin-bottom:.7rem}.message p{white-space:pre-wrap;margin:.5rem 0}.response-copy{font-size:1rem;margin:0 0 1rem}.briefing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;margin:.8rem 0}.fact-card{background:#fff;border:1px solid #d9e2ec;border-radius:.65rem;padding:.8rem}.fact-label{display:block;color:#66788a;font-size:.76rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.fact-value{display:block;font-size:1.02rem;font-weight:750;margin-top:.2rem}.claim-list{display:grid;gap:.55rem;padding:0;margin:.6rem 0;list-style:none}.claim{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;border-top:1px solid #edf1f5;padding-top:.55rem}.claim:first-child{border-top:0;padding-top:0}.claim-label{color:#52606d}.claim-value{font-weight:700;text-align:right}.evidence{margin-top:.8rem;border-top:1px solid #edf1f5;padding-top:.65rem}.evidence summary{cursor:pointer;color:#174a7e;font-weight:700}.evidence li{margin:.35rem 0;font-size:.85rem;color:#52606d}.qualification{border-left:4px solid #d39e00;padding:.65rem .75rem;margin:.8rem 0;background:#fff9e8}.blocked{border-left-color:#c53030;background:#fff3f2}.empty{color:#66788a}.loading{opacity:.7;cursor:wait}@media(max-width:620px){.header-row{display:block}.briefing-grid{grid-template-columns:1fr}.claim{display:block}.claim-value{text-align:left;margin-top:.2rem}}
</style>
<style>
/* Visual polish for the synthetic return-visit workspace. */
:root{color-scheme:light;--ink:#172b3a;--muted:#5c6f7d;--line:#d8e2e8;--teal:#126b63;--teal-soft:#e3f3ef}
body{max-width:72rem;padding:clamp(.65rem,3vw,1.5rem);color:var(--ink);background:#f2f6f5}
main{border-color:var(--line);border-radius:1.1rem;padding:clamp(1rem,3.4vw,2.25rem);box-shadow:0 14px 42px #173b3510}
.eyebrow{color:var(--teal);letter-spacing:.14em}.subtitle{color:var(--muted)}
.context{align-items:center;border-color:#c9e1dc;border-radius:.8rem;background:#edf7f4}.context strong{color:var(--teal)}
.badge{background:var(--teal-soft);color:#14564f}
.section-heading{margin-top:1.9rem;padding-bottom:.35rem;border-bottom:1px solid #e9eff0}.section-heading h2{margin:.25rem 0 .55rem}
form{gap:.8rem}#source-document-form .section-heading{margin-top:.4rem}
#briefing-form{grid-template-columns:minmax(0,1fr) auto;align-items:end;padding:.25rem 0 .8rem}
#source-document-form{grid-template-columns:repeat(2,minmax(0,1fr));align-items:end;padding:1rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
#source-document-form .section-heading,#source-status{grid-column:1/-1}
#source-document-form button{justify-self:start}
#official-sources{padding:.9rem 1rem;border:1px solid #c9e1dc;border-radius:.8rem;background:#edf7f4}
#official-sources .source-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;margin:.75rem 0}
#synthetic-samples{grid-column:1/-1;padding:.9rem 1rem;border:1px solid #c9e1dc;border-radius:.8rem;background:#edf7f4}
#synthetic-samples .source-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;margin:.65rem 0 0}
#synthetic-samples .sample-card{display:grid;gap:.45rem;padding:.6rem;border:1px solid #c9dcd8;border-radius:.7rem;background:#fff}
#official-sources a{display:block;padding:.75rem;border:1px solid #c9dcd8;border-radius:.65rem;background:#fff;color:#145e58;font-weight:700;text-decoration:none}
#official-sources a span{display:block;color:var(--muted);font-size:.8rem;font-weight:500}
#synthetic-samples a{display:block;padding:.75rem;border:1px solid #c9dcd8;border-radius:.65rem;background:#fff;color:#145e58;font-weight:700;text-decoration:none}
#synthetic-samples a span{display:block;color:var(--muted);font-size:.8rem;font-weight:500}
#scan-sample{margin:.2rem 0}
select,input,button{min-height:44px;border-radius:.65rem}input,select{border-color:#9aafb7;background:#fff}input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #84cfc0;outline-offset:2px}
button{background:#145e58;border-color:#145e58}button:hover{background:#104b47}button.secondary{color:#145e58;border-color:#b9d4cf}button.secondary:hover{background:#edf7f4}
.message{border-color:var(--line);border-radius:.9rem;padding:clamp(.85rem,2vw,1.2rem)}.message[data-role="assistant"]{background:#f3f9f7}.message[data-role="user"]{background:#f7f8f8}
.fact-card{border-color:#d6e4e1;border-radius:.75rem}.fact-label{color:var(--muted)}.evidence summary{color:var(--teal)}
.qualification{border-left-color:#c8962b;background:#fff6df}.blocked{border-left-color:#aa4141;background:#fff1ef}
button:disabled{opacity:.6;cursor:wait}
@media(max-width:620px){#briefing-form,#source-document-form,#official-sources .source-links,#synthetic-samples .source-links{grid-template-columns:1fr}#source-document-form .section-heading,#source-status{grid-column:auto}#source-document-form button,#scan-sample{width:100%}.header-row .badge{margin-top:.65rem}.section-heading{align-items:flex-start;flex-direction:column;gap:.2rem}}
</style>
</head>
<body><main id="agentforge-app">
<header><div class="header-row"><div><div class="eyebrow">AgentForge / return visit</div><h1>Prepare for visit</h1><p class="subtitle">A concise, evidence-linked orientation for the next patient.</p></div><span class="badge">Synthetic demonstration only</span></div>
<div class="context" id="patient-context"><strong>Patient context</strong><span id="context-status">${payload ? `Authorized OpenEMR context: <strong>${escapeHtml(patient)}</strong>` : liveOpenEMR ? 'Open this page from an authenticated OpenEMR patient chart.' : 'Choose an authorized fixture context.'}</span><span class="hint">Read-only · clinician review required</span></div></header>
<section aria-labelledby="conversation-heading"><div class="section-heading"><h2 id="conversation-heading">Visit orientation</h2><span class="hint">Start with the bottom line, then inspect evidence.</span></div><ol id="transcript" role="log" aria-live="polite" aria-relevant="additions"><li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li></ol></section>
<form id="briefing-form"${liveOpenEMR && !payload ? ' class="hidden"' : ''}><label>Patient ${patientControl}</label><input type="hidden" name="demo_token" value="${escapeHtml(token)}"><button type="submit">Prepare briefing</button></form>
<form id="source-document-form"${liveOpenEMR ? ' class="hidden"' : ''}><div class="section-heading"><h2>Scan form workflow</h2><span class="hint">Synthetic local storage · OCR runs on this server</span></div><label>Document schema<select name="document_type"><option value="lab_pdf">Lab scan PDF</option><option value="intake_form">Patient intake form</option></select></label><label>Filled synthetic PDF or .scan.txt envelope<input type="file" name="source_file" accept=".pdf,application/pdf,.scan.txt" required></label><p class="hint">Upload a synthetic filled lab PDF or a .scan.txt envelope. Local OCR (for a PDF) returns cited page regions and worker handoffs; unclear values require review.</p><button type="submit">Read filled form</button><p id="source-status" class="status" role="status"></p></form>
<section id="synthetic-samples" aria-labelledby="synthetic-samples-heading"${liveOpenEMR ? ' hidden' : ''}><h3 id="synthetic-samples-heading">Completed synthetic PDF samples</h3><p class="hint">Fictional patient details. Run a sample here or download it to upload later. Each type has a vector and rasterized layout.</p><div class="source-links"><div class="sample-card"><a href="${escapeHtml(publicBasePath)}/v1/demo-scan-pdf?sample=lab-a" download>Lab result · Layout A<span>Vector PDF · complete results</span></a><button type="button" class="secondary" data-run-pdf-sample="lab-a" data-document-type="lab_pdf">Run this sample</button></div><div class="sample-card"><a href="${escapeHtml(publicBasePath)}/v1/demo-scan-pdf?sample=lab-b" download>Lab result · Layout B<span>Rasterized PDF · alternate labels and values</span></a><button type="button" class="secondary" data-run-pdf-sample="lab-b" data-document-type="lab_pdf">Run this sample</button></div><div class="sample-card"><a href="${escapeHtml(publicBasePath)}/v1/demo-scan-pdf?sample=intake-a" download>Patient intake · Layout A<span>Vector PDF · demographics and history</span></a><button type="button" class="secondary" data-run-pdf-sample="intake-a" data-document-type="intake_form">Run this sample</button></div><div class="sample-card"><a href="${escapeHtml(publicBasePath)}/v1/demo-scan-pdf?sample=intake-b" download>Patient intake · Layout B<span>Rasterized PDF · alternate labels and values</span></a><button type="button" class="secondary" data-run-pdf-sample="intake-b" data-document-type="intake_form">Run this sample</button></div></div></section>
<button id="scan-sample" class="secondary" type="button"${liveOpenEMR ? ' hidden' : ''}>Run sample text-fixture workflow</button>
<section id="official-sources" aria-labelledby="official-sources-heading"><h2 id="official-sources-heading">Public blank PDF references</h2><p class="hint">Agency forms are included as layout references only; these source PDFs are not modified or processed here.</p><div class="source-links"><a href="https://www.fda.gov/media/76299/download" target="_blank" rel="noopener noreferrer">FDA MedWatch Form 3500<span>Official health professional adverse event report · PDF</span></a><a href="https://www.cdc.gov/laboratory/specimen-submission/pdf/form-50-34.pdf" target="_blank" rel="noopener noreferrer">CDC Form 50.34<span>Official legacy specimen submission form · scheduled for retirement October 30, 2026</span></a></div><p class="hint">Source: FDA and CDC. Government agency attribution; AgentForge is not endorsed by either agency. For extraction, use the synthetic completed PDFs above.</p></section>
<form id="followup-form" class="hidden"><label for="followup-input">Ask a follow-up</label><input id="followup-input" name="message" autocomplete="off" placeholder="What changed since the last visit?"><div class="samples" aria-label="Safe sample follow-ups"><button type="button" class="secondary" data-prompt="What changed since the last visit?">Documented changes</button><button type="button" class="secondary" data-prompt="What plan items need follow-through?">Plan follow-through</button><button type="button" class="secondary" data-prompt="Which records conflict?">Conflicting records</button></div><button type="submit">Send follow-up</button></form>
<button id="cross-patient-probe" class="secondary hidden" type="button">Probe cross-patient block</button>
<p id="status" class="status" role="status"></p><button id="reset" class="secondary" type="button">Reset conversation</button>
<details><summary>Evaluator notes</summary><p>Ask only about documented changes, plan follow-through, or conflicting records. Every displayed claim includes its supporting evidence. Partial retrieval is qualified; denied or cross-patient context is blocked.</p><p><a href="${publicBasePath}/observability">Open operations dashboard</a> · <a href="${publicBasePath}/evals">Open evaluator panel</a></p></details>
</main>
<script>
(() => {
  const basePath = location.pathname.startsWith('/agentforge-w2') ? '/agentforge-w2' : location.pathname.startsWith('/agentforge') ? '/agentforge' : '';
  const state = { conversationId: null, patient: null, demoToken: ${JSON.stringify(token).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')} };
  const initialDemoToken = state.demoToken;
  const briefingForm = document.getElementById('briefing-form');
  const sourceDocumentForm = document.getElementById('source-document-form');
  const sourceStatus = document.getElementById('source-status');
  const scanSampleButton = document.getElementById('scan-sample');
  const pdfSampleButtons = [...document.querySelectorAll('[data-run-pdf-sample]')];
  const followupForm = document.getElementById('followup-form');
  const transcript = document.getElementById('transcript');
  const status = document.getElementById('status');
  const contextStatus = document.getElementById('context-status');
  const reset = document.getElementById('reset');
  const crossPatientProbe = document.getElementById('cross-patient-probe');
  const input = document.getElementById('followup-input');
  const patientSelector = briefingForm.querySelector('[name="patient_uuid"]');
  const initialContextStatus = contextStatus?.textContent || '';
  let busy = false;
  const setStatus = (message, error = false) => { status.textContent = message; status.className = error ? 'status error' : 'status'; };
  const setBusy = (value) => { busy = value; if (patientSelector) patientSelector.disabled = value; document.getElementById('agentforge-app').setAttribute('aria-busy', String(value)); [briefingForm, sourceDocumentForm, followupForm].filter(Boolean).forEach((form) => form.querySelectorAll('button').forEach((button) => { button.disabled = value; button.classList.toggle('loading', value); })); if (scanSampleButton) scanSampleButton.disabled = value; pdfSampleButtons.forEach((button) => { button.disabled = value; button.classList.toggle('loading', value); }); crossPatientProbe.disabled = value; };
  const humanize = (value) => String(value ?? '').replaceAll('_', ' ').replaceAll('.', ' · ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const claimGroup = (field) => field.startsWith('encounter.') ? 'Visit reason' : field.startsWith('problem.') ? 'Active concerns' : field.startsWith('medication.') ? 'Medications' : 'Documented facts';
  const clinicalLabel = ${clinicalLabel.toString()};
  const displayLabel = (field) => { const label = clinicalLabel(field); return label.charAt(0).toUpperCase() + label.slice(1); };
  const renderBriefing = (response, container) => {
    const claims = response.claims || [];
    const reason = claims.find((claim) => claim.field === 'encounter.reason');
    const problems = claims.filter((claim) => claim.field.startsWith('problem.'));
    const medications = claims.filter((claim) => claim.field.startsWith('medication.'));
    const summary = document.createElement('p'); summary.className = 'response-copy';
    summary.textContent = response.text || (response.disposition === 'complete' ? 'Here is the documented snapshot for this return visit. Review the supporting records before deciding what matters in the encounter.' : 'No verified patient content was returned.');
    container.append(summary);
    if (reason || problems.length || medications.length) {
      const grid = document.createElement('div'); grid.className = 'briefing-grid';
      if (response.patient?.display_name) grid.append(factCard('Patient', response.patient.display_name));
      if (reason) grid.append(factCard('Visit reason', reason.value));
      if (problems.length) grid.append(factCard('Active concerns', latestClaims(problems).map((claim) => displayLabel(claim.field) + ' (' + claim.value + ')').join('; ')));
      if (medications.length) grid.append(factCard('Medications recorded', latestClaims(medications).map((claim) => displayLabel(claim.field) + ' — ' + claim.value).join('; ')));
      grid.append(factCard('Review focus', response.qualification?.required ? 'Coverage is incomplete; see what is withheld below.' : 'Review the documented facts and source records.'));
      container.append(grid);
    }
    if (claims.length) {
      const details = document.createElement('details'); const summaryLabel = document.createElement('summary'); summaryLabel.textContent = 'Normalized facts'; details.append(summaryLabel);
      const groups = new Map(); claims.forEach((claim) => { const group = claimGroup(claim.field); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(claim); });
      groups.forEach((groupClaims, group) => { const heading = document.createElement('h3'); heading.textContent = group; details.append(heading); const list = document.createElement('ul'); list.className = 'claim-list'; groupClaims.forEach((claim) => { const row = document.createElement('li'); row.className = 'claim'; const label = document.createElement('span'); label.className = 'claim-label'; label.textContent = humanize(claim.field.split('.').slice(1).join(' ')); const value = document.createElement('span'); value.className = 'claim-value'; value.textContent = claim.value; row.append(label, value); list.append(row); }); details.append(list); });
      container.append(details);
    }
  };
  const latestClaims = (claims) => { const latest = new Map(); claims.forEach((claim) => { const recordedAt = claim.evidence?.[0]?.recorded_at || ''; const previous = latest.get(claim.field); if (!previous || recordedAt > previous.recordedAt) latest.set(claim.field, { claim, recordedAt }); }); return [...latest.values()].map(({ claim }) => claim); };
  const renderFollowUp = (response, container) => { const answer = document.createElement('p'); answer.className = 'response-copy'; answer.textContent = response.text || (['blocked', 'deadline-exceeded'].includes(response.disposition) ? 'No verified patient content was returned.' : 'No response text was supplied.'); container.append(answer); };
  const factCard = (label, value) => { const card = document.createElement('div'); card.className = 'fact-card'; const title = document.createElement('span'); title.className = 'fact-label'; title.textContent = label; const content = document.createElement('span'); content.className = 'fact-value'; content.textContent = value; card.append(title, content); return card; };
  const addMessage = (role, text, response = null, kind = 'briefing') => {
    document.getElementById('empty-state')?.remove();
    const item = document.createElement('li'); item.className = 'message'; item.dataset.role = role; item.tabIndex = -1;
    const header = document.createElement('header'); header.textContent = role === 'assistant' ? 'AgentForge' : 'Clinician'; item.append(header);
    if (role === 'assistant' && response) { if (kind === 'briefing') renderBriefing(response, item); else renderFollowUp(response, item); } else { const paragraph = document.createElement('p'); paragraph.textContent = text || (['blocked', 'deadline-exceeded'].includes(response?.disposition) ? 'No verified patient content was returned.' : 'No response text was supplied.'); item.append(paragraph); }
    if (response) {
      const badge = document.createElement('span'); badge.className = 'badge'; badge.dataset.disposition = response.disposition || 'complete'; badge.textContent = response.disposition || 'response'; header.append(badge);
      if (response.qualification?.required) { const note = document.createElement('p'); note.className = 'qualification' + (['blocked', 'deadline-exceeded'].includes(response.disposition) ? ' blocked' : ''); note.textContent = 'Qualified: ' + ((response.qualification.reasons || []).join(', ') || 'coverage is incomplete'); item.append(note); }
      if (response.withheld_fields?.length) { const note = document.createElement('p'); note.className = 'qualification'; note.textContent = 'Withheld fields: ' + response.withheld_fields.join(', '); item.append(note); }
      if (response.disposition === 'blocked') { const note = document.createElement('p'); note.className = 'qualification blocked'; note.textContent = 'Blocked before patient data was returned.'; item.append(note); }
      if (response.disposition === 'deadline-exceeded') { const note = document.createElement('p'); note.className = 'qualification blocked'; note.textContent = 'Deadline exceeded before verified patient content was returned.'; item.append(note); }
      const evidence = [...new Map((response.claims || []).flatMap((claim) => claim.evidence || response.evidence || []).map((entry) => [String(entry.source_ref || '') + '|' + String(entry.recorded_at || '') + '|' + String(entry.record_type || ''), entry])).values()];
      if (evidence.length) { const details = document.createElement('details'); details.className = 'evidence'; const summary = document.createElement('summary'); summary.textContent = 'Source records (' + evidence.length + ')'; details.append(summary); const list = document.createElement('ul'); evidence.forEach((entry) => { const row = document.createElement('li'); const date = entry.recorded_at ? new Date(entry.recorded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unavailable'; row.textContent = [entry.record_type || 'record', entry.source_ref ? 'source ' + entry.source_ref : 'source unavailable', date, entry.author || 'author unavailable', entry.excerpt ? '"' + entry.excerpt + '"' : 'excerpt unavailable'].join(' · '); list.append(row); }); details.append(list); item.append(details); }
    }
    transcript.append(item); item.scrollIntoView?.({ block: 'nearest' }); if (role === 'assistant') item.focus({ preventScroll: true });
  };
  const request = async (path, body, timeoutMs = 45000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(basePath + path, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')'); return data; } catch (error) { if (error.name === 'AbortError') throw new Error('Request timed out before a verified response was available.'); throw error; } finally { clearTimeout(timer); } };
  const bytesToBase64 = (bytes) => { let binary = ''; const chunk = 0x8000; for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length))); return btoa(binary); };
  const authorizedRequest = (extra, includeDemoToken = true) => ({ ...extra, clinician_uuid: ${JSON.stringify(clinician)}, ...(includeDemoToken && state.demoToken ? { demo_token: state.demoToken } : {}) });
  const preparationButton = briefingForm.querySelector('button[type="submit"]');
  let preparation = null;
  let generation = 0;
  const beginPreparation = () => {
    const version = ++generation;
    const patient = patientSelector?.value;
    if (!patient || ${liveOpenEMR && !payload}) return null;
    preparationButton.textContent = 'Prepare briefing';
    setStatus('Preparing in the background… You can open it when ready.');
    preparation = (async () => {
      try {
        let token = initialDemoToken;
        if (!${liveOpenEMR}) {
          const contextResponse = await fetch(basePath + '/v1/demo-context?patient_uuid=' + encodeURIComponent(patient));
          if (!contextResponse.ok) throw new Error('Patient context is unavailable.');
          token = (await contextResponse.json()).demo_token;
        }
        if (version !== generation) return {};
        state.demoToken = token;
        const response = await request('/v1/briefings', authorizedRequest({ patient_uuid: patient }), 120000);
        if (version !== generation) return {};
        const unavailable = ['blocked', 'deadline-exceeded'].includes(response.disposition);
        preparationButton.textContent = unavailable ? 'Review preparation status' : 'Open prepared briefing';
        if (!busy) setStatus(unavailable ? 'Preparation needs review.' : 'Briefing prepared. Ready to open.');
        return { response };
      } catch (error) {
        if (version === generation && !busy) setStatus(error.message, true);
        return { error };
      }
    })();
    return preparation;
  };
  briefingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('Opening briefing…');
    const patient = patientSelector.value;
    try {
      let result = await (preparation || beginPreparation());
      if (result.error) throw result.error;
      let response = result.response;
      if (!response) throw new Error('Patient context changed. Open the selected patient again.');
      if (!['blocked', 'deadline-exceeded'].includes(response.disposition)) {
        // Opening always rechecks authorization and server cache expiry.
        if (!${liveOpenEMR}) {
          const contextResponse = await fetch(basePath + '/v1/demo-context?patient_uuid=' + encodeURIComponent(patient));
          if (!contextResponse.ok) throw new Error('Patient context is unavailable.');
          state.demoToken = (await contextResponse.json()).demo_token;
        }
        try {
          response = await request('/v1/prewarm/' + encodeURIComponent(response.correlation_id) + '/open', authorizedRequest({ patient_uuid: patient, reset_conversation: true }));
        } catch (error) {
          if (error.message !== 'preparation_not_available') throw error;
          setStatus('The prepared briefing expired. Refreshing…');
          result = await beginPreparation();
          if (result.error) throw result.error;
          response = result.response;
        }
      }
      state.conversationId = response.correlation_id;
      state.patient = response.context?.patient_ref || response.patient?.patient_ref || patient;
      if (contextStatus) contextStatus.textContent = 'Authorized context: ' + (response.patient?.display_name || state.patient);
      transcript.replaceChildren();
      addMessage('assistant', response.text, response, 'briefing');
      const unavailable = ['blocked', 'deadline-exceeded'].includes(response.disposition);
      followupForm.classList.toggle('hidden', unavailable);
      crossPatientProbe.classList.toggle('hidden', unavailable || ${liveOpenEMR});
      setStatus(unavailable ? 'Briefing unavailable; no verified patient content was displayed.' : 'Prepared briefing opened. Ready for follow-up.');
    } catch (error) {
      preparation = null;
      preparationButton.textContent = 'Prepare briefing';
      setStatus(error.message, true);
    } finally { setBusy(false); }
  });
  const uploadSourceDocument = async (file) => {
    if (busy) return;
    const patient = patientSelector?.value || state.patient;
    if (!file || !patient) return setStatus('Choose a synthetic patient and source file first.', true);
    setBusy(true);
    sourceStatus.textContent = 'Uploading synthetic source evidence…';
    try {
      const contextResponse = await fetch(basePath + '/v1/source-document-context?patient_uuid=' + encodeURIComponent(patient));
      if (!contextResponse.ok) throw new Error('Source-document context is unavailable.');
      const writeContext = await contextResponse.json();
      if (!state.demoToken || state.patient !== patient) {
        const readContextResponse = await fetch(basePath + '/v1/demo-context?patient_uuid=' + encodeURIComponent(patient));
        if (!readContextResponse.ok) throw new Error('Patient context is unavailable.');
        state.demoToken = (await readContextResponse.json()).demo_token;
        state.patient = patient;
      }
      const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const result = await request('/v1/source-documents', { patient_uuid: patient, clinician_uuid: ${JSON.stringify(clinician)}, demo_token: writeContext.demo_token, document_type: sourceDocumentForm.elements.document_type.value, filename: file.name, content_base64: content });
      // Every accepted upload (PDF or .scan.txt) runs the scan supervisor;
      // there is no other extraction path.
      // The write-scoped context lets the server persist derived facts to
      // OpenEMR; a read token extracts but is refused persistence.
      const documentType = sourceDocumentForm.elements.document_type.value;
      const retrievalQuery = documentType === 'lab_pdf' ? 'documented glycemic values medication adherence' : 'medication reconciliation current documented list prior records';
      const workflow = await request('/v1/scan-supervisor', { patient_uuid: patient, clinician_uuid: ${JSON.stringify(clinician)}, demo_token: writeContext.demo_token, source_document_id: result.source_document.id, message: retrievalQuery });
      const active = workflow.workflow;
      const workflowSummary = 'Scan workers: ' + active.handoffs.map((handoff) => handoff.worker).join(' → ') + '. Extractor: ' + active.typed_outputs.extraction.provider + '. Final state: ' + active.final_state + (active.qualification?.reasons?.length ? ' (' + active.qualification.reasons.join(', ') + ')' : '') + '; ' + active.typed_outputs.extraction.facts.length + ' cited field(s).';
      const guidelineEvidence = active.typed_outputs.evidence?.guideline_evidence || [];
      setStatus('Synthetic scan workflow completed with ' + active.final_state + ' status.');
      sourceStatus.textContent = (result.duplicate ? 'Existing synthetic source reused; ' : 'Synthetic source stored; ') + workflowSummary;
      const preview = document.createElement('a');
      preview.href = basePath + '/v1/source-documents/' + encodeURIComponent(result.source_document.id) + '/source-preview?patient_uuid=' + encodeURIComponent(patient) + '&demo_token=' + encodeURIComponent(state.demoToken);
      preview.textContent = 'Open source preview';
      preview.target = '_blank';
      sourceStatus.append(document.createTextNode(' '), preview);
      const evidencePanel = document.createElement('details');
      const evidenceHeading = document.createElement('summary');
      evidenceHeading.textContent = 'Guideline evidence (' + guidelineEvidence.length + ')';
      evidencePanel.append(evidenceHeading);
      if (guidelineEvidence.length) {
        for (const item of guidelineEvidence) {
          const card = document.createElement('article');
          const title = document.createElement('strong');
          title.textContent = item.title + ' · ' + item.version;
          const section = document.createElement('p');
          section.textContent = item.section;
          const quote = document.createElement('blockquote');
          quote.textContent = item.citation.quote_or_value;
          const location = document.createElement('small');
          location.textContent = 'Source: ' + item.citation.page_or_section;
          card.append(title, section, quote, location);
          evidencePanel.append(card);
        }
      } else {
        const empty = document.createElement('p');
        empty.textContent = 'No guideline source met the retrieval threshold; the workflow stays qualified.';
        evidencePanel.append(empty);
      }
      sourceStatus.append(document.createTextNode(' '), evidencePanel);
      sourceDocumentForm.reset();
    } catch (error) { sourceStatus.textContent = error.message; sourceStatus.className = 'status error'; }
    finally { setBusy(false); }
  };
  sourceDocumentForm?.addEventListener('submit', (event) => { event.preventDefault(); uploadSourceDocument(sourceDocumentForm.elements.source_file.files[0]); });
  pdfSampleButtons.forEach((button) => button.addEventListener('click', async () => {
    const sample = button.dataset.runPdfSample;
    try {
      const response = await fetch(basePath + '/v1/demo-scan-pdf?sample=' + encodeURIComponent(sample));
      if (!response.ok) throw new Error('Synthetic PDF sample is unavailable.');
      sourceDocumentForm.elements.document_type.value = button.dataset.documentType;
      const file = new File([await response.blob()], 'agentforge-' + sample + '-synthetic.pdf', { type: 'application/pdf' });
      await uploadSourceDocument(file);
    } catch (error) { sourceStatus.textContent = error.message; sourceStatus.className = 'status error'; }
  }));
  scanSampleButton?.addEventListener('click', async () => {
    if (busy) return;
    sourceStatus.className = 'status'; sourceStatus.textContent = 'Loading the included synthetic scan sample…';
    try {
      const response = await fetch(basePath + '/v1/demo-scan-fixture');
      if (!response.ok) throw new Error('Synthetic sample is unavailable.');
      const sample = await response.json();
      if (!sample.synthetic_only) throw new Error('Sample source could not be verified.');
      sourceDocumentForm.elements.document_type.value = sample.document_type;
      await uploadSourceDocument(new File([Uint8Array.from(atob(sample.content_base64), (character) => character.charCodeAt(0))], sample.filename, { type: 'text/plain' }));
    } catch (error) { sourceStatus.textContent = error.message; sourceStatus.className = 'status error'; }
  });
  followupForm.addEventListener('submit', async (event) => { event.preventDefault(); if (busy) return; const message = input.value.trim(); if (!state.conversationId || !state.patient || !message) return setStatus('Prepare a briefing and enter a question first.', true); setBusy(true); addMessage('user', message); setStatus('Checking the patient-scoped conversation…'); try { const response = await request('/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: state.patient, message })); addMessage('assistant', response.text, response, 'followup'); setStatus(response.disposition === 'blocked' ? 'Follow-up blocked at the patient-scope boundary.' : response.disposition === 'deadline-exceeded' ? 'Follow-up deadline exceeded before verified content was available.' : 'Follow-up complete.'); input.value = ''; } catch (error) { setStatus(error.message, true); } finally { setBusy(false); } });
  crossPatientProbe.addEventListener('click', async () => { if (busy) return; if (!state.conversationId || !state.patient) return setStatus('Prepare a briefing first.', true); setBusy(true); const otherPatient = state.patient === ${JSON.stringify(primaryProbePatient)} ? ${JSON.stringify(secondaryProbePatient)} : ${JSON.stringify(primaryProbePatient)}; addMessage('user', 'Probe cross-patient context: ' + otherPatient); setStatus('Checking the patient-scope boundary…'); try { const response = await request('/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: otherPatient, message: 'What changed?' }, false)); addMessage('assistant', response.text, response, 'followup'); setStatus(response.disposition === 'blocked' ? 'Cross-patient follow-up blocked without disclosure.' : 'Unexpected cross-patient response.', response.disposition !== 'blocked'); } catch (error) { setStatus(error.message, true); } finally { setBusy(false); } });
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prompt; input.focus(); }));
  patientSelector?.addEventListener('change', () => { if (busy) return; state.conversationId = null; state.patient = null; state.demoToken = ''; transcript.innerHTML = '<li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li>'; followupForm.classList.add('hidden'); crossPatientProbe.classList.add('hidden'); if (contextStatus) contextStatus.textContent = 'New patient selected. Preparing the authorized context.'; setStatus('Patient changed; previous conversation cleared.'); beginPreparation(); });
  reset.addEventListener('click', () => { if (busy) return; state.conversationId = null; state.patient = null; state.demoToken = initialDemoToken; transcript.innerHTML = '<li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li>'; followupForm.classList.add('hidden'); crossPatientProbe.classList.add('hidden'); if (contextStatus) contextStatus.textContent = initialContextStatus; setStatus('Conversation reset.'); beginPreparation(); });
  beginPreparation();
})();
</script></body></html>`;
}

export function renderEvaluatorPage({ golden, errorAnalysis, w2Gate = null, basePath = '', localReport = false }) {
  const goldenGate = golden?.gate_passed ? 'PASSED' : 'FAILED';
  const errorGate = errorAnalysis?.gate_passed ? 'PASSED' : 'FAILED';
  const rate = Math.round(Number(errorAnalysis?.detection_rate || 0) * 100);
  const w2GateLabel = w2Gate?.passed ? 'PASSED' : 'FAILED';
  const w2Passed = w2Gate?.by_label ? Object.values(w2Gate.by_label).reduce((sum, summary) => sum + summary.passed, 0) : '—';
  const w2Failures = w2Gate?.by_label ? Object.values(w2Gate.by_label).reduce((sum, summary) => sum + summary.cases - summary.passed, 0) : '—';
  const route = (path) => `${basePath}${path}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentForge evaluator panel</title>
<style>body{font-family:system-ui,sans-serif;max-width:68rem;margin:2rem auto;padding:0 1rem;color:#17202a;background:#f7f9fb}main{background:#fff;border:1px solid #d9e2ec;border-radius:.75rem;padding:1.25rem;box-shadow:0 2px 8px #17202a12}.badge{display:inline-block;border-radius:999px;padding:.2rem .55rem;font-size:.8rem;font-weight:650;background:#e8f1fb;color:#174a7e}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.65rem}.card{border:1px solid #d9e2ec;border-radius:.5rem;padding:.7rem}.value{display:block;font-size:1.35rem;font-weight:700}.muted{color:#52606d;font-size:.9rem}.pass{color:#087443}.warn{color:#6b4e00;background:#fff8df;border-left:4px solid #d49b00;padding:.75rem}.links,.prompts{display:grid;gap:.4rem}.links a{font-weight:650}.links span{color:#52606d;font-size:.9rem}</style></head>
<body><main id="evaluator-panel"><header><h1>AgentForge evaluator panel</h1><p><span class="badge">Synthetic evidence</span> Same-origin operational links and saved evaluation reports.</p></header>
<section aria-labelledby="ops-heading"><h2 id="ops-heading">Operational surfaces</h2><div class="links">
<a href="${route('/health')}">Health</a><span>Liveness only; expected HTTP 200.</span>
<a href="${route('/ready')}">Readiness</a><span>Retrieval, model, and trace dependencies; expected HTTP 200 when ready.</span>
<a href="${route('/v1/metrics')}">Metrics</a><span>Redacted request, error, latency, verification, and display counters.</span>
<a href="${route('/v1/traces')}">Traces</a><span>Redacted correlation-continuous trace records.</span>
<a href="${route('/v1/alerts')}">Alerts</a><span>Deterministic p95 latency, error-rate, and tool-failure rules with thresholds.</span>
<a href="${route('/observability')}">Observability view</a><span>Browser-readable metrics and trace dashboard.</span>
</div></section>
<section aria-labelledby="prompt-heading"><h2 id="prompt-heading">Safe sample prompts</h2><div class="prompts"><span>“What changed since the last visit?”</span><span>“What plan items need follow-through?”</span><span>“Which records conflict?”</span><span>Failure probes: partial retrieval, denied authorization, cross-patient scope, malformed request.</span></div></section>
<section aria-labelledby="golden-heading"><h2 id="golden-heading">${localReport ? 'Current local golden evidence' : 'Week 1 baseline evidence · saved results'}</h2><div class="cards"><div class="card"><span class="value">${golden?.total_cases ?? '—'}</span><span class="muted">total cases</span></div><div class="card"><span class="value pass">${golden?.passed_cases ?? '—'}</span><span class="muted">passed</span></div><div class="card"><span class="value">${golden?.failed_cases ?? '—'}</span><span class="muted">failed</span></div><div class="card"><span class="value">${golden?.critical_failures ?? '—'}</span><span class="muted">critical failures</span></div><div class="card"><span class="value pass">${goldenGate}</span><span class="muted">golden gate</span></div></div><p><a href="${route(localReport ? '/evals/active-service-results.json' : '/evals/deployed-service-results.json')}">${localReport ? 'Current local service report' : 'Saved Week 1 service report'}</a></p></section>
<section aria-labelledby="mutation-heading"><h2 id="mutation-heading">Mutation/error analysis</h2><div class="cards"><div class="card"><span class="value">${errorAnalysis?.total_mutations ?? '—'}</span><span class="muted">mutations</span></div><div class="card"><span class="value pass">${errorAnalysis?.detected_mutations ?? '—'}</span><span class="muted">detected</span></div><div class="card"><span class="value">${errorAnalysis?.missed_mutations ?? '—'}</span><span class="muted">missed</span></div><div class="card"><span class="value pass">${rate}%</span><span class="muted">detection rate</span></div><div class="card"><span class="value pass">${errorGate}</span><span class="muted">mutation gate</span></div></div><p><a href="${route('/evals/error-analysis.json')}">Saved error-analysis report</a></p></section>
<section aria-labelledby="w2-heading"><h2 id="w2-heading">W2 regression gate</h2><div class="cards"><div class="card"><span class="value">${w2Gate?.total_cases ?? '—'}</span><span class="muted">cases</span></div><div class="card"><span class="value pass">${w2Passed}</span><span class="muted">passed</span></div><div class="card"><span class="value">${w2Failures}</span><span class="muted">failed</span></div><div class="card"><span class="value pass">${w2GateLabel}</span><span class="muted">blocking gate</span></div></div><p><a href="${route('/evals/w2-baseline.json')}">Current W2 baseline/gate metadata</a></p></section>
<p class="warn"><strong>Limitations:</strong> these are synthetic fixture and harness results. They demonstrate contract sensitivity and observable behavior; they do not prove clinical safety, OpenEMR authorization parity, provider suitability, or production PHI compliance.</p>
</main></body></html>`;
}

export function citationBoxId(fieldOrChunkId) {
  return `box-${String(fieldOrChunkId).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function renderScanSourcePreview({ sourceDocument, extraction, basePath = '', patient_uuid = '', demo_token = '', pageUrl = null }) {
  const allFacts = extraction?.facts || [];
  const confidenceOf = (fact) => Number.isFinite(fact.confidence) ? fact.confidence : 0;
  const facts = allFacts.filter((fact) => confidenceOf(fact) >= 0.85 && !fact.uncertainty);
  const lowConfidenceFacts = allFacts.filter((fact) => confidenceOf(fact) < 0.85 || fact.uncertainty);
  const lowConfidenceIds = new Set(lowConfidenceFacts.map((fact) => fact.field_id));
  const missing = extraction?.missing_fields || [];
  const uncertain = extraction?.uncertain_fields || [];
  const conflicts = extraction?.conflicts || [];
  const reviewCount = missing.length + uncertain.length + conflicts.length;
  const status = ['complete', 'partial', 'qualified', 'blocked'].includes(extraction?.status) ? extraction.status : 'unknown';
  const pageSizes = new Map((extraction?.page_sizes || []).map((size) => [size.page, size]));
  const isPdf = /\.pdf$/i.test(sourceDocument?.filename || '');
  const pageNumberFor = (fact) => Number(fact.citation.page_or_section.match(/page\s+(\d+)/i)?.[1] || 0);
  const hasPageImages = isPdf && pageSizes.size > 0;
  const imageUrlFor = (page) => {
    if (pageUrl) return pageUrl(page);
    const params = new URLSearchParams({ patient_uuid, demo_token });
    return `${basePath}/v1/source-documents/${encodeURIComponent(sourceDocument?.id || '')}/pages/${page}.png?${params}`;
  };
  const percent = (value, total) => `${Number((value / total * 100).toFixed(4))}%`;
  const evidenceRow = (fact) => {
    const box = (fact.citation.bounding_box || []).join(',');
    const coordinateSpace = fact.citation.coordinate_space === 'raster_pixels_200dpi' ? '200 DPI raster pixels' : 'fixture coordinates';
    const pageSize = pageSizes.get(pageNumberFor(fact));
    const canLink = hasPageImages && pageSize && fact.citation.bounding_box?.length === 4;
    const citationLink = canLink ? `<a class="citation-source-link" href="#${citationBoxId(fact.citation.field_or_chunk_id)}">View source region</a>` : '';
    const rowId = `row-${citationBoxId(fact.citation.field_or_chunk_id).slice(4)}`;
    return `<article class="evidence-row" id="${rowId}" data-field-id="${escapeHtml(fact.field_id)}"><div class="evidence-value"><span class="field-id">${escapeHtml(fact.field_id)}</span><strong>${escapeHtml(fact.value)}</strong></div><div class="citation" data-bounding-box="${escapeHtml(box)}"><div class="citation-meta"><span>${escapeHtml(fact.citation.page_or_section)}</span><span>Region <code>[${escapeHtml(box)}]</code></span><span>${coordinateSpace}</span>${citationLink}</div><p>${escapeHtml(fact.citation.quote_or_value)}</p></div></article>`;
  };
  const factRows = facts.map(evidenceRow).join('');
  const lowConfidenceRows = lowConfidenceFacts.map(evidenceRow).join('');
  const reviewGroups = [
    ['Missing fields', missing],
    ['Needs a closer look', uncertain.filter((item) => !lowConfidenceIds.has(item.field_id))],
    ['Conflicting values', conflicts],
  ].filter(([, items]) => items.length).map(([label, items]) => `<section class="review-group"><h3>${label}</h3><ul>${items.map((item) => {
    const name = item.field_id || 'Unspecified field';
    const detail = Array.isArray(item.values) ? item.values.join(' / ') : item.reason;
    return `<li><strong>${escapeHtml(name)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</li>`;
  }).join('')}</ul></section>`).join('');
  const pageImages = hasPageImages ? [...pageSizes.values()].sort((a, b) => a.page - b.page).map((size) => {
    const boxes = allFacts.filter((fact) => pageNumberFor(fact) === size.page && fact.citation.bounding_box?.length === 4).map((fact) => {
      const [x1, y1, x2, y2] = fact.citation.bounding_box;
      const confidenceClass = confidenceOf(fact) >= 0.85 && !fact.uncertainty ? 'source-box--verified' : 'source-box--review';
      const style = `left:${percent(x1, size.width)};top:${percent(y1, size.height)};width:${percent(x2 - x1, size.width)};height:${percent(y2 - y1, size.height)}`;
      const rowId = `row-${citationBoxId(fact.citation.field_or_chunk_id).slice(4)}`;
      return `<a class="source-box ${confidenceClass}" id="${citationBoxId(fact.citation.field_or_chunk_id)}" href="#${rowId}" style="${style}" aria-label="View citation for ${escapeHtml(fact.field_id)}"></a>`;
    }).join('');
    return `<div class="pdf-page" data-page="${size.page}" aria-label="Page ${size.page}"><img src="${escapeHtml(imageUrlFor(size.page))}" alt="Page ${size.page} of ${escapeHtml(sourceDocument?.filename || 'source document')}"><div class="page-overlay">${boxes}</div></div>`;
  }).join('') : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Source evidence · AgentForge</title>
  <style>
    :root{color-scheme:light;--ink:#172b3a;--muted:#5c6f7d;--line:#d8e2e8;--paper:#fff;--canvas:#f2f6f5;--teal:#126b63;--teal-soft:#e3f3ef;--amber:#815600;--amber-soft:#fff4d9;--red:#9c3434;--red-soft:#fff0ee}
    *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .topbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.9rem max(1.25rem,calc((100vw - 70rem)/2));background:#123c42;color:#f2fbf8}
    .brand{font-weight:800;letter-spacing:.02em;color:inherit;text-decoration:none}.brand span{margin-left:.55rem;color:#b9d8d1;font-size:.78rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
    .badge,.status{display:inline-flex;align-items:center;border-radius:999px;padding:.28rem .7rem;font-size:.78rem;font-weight:750;white-space:nowrap}.badge{background:#d8eee8;color:#174d48}.status[data-status="complete"]{background:var(--teal-soft);color:var(--teal)}.status[data-status="partial"],.status[data-status="qualified"]{background:var(--amber-soft);color:var(--amber)}.status[data-status="blocked"]{background:var(--red-soft);color:var(--red)}.status[data-status="unknown"]{background:#e9eef1;color:#435663}
    main{width:min(calc(100% - 2rem),70rem);margin:2rem auto 4rem}.back-link{display:inline-flex;align-items:center;min-height:44px;color:var(--teal);font-weight:700;text-decoration:none}.back-link:hover{text-decoration:underline}
    .hero{padding:1.3rem 0 1.1rem;border-bottom:1px solid var(--line)}.eyebrow{margin:0 0 .45rem;color:var(--teal);font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.hero-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}h1{margin:0;font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.12;overflow-wrap:anywhere}.meta{margin:.65rem 0 0;color:var(--muted);font-size:.9rem}.meta code{overflow-wrap:anywhere}
    .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.5rem;padding:1.2rem 0;border-bottom:1px solid var(--line)}.summary-item{display:flex;align-items:baseline;gap:.55rem}.summary-item strong{font-size:1.45rem;font-variant-numeric:tabular-nums}.summary-item span{color:var(--muted);font-size:.88rem}
    .notice{margin:1.4rem 0;padding:1rem 1.1rem;border-left:4px solid #d8a638;background:var(--amber-soft);color:#573e08}.notice strong{display:block;margin-bottom:.35rem}.review-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem;margin-top:.8rem}.review-group h3{margin:0 0 .4rem;font-size:.9rem}.review-group ul{margin:0;padding:0;list-style:none}.review-group li{display:grid;gap:.1rem;padding:.45rem 0;border-top:1px solid #e5d8b6;font-size:.84rem}.review-group li span{color:#6a5526}
    .section-title{margin:1.8rem 0 .2rem;font-size:1.25rem}.section-intro{margin:0 0 .8rem;color:var(--muted);font-size:.9rem}.evidence-list{border-top:1px solid var(--line)}.evidence-row{display:grid;grid-template-columns:minmax(10rem,.7fr) minmax(0,1.3fr);gap:1.5rem;padding:1rem 0;border-bottom:1px solid var(--line)}.evidence-value{display:grid;align-content:start;gap:.3rem}.field-id{color:var(--muted);font-size:.78rem;font-weight:700;letter-spacing:.025em}.evidence-value strong{font-size:1.06rem}.citation{min-width:0;padding-left:1rem;border-left:2px solid #9dcfc5}.citation-meta{display:flex;flex-wrap:wrap;gap:.4rem 1rem;color:var(--teal);font-size:.8rem;font-weight:750}.citation code{color:var(--ink);font-size:.78rem;font-weight:600;overflow-wrap:anywhere}.citation p{margin:.45rem 0 0;color:#405563;font-size:.9rem}.citation-source-link{color:var(--teal)}.pdf-pages{display:grid;gap:1rem}.pdf-page{position:relative;width:min(100%,55rem);margin:0 auto;background:#fff;box-shadow:0 2px 10px #172b3a20}.pdf-page img{display:block;width:100%;height:auto}.page-overlay{position:absolute;inset:0}.source-box{position:absolute;display:block;border:2px solid;cursor:pointer;text-decoration:none}.source-box--verified{border-color:#087f6b;background:#087f6b24}.source-box--review{border-color:#b77900;background:#f0b42935}.source-box:target{z-index:2;border:4px solid #c22e2e;background:#f0444430;box-shadow:0 0 0 3px #fff,0 0 0 6px #c22e2e}
    .empty{padding:1.2rem 0;color:var(--muted)}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--line)}footer a{display:inline-flex;align-items:center;min-height:44px;color:var(--teal);font-weight:750;text-decoration:none}footer a:hover{text-decoration:underline}
    @media(max-width:600px){.topbar{padding:.8rem 1rem}.brand span{display:block;margin:.1rem 0 0}.topbar .badge{font-size:.7rem}main{width:min(calc(100% - 1.25rem),70rem);margin-top:1rem}.hero-row{display:grid}.summary{gap:.5rem;grid-template-columns:1fr}.summary-item{justify-content:flex-start}.evidence-row{grid-template-columns:1fr;gap:.55rem}.citation{padding:.2rem 0 .1rem .8rem}}
    @media print{body{background:#fff}.topbar{background:#fff;color:var(--ink);border-bottom:1px solid var(--line);padding:.5rem 0}.badge{border:1px solid var(--line)}main{width:100%;margin:1rem 0}.back-link,footer{display:none}.notice{break-inside:avoid}}
  </style>
</head>
<body>
  <div class="topbar"><a class="brand" href="${escapeHtml(basePath)}/">AgentForge <span>evidence review</span></a><span class="badge">Synthetic source preview</span></div>
  <main id="source-preview">
    <a class="back-link" href="${escapeHtml(basePath)}/">← Return to visit workspace</a>
    <header class="hero"><p class="eyebrow">Source document</p><div class="hero-row"><div><h1>${escapeHtml(sourceDocument?.filename || 'Source document')}</h1><p class="meta">Document ID <code>${escapeHtml(sourceDocument?.id || 'unavailable')}</code></p></div><span class="status" data-status="${status}">Extraction ${escapeHtml(status)}</span></div></header>
    <section class="summary" aria-label="Extraction summary"><div class="summary-item"><strong>${facts.length}</strong><span>verified fields</span></div><div class="summary-item"><strong>${extraction?.metrics?.pages ?? '—'}</strong><span>pages processed</span></div><div class="summary-item"><strong>${reviewCount}</strong><span>items needing review</span></div></section>
    ${reviewCount ? `<aside class="notice" aria-labelledby="review-heading"><strong id="review-heading">Human review required</strong><span>Values listed here are incomplete, uncertain, or conflicting. They are not promoted as verified facts.</span><div class="review-groups">${reviewGroups}</div></aside>` : ''}
    ${pageImages ? `<section aria-label="PDF page images and citation overlays"><h2 class="section-title">PDF source pages</h2><p class="section-intro">Green boxes are higher confidence; amber boxes need review. Select a citation below to highlight its source region.</p><div class="pdf-pages">${pageImages}</div></section>` : (isPdf ? '<p class="empty">page geometry unavailable</p>' : '<p class="empty">no page image for fixture documents</p>')}
    <section aria-labelledby="evidence-heading" data-section="verified"><h2 class="section-title" id="evidence-heading">Verified field evidence</h2><p class="section-intro">Each accepted value includes its page, captured region, and source text.</p>${factRows ? `<div class="evidence-list">${factRows}</div>` : '<p class="empty">No verified fields were extracted from this document.</p>'}</section>
    ${lowConfidenceRows ? `<section aria-labelledby="low-confidence-heading" data-section="needs-review"><h2 class="section-title" id="low-confidence-heading">Needs a closer look</h2><p class="section-intro">These values were read with low confidence and need human review before use.</p><div class="evidence-list">${lowConfidenceRows}</div></section>` : ''}
    <footer><a href="${escapeHtml(basePath)}/">← Return to visit workspace</a></footer>
  </main>
</body>
</html>`;
}

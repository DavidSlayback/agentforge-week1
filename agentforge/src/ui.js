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
</style></head>
<body><main id="agentforge-app">
<header><div class="header-row"><div><div class="eyebrow">AgentForge / return visit</div><h1>Prepare for visit</h1><p class="subtitle">A concise, evidence-linked orientation for the next patient.</p></div><span class="badge">Synthetic demonstration only</span></div>
<div class="context" id="patient-context"><strong>Patient context</strong><span id="context-status">${payload ? `Authorized OpenEMR context: <strong>${escapeHtml(patient)}</strong>` : liveOpenEMR ? 'Open this page from an authenticated OpenEMR patient chart.' : 'Choose an authorized fixture context.'}</span><span class="hint">Read-only · clinician review required</span></div></header>
<section aria-labelledby="conversation-heading"><div class="section-heading"><h2 id="conversation-heading">Visit orientation</h2><span class="hint">Start with the bottom line, then inspect evidence.</span></div><ol id="transcript" role="log" aria-live="polite" aria-relevant="additions"><li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li></ol></section>
<form id="briefing-form"${liveOpenEMR && !payload ? ' class="hidden"' : ''}><label>Patient ${patientControl}</label><input type="hidden" name="demo_token" value="${escapeHtml(token)}"><button type="submit">Prepare briefing</button></form>
<form id="followup-form" class="hidden"><label for="followup-input">Ask a follow-up</label><input id="followup-input" name="message" autocomplete="off" placeholder="What changed since the last visit?"><div class="samples" aria-label="Safe sample follow-ups"><button type="button" class="secondary" data-prompt="What changed since the last visit?">Documented changes</button><button type="button" class="secondary" data-prompt="What plan items need follow-through?">Plan follow-through</button><button type="button" class="secondary" data-prompt="Which records conflict?">Conflicting records</button></div><button type="submit">Send follow-up</button></form>
<button id="cross-patient-probe" class="secondary hidden" type="button">Probe cross-patient block</button>
<p id="status" class="status" role="status"></p><button id="reset" class="secondary" type="button">Reset conversation</button>
<details><summary>Evaluator notes</summary><p>Ask only about documented changes, plan follow-through, or conflicting records. Every displayed claim includes its supporting evidence. Partial retrieval is qualified; denied or cross-patient context is blocked.</p><p><a href="${publicBasePath}/observability">Open operations dashboard</a> · <a href="${publicBasePath}/evals">Open evaluator panel</a></p></details>
</main>
<script>
(() => {
  const basePath = location.pathname.startsWith('/agentforge') ? '/agentforge' : '';
  const state = { conversationId: null, patient: null, demoToken: ${JSON.stringify(token).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')} };
  const initialDemoToken = state.demoToken;
  const briefingForm = document.getElementById('briefing-form');
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
  const setBusy = (value) => { busy = value; if (patientSelector) patientSelector.disabled = value; document.getElementById('agentforge-app').setAttribute('aria-busy', String(value)); briefingForm.querySelectorAll('button').forEach((button) => { button.disabled = value; button.classList.toggle('loading', value); }); followupForm.querySelectorAll('button').forEach((button) => { button.disabled = value; button.classList.toggle('loading', value); }); crossPatientProbe.disabled = value; };
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
      if (evidence.length) { const details = document.createElement('details'); details.className = 'evidence'; const summary = document.createElement('summary'); summary.textContent = 'Source records (' + evidence.length + ')'; details.append(summary); const list = document.createElement('ul'); evidence.forEach((entry) => { const row = document.createElement('li'); const date = entry.recorded_at ? new Date(entry.recorded_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unavailable'; row.textContent = [entry.record_type || 'record', date, entry.author || 'author unavailable', entry.excerpt ? '"' + entry.excerpt + '"' : 'excerpt unavailable'].join(' · '); list.append(row); }); details.append(list); item.append(details); }
    }
    transcript.append(item); item.scrollIntoView?.({ block: 'nearest' }); if (role === 'assistant') item.focus({ preventScroll: true });
  };
  const request = async (path, body, timeoutMs = 45000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(basePath + path, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')'); return data; } catch (error) { if (error.name === 'AbortError') throw new Error('Request timed out before a verified response was available.'); throw error; } finally { clearTimeout(timer); } };
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
  followupForm.addEventListener('submit', async (event) => { event.preventDefault(); if (busy) return; const message = input.value.trim(); if (!state.conversationId || !state.patient || !message) return setStatus('Prepare a briefing and enter a question first.', true); setBusy(true); addMessage('user', message); setStatus('Checking the patient-scoped conversation…'); try { const response = await request('/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: state.patient, message })); addMessage('assistant', response.text, response, 'followup'); setStatus(response.disposition === 'blocked' ? 'Follow-up blocked at the patient-scope boundary.' : response.disposition === 'deadline-exceeded' ? 'Follow-up deadline exceeded before verified content was available.' : 'Follow-up complete.'); input.value = ''; } catch (error) { setStatus(error.message, true); } finally { setBusy(false); } });
  crossPatientProbe.addEventListener('click', async () => { if (busy) return; if (!state.conversationId || !state.patient) return setStatus('Prepare a briefing first.', true); setBusy(true); const otherPatient = state.patient === ${JSON.stringify(primaryProbePatient)} ? ${JSON.stringify(secondaryProbePatient)} : ${JSON.stringify(primaryProbePatient)}; addMessage('user', 'Probe cross-patient context: ' + otherPatient); setStatus('Checking the patient-scope boundary…'); try { const response = await request('/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: otherPatient, message: 'What changed?' }, false)); addMessage('assistant', response.text, response, 'followup'); setStatus(response.disposition === 'blocked' ? 'Cross-patient follow-up blocked without disclosure.' : 'Unexpected cross-patient response.', response.disposition !== 'blocked'); } catch (error) { setStatus(error.message, true); } finally { setBusy(false); } });
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prompt; input.focus(); }));
  patientSelector?.addEventListener('change', () => { if (busy) return; state.conversationId = null; state.patient = null; state.demoToken = ''; transcript.innerHTML = '<li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li>'; followupForm.classList.add('hidden'); crossPatientProbe.classList.add('hidden'); if (contextStatus) contextStatus.textContent = 'New patient selected. Preparing the authorized context.'; setStatus('Patient changed; previous conversation cleared.'); beginPreparation(); });
  reset.addEventListener('click', () => { if (busy) return; state.conversationId = null; state.patient = null; state.demoToken = initialDemoToken; transcript.innerHTML = '<li id="empty-state">Prepare a briefing to see the documented visit reason, active concerns, and supporting records.</li>'; followupForm.classList.add('hidden'); crossPatientProbe.classList.add('hidden'); if (contextStatus) contextStatus.textContent = initialContextStatus; setStatus('Conversation reset.'); beginPreparation(); });
  beginPreparation();
})();
</script></body></html>`;
}

export function renderEvaluatorPage({ golden, errorAnalysis, basePath = '', localReport = false }) {
  const goldenGate = golden?.gate_passed ? 'PASSED' : 'FAILED';
  const errorGate = errorAnalysis?.gate_passed ? 'PASSED' : 'FAILED';
  const rate = Math.round(Number(errorAnalysis?.detection_rate || 0) * 100);
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
<section aria-labelledby="golden-heading"><h2 id="golden-heading">Golden evidence${localReport ? ' · local build' : ' · saved deployment'}</h2><div class="cards"><div class="card"><span class="value">${golden?.total_cases ?? '—'}</span><span class="muted">total cases</span></div><div class="card"><span class="value pass">${golden?.passed_cases ?? '—'}</span><span class="muted">passed</span></div><div class="card"><span class="value">${golden?.failed_cases ?? '—'}</span><span class="muted">failed</span></div><div class="card"><span class="value">${golden?.critical_failures ?? '—'}</span><span class="muted">critical failures</span></div><div class="card"><span class="value pass">${goldenGate}</span><span class="muted">golden gate</span></div></div><p><a href="${route(localReport ? '/evals/active-service-results.json' : '/evals/deployed-service-results.json')}">${localReport ? 'Current local service report' : 'Saved deployed-service report'}</a></p></section>
<section aria-labelledby="mutation-heading"><h2 id="mutation-heading">Mutation/error analysis</h2><div class="cards"><div class="card"><span class="value">${errorAnalysis?.total_mutations ?? '—'}</span><span class="muted">mutations</span></div><div class="card"><span class="value pass">${errorAnalysis?.detected_mutations ?? '—'}</span><span class="muted">detected</span></div><div class="card"><span class="value">${errorAnalysis?.missed_mutations ?? '—'}</span><span class="muted">missed</span></div><div class="card"><span class="value pass">${rate}%</span><span class="muted">detection rate</span></div><div class="card"><span class="value pass">${errorGate}</span><span class="muted">mutation gate</span></div></div><p><a href="${route('/evals/error-analysis.json')}">Saved error-analysis report</a></p></section>
<p class="warn"><strong>Limitations:</strong> these are synthetic fixture and harness results. They demonstrate contract sensitivity and observable behavior; they do not prove clinical safety, OpenEMR authorization parity, provider suitability, or production PHI compliance.</p>
</main></body></html>`;
}

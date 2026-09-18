const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export function renderAgentForgePage({ token = '', payload = null } = {}) {
  const patient = payload?.patient_uuid || '';
  const patientControl = payload
    ? `<input type="hidden" name="patient_uuid" value="${escapeHtml(patient)}"><span class="patient-value" aria-label="Patient">${escapeHtml(patient)}</span>`
    : '<select name="patient_uuid" aria-label="Patient"><option value="fixture-patient-001">fixture-patient-001</option><option value="fixture-patient-002">fixture-patient-002</option><option value="fixture-patient-006">fixture-patient-006</option></select>';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AgentForge</title>
<style>
body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#17202a;background:#f7f9fb}
main{background:#fff;border:1px solid #d9e2ec;border-radius:.75rem;padding:1.25rem;box-shadow:0 2px 8px #17202a12}
.badge{display:inline-block;border-radius:999px;padding:.2rem .55rem;font-size:.8rem;font-weight:650;background:#e8f1fb;color:#174a7e}
.badge[data-disposition="blocked"]{background:#fde8e7;color:#9b1c1c}.badge[data-disposition="partial"],.badge[data-disposition="qualified"]{background:#fff4cc;color:#6b4e00}
form{display:grid;gap:.6rem;margin:1rem 0}label{font-weight:650;display:grid;gap:.25rem}select,input,button{font:inherit;padding:.55rem;border:1px solid #9fb3c8;border-radius:.4rem}button{cursor:pointer;background:#174a7e;color:#fff;border-color:#174a7e}button.secondary{background:#fff;color:#174a7e}.samples{display:flex;flex-wrap:wrap;gap:.5rem}.samples button{font-size:.9rem}.hidden{display:none!important}.status{min-height:1.5rem;color:#52606d}.status.error{color:#9b1c1c}
#transcript{display:grid;gap:.75rem;list-style:none;padding:0}.message{border:1px solid #d9e2ec;border-radius:.6rem;padding:.75rem}.message[data-role="assistant"]{background:#f7fbff}.message[data-role="user"]{background:#f7f7f7}.message header{display:flex;justify-content:space-between;gap:1rem;font-size:.85rem;color:#52606d}.message p{white-space:pre-wrap;margin:.5rem 0}.evidence{margin-top:.5rem}.evidence li{margin:.25rem 0;font-size:.9rem}.qualification{border-left:4px solid #d39e00;padding-left:.65rem}.blocked{border-left-color:#c53030}
</style></head>
<body><main id="agentforge-app">
<header><h1>Prepare for visit</h1><p><span class="badge">Synthetic demonstration only</span> Read-only return-visit orientation.</p>
<p id="patient-context">${payload ? `Authorized patient context: <strong>${escapeHtml(patient)}</strong>` : 'Choose an authorized fixture context.'}</p></header>
<section aria-labelledby="conversation-heading"><h2 id="conversation-heading">Conversation</h2><ol id="transcript" aria-live="polite"><li id="empty-state">Prepare a briefing to start the conversation.</li></ol></section>
<form id="briefing-form"><label>Patient ${patientControl}</label><input type="hidden" name="demo_token" value="${escapeHtml(token)}"><button type="submit">Prepare briefing</button></form>
<form id="followup-form" class="hidden"><label for="followup-input">Ask a follow-up</label><input id="followup-input" name="message" autocomplete="off" placeholder="What changed since the last visit?"><div class="samples" aria-label="Safe sample follow-ups"><button type="button" class="secondary" data-prompt="What changed since the last visit?">Documented changes</button><button type="button" class="secondary" data-prompt="What plan items need follow-through?">Plan follow-through</button><button type="button" class="secondary" data-prompt="Which records conflict?">Conflicting records</button></div><button type="submit">Send follow-up</button></form>
<button id="cross-patient-probe" class="secondary hidden" type="button">Probe cross-patient block</button>
<p id="status" class="status" role="status"></p><button id="reset" class="secondary" type="button">Reset conversation</button>
<details><summary>Evaluator notes</summary><p>Ask only about documented changes, plan follow-through, or conflicting records. Every displayed claim includes its supporting evidence. Partial retrieval is qualified; denied or cross-patient context is blocked.</p><p><a href="/evals">Open evaluator panel</a></p></details>
</main>
<script>
(() => {
  const basePath = location.pathname.startsWith('/agentforge') ? '/agentforge' : '';
  const state = { conversationId: null, patient: null };
  const briefingForm = document.getElementById('briefing-form');
  const followupForm = document.getElementById('followup-form');
  const transcript = document.getElementById('transcript');
  const status = document.getElementById('status');
  const reset = document.getElementById('reset');
  const crossPatientProbe = document.getElementById('cross-patient-probe');
  const input = document.getElementById('followup-input');
  const setStatus = (message, error = false) => { status.textContent = message; status.className = error ? 'status error' : 'status'; };
  const addMessage = (role, text, response = null) => {
    document.getElementById('empty-state')?.remove();
    const item = document.createElement('li'); item.className = 'message'; item.dataset.role = role;
    const header = document.createElement('header'); header.textContent = role === 'assistant' ? 'AgentForge' : 'Clinician'; item.append(header);
    const paragraph = document.createElement('p'); paragraph.textContent = text || (response?.disposition === 'blocked' ? 'This request was blocked before patient data was returned.' : 'No response text was supplied.'); item.append(paragraph);
    if (response) {
      const badge = document.createElement('span'); badge.className = 'badge'; badge.dataset.disposition = response.disposition || 'complete'; badge.textContent = response.disposition || 'response'; header.append(badge);
      if (response.qualification?.required) { const note = document.createElement('p'); note.className = 'qualification' + (response.disposition === 'blocked' ? ' blocked' : ''); note.textContent = 'Qualified: ' + ((response.qualification.reasons || []).join(', ') || 'coverage is incomplete'); item.append(note); }
      if (response.withheld_fields?.length) { const note = document.createElement('p'); note.className = 'qualification'; note.textContent = 'Withheld fields: ' + response.withheld_fields.join(', '); item.append(note); }
      if (response.disposition === 'blocked') { const note = document.createElement('p'); note.className = 'qualification blocked'; note.textContent = 'Blocked before patient data was returned.'; item.append(note); }
      const evidence = (response.claims || []).flatMap((claim) => claim.evidence || response.evidence || []);
      if (evidence.length) { const details = document.createElement('details'); details.className = 'evidence'; const summary = document.createElement('summary'); summary.textContent = 'Evidence (' + evidence.length + ')'; details.append(summary); const list = document.createElement('ul'); evidence.forEach((entry) => { const row = document.createElement('li'); row.textContent = (entry.source_ref || 'source unavailable') + ' · ' + (entry.recorded_at || 'date unavailable') + ' · ' + (entry.record_type || 'record'); list.append(row); }); details.append(list); item.append(details); }
    }
    transcript.append(item); item.scrollIntoView?.({ block: 'nearest' });
  };
  const request = async (path, body) => { const response = await fetch(basePath + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')'); return data; };
  const authorizedRequest = (extra) => ({ ...extra, clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' } });
  briefingForm.addEventListener('submit', async (event) => { event.preventDefault(); setStatus('Preparing briefing…'); const form = new FormData(briefingForm); const patient = form.get('patient_uuid'); try { const response = await request('/v1/briefings', authorizedRequest({ patient_uuid: patient, demo_token: form.get('demo_token'), case_id: patient === 'fixture-patient-001' ? 'complete_return_visit' : patient === 'fixture-patient-006' ? 'partial_retrieval' : 'conflicting_latest_values' })); state.conversationId = response.correlation_id; state.patient = response.context?.patient_ref || response.patient?.patient_ref || patient; addMessage('assistant', response.text, response); followupForm.classList.toggle('hidden', response.disposition === 'blocked'); crossPatientProbe.classList.toggle('hidden', response.disposition === 'blocked'); setStatus(response.disposition === 'blocked' ? 'Briefing blocked; no patient context was displayed.' : 'Briefing ready for a patient-scoped follow-up.'); } catch (error) { setStatus(error.message, true); } });
  followupForm.addEventListener('submit', async (event) => { event.preventDefault(); const message = input.value.trim(); if (!state.conversationId || !state.patient || !message) return setStatus('Prepare a briefing and enter a question first.', true); addMessage('user', message); setStatus('Checking the patient-scoped conversation…'); try { const response = await request(basePath + '/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: state.patient, message })); addMessage('assistant', response.text, response); setStatus(response.disposition === 'blocked' ? 'Follow-up blocked at the patient-scope boundary.' : 'Follow-up complete.'); input.value = ''; } catch (error) { setStatus(error.message, true); } });
  crossPatientProbe.addEventListener('click', async () => { if (!state.conversationId || !state.patient) return setStatus('Prepare a briefing first.', true); const otherPatient = state.patient === 'fixture-patient-001' ? 'fixture-patient-006' : 'fixture-patient-001'; addMessage('user', 'Probe cross-patient context: ' + otherPatient); setStatus('Checking the patient-scope boundary…'); try { const response = await request(basePath + '/v1/conversations/' + encodeURIComponent(state.conversationId) + '/messages', authorizedRequest({ patient_uuid: otherPatient, message: 'What changed?' })); addMessage('assistant', response.text, response); setStatus(response.disposition === 'blocked' ? 'Cross-patient follow-up blocked without disclosure.' : 'Unexpected cross-patient response.', response.disposition !== 'blocked'); } catch (error) { setStatus(error.message, true); } });
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prompt; input.focus(); }));
  reset.addEventListener('click', () => { state.conversationId = null; state.patient = null; transcript.innerHTML = '<li id="empty-state">Prepare a briefing to start the conversation.</li>'; followupForm.classList.add('hidden'); crossPatientProbe.classList.add('hidden'); setStatus('Conversation reset.'); });
})();
</script></body></html>`;
}

export function renderEvaluatorPage({ golden, errorAnalysis }) {
  const goldenGate = golden?.gate_passed ? 'PASSED' : 'FAILED';
  const errorGate = errorAnalysis?.gate_passed ? 'PASSED' : 'FAILED';
  const rate = Math.round(Number(errorAnalysis?.detection_rate || 0) * 100);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentForge evaluator panel</title>
<style>body{font-family:system-ui,sans-serif;max-width:68rem;margin:2rem auto;padding:0 1rem;color:#17202a;background:#f7f9fb}main{background:#fff;border:1px solid #d9e2ec;border-radius:.75rem;padding:1.25rem;box-shadow:0 2px 8px #17202a12}.badge{display:inline-block;border-radius:999px;padding:.2rem .55rem;font-size:.8rem;font-weight:650;background:#e8f1fb;color:#174a7e}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.65rem}.card{border:1px solid #d9e2ec;border-radius:.5rem;padding:.7rem}.value{display:block;font-size:1.35rem;font-weight:700}.muted{color:#52606d;font-size:.9rem}.pass{color:#087443}.warn{color:#6b4e00;background:#fff8df;border-left:4px solid #d49b00;padding:.75rem}.links,.prompts{display:grid;gap:.4rem}.links a{font-weight:650}.links span{color:#52606d;font-size:.9rem}</style></head>
<body><main id="evaluator-panel"><header><h1>AgentForge evaluator panel</h1><p><span class="badge">Synthetic evidence</span> Same-origin operational links and saved evaluation reports.</p></header>
<section aria-labelledby="ops-heading"><h2 id="ops-heading">Operational surfaces</h2><div class="links">
<a href="/health">Health</a><span>Liveness only; expected HTTP 200.</span>
<a href="/ready">Readiness</a><span>Retrieval, model, and trace dependencies; expected HTTP 200 when ready.</span>
<a href="/v1/metrics">Metrics</a><span>Redacted request, error, latency, verification, and display counters.</span>
<a href="/v1/traces">Traces</a><span>Redacted correlation-continuous trace records.</span>
<a href="/observability">Observability view</a><span>Browser-readable metrics and trace dashboard.</span>
</div></section>
<section aria-labelledby="prompt-heading"><h2 id="prompt-heading">Safe sample prompts</h2><div class="prompts"><span>“What changed since the last visit?”</span><span>“What plan items need follow-through?”</span><span>“Which records conflict?”</span><span>Failure probes: partial retrieval, denied authorization, cross-patient scope, malformed request.</span></div></section>
<section aria-labelledby="golden-heading"><h2 id="golden-heading">Golden evidence</h2><div class="cards"><div class="card"><span class="value">${golden?.total_cases ?? '—'}</span><span class="muted">total cases</span></div><div class="card"><span class="value pass">${golden?.passed_cases ?? '—'}</span><span class="muted">passed</span></div><div class="card"><span class="value">${golden?.failed_cases ?? '—'}</span><span class="muted">failed</span></div><div class="card"><span class="value">${golden?.critical_failures ?? '—'}</span><span class="muted">critical failures</span></div><div class="card"><span class="value pass">${goldenGate}</span><span class="muted">golden gate</span></div></div><p><a href="/evals/deployed-service-results.json">Saved deployed-service report</a></p></section>
<section aria-labelledby="mutation-heading"><h2 id="mutation-heading">Mutation/error analysis</h2><div class="cards"><div class="card"><span class="value">${errorAnalysis?.total_mutations ?? '—'}</span><span class="muted">mutations</span></div><div class="card"><span class="value pass">${errorAnalysis?.detected_mutations ?? '—'}</span><span class="muted">detected</span></div><div class="card"><span class="value">${errorAnalysis?.missed_mutations ?? '—'}</span><span class="muted">missed</span></div><div class="card"><span class="value pass">${rate}%</span><span class="muted">detection rate</span></div><div class="card"><span class="value pass">${errorGate}</span><span class="muted">mutation gate</span></div></div><p><a href="/evals/error-analysis.json">Saved error-analysis report</a></p></section>
<p class="warn"><strong>Limitations:</strong> these are synthetic fixture and harness results. They demonstrate contract sensitivity and observable behavior; they do not prove clinical safety, OpenEMR authorization parity, provider suitability, or production PHI compliance.</p>
</main></body></html>`;
}

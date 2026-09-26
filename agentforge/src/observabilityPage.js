const esc = (value) => String(value ?? '—')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const number = (value, suffix = '') => finite(value) ? `${Number(value).toLocaleString()}${suffix}` : '—';
const percent = (value) => finite(value) ? `${(Number(value) * 100).toFixed(1)}%` : '—';

/** Compute display metrics from the redacted traces; missing measurements stay absent. */
export function computeDashboardMetrics(traces = []) {
  const durations = traces.map((trace) => trace.durationMs).filter(finite).map(Number).sort((a, b) => a - b);
  const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : null;
  const errors = traces.filter((trace) => ['failure', 'deadline-exceeded'].includes(trace.status)).length;
  const tokenValues = traces.map((trace) => {
    if (trace.modelTotals && (finite(trace.modelTotals.input_tokens) || finite(trace.modelTotals.output_tokens))) return Number(trace.modelTotals.input_tokens || 0) + Number(trace.modelTotals.output_tokens || 0);
    if (trace.model && (finite(trace.model.inputTokens) || finite(trace.model.input_tokens) || finite(trace.model.outputTokens) || finite(trace.model.output_tokens))) return Number(trace.model.inputTokens ?? trace.model.input_tokens ?? 0) + Number(trace.model.outputTokens ?? trace.model.output_tokens ?? 0);
    return null;
  }).filter((value) => value !== null);
  // A trace with modelTotals.cost_complete === false had at least one model
  // call with no known cost (TraceRecorder#recordModelUsage in
  // observability/index.js); its cost_usd/estimatedCostUsd is null, not a
  // partial number, so it is correctly excluded here rather than silently
  // counted as $0. `costComplete` says so explicitly instead of leaving
  // callers to infer "some traces are missing" from a lower total.
  const costs = traces.map((trace) => trace.modelTotals && finite(trace.modelTotals.cost_usd) ? Number(trace.modelTotals.cost_usd) : finite(trace.model?.estimatedCostUsd) ? Number(trace.model.estimatedCostUsd) : finite(trace.model?.estimated_cost_usd) ? Number(trace.model.estimated_cost_usd) : null).filter((value) => value !== null);
  const tracesWithUnknownCost = traces.filter((trace) => trace.modelTotals?.cost_complete === false).length;
  const verified = traces.map((trace) => trace.verification?.status).filter((status) => status !== undefined && status !== null);
  const passes = verified.filter((status) => ['pass', 'passed', 'verified', 'ready', 'ok'].includes(String(status).toLowerCase())).length;
  return {
    requests: traces.length,
    errorRate: traces.length ? errors / traces.length : null,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    totalTokens: tokenValues.length ? tokenValues.reduce((sum, value) => sum + value, 0) : null,
    totalCost: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null,
    costComplete: tracesWithUnknownCost === 0,
    tracesWithUnknownCost,
    verificationPassRate: verified.length ? passes / verified.length : null,
  };
}

export function renderObservabilityPage({ previewData = null } = {}) {
  const preview = previewData ? JSON.stringify(previewData).replaceAll('<', '\\u003c') : 'null';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark"><title>AgentForge observability</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172536;background:#f2f5f9;line-height:1.45;font-synthesis:none}
    *{box-sizing:border-box}body{margin:0}.shell{max-width:1440px;margin:auto;padding:28px clamp(14px,3vw,38px) 46px}
    h1,h2,p{margin-top:0}h1{font-size:clamp(1.7rem,4vw,2.55rem);letter-spacing:-.04em;line-height:1.08;margin-bottom:8px}h2{font-size:1.04rem;letter-spacing:-.01em;margin-bottom:15px}
    .topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:22px}.eyebrow{font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;font-weight:800;color:#527092;margin-bottom:8px}.subtitle,.muted{color:#617286}.subtitle{margin-bottom:0}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end;color:#617286;font-size:.78rem}.button{border:1px solid #bdcadd;border-radius:8px;background:transparent;color:inherit;padding:8px 11px;font:inherit;font-weight:750;cursor:pointer}.button:hover{border-color:#3579c7;color:#135fab}
    .fake-banner{margin:0 0 18px;padding:13px 16px;border-radius:10px;background:#8b2420;color:#fff;font-weight:900;letter-spacing:.045em;text-align:center;border:2px solid #e17e70}
    .safety{padding:12px 15px;margin-bottom:18px;border:1px solid #c4d6eb;border-left:4px solid #397ab9;border-radius:9px;background:#e8f1fb;color:#294966;font-size:.87rem}
    .kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:11px;margin-bottom:18px}.card,.panel{background:#fff;border:1px solid #d9e2ed;border-radius:13px;box-shadow:0 4px 14px #1a36500a}.card{padding:14px 15px;min-width:0}.label{display:block;color:#63758a;font-size:.73rem;font-weight:750}.value{display:block;font-size:1.45rem;line-height:1.2;font-weight:850;letter-spacing:-.035em;margin:8px 0 2px;overflow-wrap:anywhere}.detail{font-size:.72rem;color:#75869a}.panel{padding:18px;margin-bottom:18px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:16px}.alerts{display:grid;gap:9px}.alert{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:9px;background:#edf7f0;border:1px solid #c9e7d2}.alert.firing{background:#fff0ee;border-color:#efc5c0}.alert-name{font-weight:820;font-size:.86rem}.alert-meta{font-size:.76rem;color:#68798b}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:.69rem;font-weight:900;text-transform:uppercase;letter-spacing:.04em;background:#d4f0dc;color:#126439;white-space:nowrap}.pill.firing{background:#f9d9d4;color:#9a261d}
    .table-wrap{overflow:auto;max-width:100%;border:1px solid #e0e6ee;border-radius:9px}table{width:100%;border-collapse:collapse;min-width:1020px;font-size:.79rem}th,td{text-align:left;vertical-align:top;padding:11px 10px;border-bottom:1px solid #e8edf3}th{position:sticky;top:0;background:#f4f7fa;color:#617286;font-size:.68rem;text-transform:uppercase;letter-spacing:.055em;white-space:nowrap}tbody tr:last-child>td{border-bottom:0}details summary{cursor:pointer;color:#155fac;font-weight:800}details[open] summary{margin-bottom:12px}.trace-detail{min-width:500px;padding:3px 2px 12px}.trace-detail h3{font-size:.82rem;margin:14px 0 7px}.waterfall{width:100%;height:auto;display:block;max-height:420px}.waterfall text{fill:#596d82;font:12px system-ui,sans-serif}.stage-list,.handoffs,.usage,.decisions{display:grid;gap:6px}.item{padding:7px 9px;background:#f4f7fa;border-radius:7px;font-size:.76rem;overflow-wrap:anywhere}.item strong{color:#273d55}.empty{color:#77879a;font-size:.82rem;padding:7px 0}.state{font-weight:800}.state.failure,.state.blocked,.state.deadline-exceeded,.state.firing{color:#b3261e}.state.qualified,.state.warning{color:#8b6500}.state.success,.state.ready,.state.passed,.state.verified,.state.ok{color:#13713f}.footer{font-size:.75rem;color:#77879a;margin:14px 2px}
    @media(max-width:1000px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.panels{grid-template-columns:1fr}}
    @media(max-width:600px){.shell{padding:20px 12px 32px}.topbar{display:block}.toolbar{justify-content:flex-start;margin-top:14px}.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.card{padding:12px}.value{font-size:1.2rem}.panel{padding:14px}.hide-mobile{display:none}.table-wrap{margin-right:-3px}}
    @media(prefers-color-scheme:dark){:root{color:#e2eaf4;background:#101821}.card,.panel{background:#172330;border-color:#2a3949;box-shadow:none}.subtitle,.muted,.detail,.alert-meta,.footer{color:#9aabbd}.eyebrow{color:#8bb9e7}.safety{background:#182c3e;color:#c8dcf0;border-color:#385673}.alert{background:#183328;border-color:#28543a}.alert.firing{background:#3b211f;border-color:#69332e}.alert-meta{color:#b2bfcd}.table-wrap{border-color:#2b3a4a}th{background:#202e3c;color:#a9bacb}td,th{border-bottom-color:#2b3948}.item{background:#202e3c;color:#d6e1ed}.item strong{color:#ebf2fa}.waterfall text{fill:#adbed0}.button{border-color:#405367}.button:hover{border-color:#75b5f1;color:#a8d5ff}.pill{background:#19452e;color:#a9e3ba}.pill.firing{background:#552a27;color:#ffb9b0}}
  </style>
</head>
<body><main class="shell">
  ${previewData ? '<div class="fake-banner" role="alert">FAKE DATA — preview only</div>' : ''}
  <header class="topbar"><div><div class="eyebrow">AgentForge / operations</div><h1>Observability</h1><p class="subtitle">Redacted encounter traces, model usage, verification outcomes, and service alerts.</p></div><div class="toolbar"><span id="updated">Last updated: —</span><button id="pause" class="button" type="button">Pause refresh</button></div></header>
  <div class="safety"><strong>Privacy boundary:</strong> operational metadata only. Source text, prompts, model responses, and direct identifiers are not displayed.</div>
  <section id="kpis" class="kpis" aria-label="Key performance indicators"></section>
  <section class="panels"><article class="panel"><h2>Service alerts</h2><div id="alerts" class="alerts"><div class="empty">Loading alert state…</div></div></article><article class="panel"><h2>Traffic and safety</h2><div id="summary" class="muted">Loading encounter summary…</div></article></section>
  <section class="panel"><h2>Recent encounters</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>Operation</th><th>Status / final state</th><th>Duration</th><th>Tokens</th><th>Cost</th><th>Extraction confidence</th><th>Retrieval hits</th><th>Verification / eval</th><th>Details</th></tr></thead><tbody id="traces"><tr><td colspan="10" class="empty">Loading traces…</td></tr></tbody></table></div></section>
  <p class="footer">Production data is fetched from /v1/metrics, /v1/alerts, and /v1/traces. Request totals use the retained trace set: the newest AGENTFORGE_TRACE_LIMIT traces (default 500) within the retention window.</p>
</main>
<script>
(() => {
  const basePath=location.pathname.startsWith('/agentforge-w2')?'/agentforge-w2':location.pathname.startsWith('/agentforge')?'/agentforge':'';
  const previewData=${preview}; const isPreview=Boolean(previewData); const $=(id)=>document.getElementById(id);
  const esc=(v)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const present=(v)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const n=(v,s='')=>present(v)?Number(v).toLocaleString()+s:'—'; const money=(v)=>present(v)?'$'+Number(v).toFixed(4):'—';
  const pct=(v)=>present(v)?(Number(v)*100).toFixed(1)+'%':'—';
  const metric=(label,value,detail='')=>'<article class="card"><span class="label">'+label+'</span><span class="value">'+value+'</span><span class="detail">'+detail+'</span></article>';
  const sum=(traces)=>{
    const d=traces.map(t=>t.durationMs).filter(present).map(Number).sort((a,b)=>a-b),p=q=>d.length?d[Math.min(d.length-1,Math.ceil(d.length*q)-1)]:null;
    const err=traces.filter(t=>['failure','deadline-exceeded'].includes(t.status)).length;
    const tokens=traces.map(t=>{const x=t.modelTotals;if(x&&(present(x.input_tokens)||present(x.output_tokens)))return Number(x.input_tokens||0)+Number(x.output_tokens||0);const m=t.model||{};if(['inputTokens','input_tokens','outputTokens','output_tokens'].some(k=>present(m[k])))return Number(m.inputTokens??m.input_tokens??0)+Number(m.outputTokens??m.output_tokens??0);return null}).filter(x=>x!==null);
    const costs=traces.map(t=>present(t.modelTotals?.cost_usd)?Number(t.modelTotals.cost_usd):present(t.model?.estimatedCostUsd)?Number(t.model.estimatedCostUsd):present(t.model?.estimated_cost_usd)?Number(t.model.estimated_cost_usd):null).filter(x=>x!==null);
    const unpriced=traces.filter(t=>t.modelTotals?.cost_complete===false).length;
    const ver=traces.map(t=>t.verification?.status).filter(x=>x!==undefined&&x!==null),passed=ver.filter(x=>['pass','passed','verified','ready','ok'].includes(String(x).toLowerCase())).length;
    return {requests:traces.length,errorRate:traces.length?err/traces.length:null,p50:p(.5),p95:p(.95),p99:p(.99),tokens:tokens.length?tokens.reduce((a,b)=>a+b,0):null,cost:costs.length?costs.reduce((a,b)=>a+b,0):null,unpriced,verify:ver.length?passed/ver.length:null,errors:err};
  };
  const confidence=(t)=>{const c=t.extraction?.confidence;if(!c)return '—';return 'mean '+n(c.mean)+' · min '+n(c.min)};
  const tokenCount=(t)=>{const x=t.modelTotals;if(x&&(present(x.input_tokens)||present(x.output_tokens)))return Number(x.input_tokens||0)+Number(x.output_tokens||0);const m=t.model||{};if(['inputTokens','input_tokens','outputTokens','output_tokens'].some(k=>present(m[k])))return Number(m.inputTokens??m.input_tokens??0)+Number(m.outputTokens??m.output_tokens??0);return null};
  const cost=(t)=>present(t.modelTotals?.cost_usd)?t.modelTotals.cost_usd:present(t.model?.estimatedCostUsd)?t.model.estimatedCostUsd:present(t.model?.estimated_cost_usd)?t.model.estimated_cost_usd:null;
  const hits=(t)=>{const a=t.retrieval?.attempts;if(!Array.isArray(a))return null;const counts=a.map(x=>x.hit_count??x.hits).filter(present);return counts.length?counts.reduce((s,x)=>s+Number(x),0):null};
  const stageSvg=(stages)=>{const rows=(stages||[]).filter(s=>present(s.durationMs));if(!rows.length)return '<div class="empty">No stage timing recorded.</div>';const max=Math.max(...rows.map(s=>Number(s.durationMs)),1),w=500,h=rows.length*34+12;return '<svg class="waterfall" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Stage duration waterfall">'+rows.map((s,i)=>{const y=i*34+7,bx=142,bw=Math.max(2,320*Number(s.durationMs)/max);return '<text x="0" y="'+(y+15)+'">'+esc(s.name)+'</text><rect x="'+bx+'" y="'+y+'" width="'+bw+'" height="21" rx="5" fill="'+(s.status==='failure'?'#cf554b':'#377fca')+'"/><text x="'+Math.min(bx+bw+7,470)+'" y="'+(y+15)+'">'+n(s.durationMs)+' ms</text>'}).join('')+'</svg>'};
  const rows=(traces)=>[...traces].reverse().slice(0,25).map(t=>{
    const when=t.completedAt||t.storedAt||t.startedAt||null, date=when?new Date(when).toLocaleString():'—';
    const op=t.interactionType||t.operation||'—', state=t.display?.status||t.status||t.evaluation?.outcome||'—';
    const verify=t.verification?.status||t.evaluation?.outcome||t.display?.status||'—';
    const retrieval=(t.retrieval?.attempts||[]).map(a=>'<div class="item"><strong>'+esc(a.adapter||a.group||'retrieval')+'</strong> · '+esc(a.status||'—')+' · hits '+n(a.hit_count??a.hits)+'</div>').join('')||'<div class="empty">No retrieval attempts recorded.</div>';
    const handoffs=(t.handoffs||[]).map(h=>'<div class="item"><strong>'+esc(h.worker)+'</strong> · '+esc(h.status)+' · '+esc(h.input_type)+' → '+esc(h.output_status)+'</div>').join('')||'<div class="empty">No worker handoffs recorded.</div>';
    const decisions=(t.decisions||[]).map(d=>'<div class="item"><strong>'+esc(d.next)+'</strong> · '+esc(d.reason)+'</div>').join('');
    const usage=(t.modelUsage||[]).map(m=>'<div class="item"><strong>'+esc(m.stage||'model')+'</strong> · '+esc(m.provider)+' / '+esc(m.model)+' · in '+n(m.inputTokens)+' · out '+n(m.outputTokens)+' · '+money(m.estimatedCostUsd)+'</div>').join('')||'<div class="empty">No per-stage model usage recorded.</div>';
    return '<tr><td>'+esc(date)+'</td><td>'+esc(op)+'</td><td><span class="state '+esc(String(state).toLowerCase())+'">'+esc(state)+'</span></td><td>'+n(t.durationMs,' ms')+'</td><td>'+n(tokenCount(t))+'</td><td>'+money(cost(t))+'</td><td>'+esc(confidence(t))+'</td><td>'+n(hits(t))+'</td><td>'+esc(verify)+'</td><td><details><summary>Inspect</summary><div class="trace-detail"><h3>Stage waterfall</h3>'+stageSvg(t.stages)+'<div class="stage-list">'+(t.stages||[]).map(s=>'<div class="item"><strong>'+esc(s.name)+'</strong> · '+n(s.durationMs,' ms')+' · '+esc(s.status||'status unavailable')+'</div>').join('')+'</div><h3>Worker handoffs</h3><div class="handoffs">'+handoffs+'</div>'+ (decisions?'<h3>Supervisor decisions</h3><div class="decisions">'+decisions+'</div>':'')+'<h3>Retrieval attempts</h3><div>'+retrieval+'</div><h3>Model usage by stage</h3><div class="usage">'+usage+'</div></div></details></td></tr>';
  }).join('');
  function render(data){const traces=Array.isArray(data.traces)?data.traces:[],m=sum(traces),alerts=data.alerts||{};
    $('kpis').innerHTML=[metric('Total requests',n(m.requests),'retained traces'),metric('Error rate',pct(m.errorRate),n(m.errors)+' operational errors'),metric('p50 latency',n(m.p50,' ms'),'measured encounters'),metric('p95 latency',n(m.p95,' ms'),'measured encounters'),metric('p99 latency',n(m.p99,' ms'),'measured encounters'),metric('Total tokens',n(m.tokens),'input + output'),metric('Total cost',money(m.cost),m.unpriced?'estimated USD · '+n(m.unpriced)+' trace(s) with an unpriced model excluded':'estimated USD'),metric('Verification pass rate',pct(m.verify),'encounters with verification status')].join('');
    $('alerts').innerHTML=(alerts.rules||[]).map(a=>'<div class="alert '+(a.triggered?'firing':'')+'"><div><div class="alert-name">'+esc(a.id)+'</div><div class="alert-meta">Observed '+esc(a.observed??'—')+' '+(a.triggered?esc(a.operator):(a.operator==='>'?'≤':'not '+esc(a.operator)))+' threshold '+esc(a.threshold??'—')+'</div></div><span class="pill '+(a.triggered?'firing':'')+'">'+(a.triggered?'Firing':'OK')+'</span></div>').join('')||'<div class="empty">No alert rules returned.</div>';
    const fallbacks=traces.filter(t=>t.model?.provider_fallback===true).length;const hitsTotal=traces.reduce((s,t)=>s+(hits(t)||0),0);
    $('summary').innerHTML='<strong>'+n(traces.length)+'</strong> retained traces'+(present(data.metrics?.traceLimit)?' (limit '+esc(n(data.metrics.traceLimit))+')':'')+' · <strong>'+n(hitsTotal)+'</strong> retrieval hits · <strong>'+n(fallbacks)+'</strong> provider fallbacks · alert window '+(present(alerts.windowMs)?esc(n(alerts.windowMs/60000))+' min':'not specified');
    $('traces').innerHTML=traces.length?rows(traces):'<tr><td colspan="10" class="empty">No redacted traces retained.</td></tr>';
    $('updated').textContent='Last updated: '+new Date().toLocaleTimeString();
  }
  let paused=false,timer=null,busy=false;const button=$('pause');button.addEventListener('click',()=>{paused=!paused;button.textContent=paused?'Resume refresh':'Pause refresh';if(!paused)refresh()});
  async function refresh(){if(paused||busy)return;busy=true;try{if(isPreview)render(previewData);else{const [metrics,alerts,traces]=await Promise.all(['/v1/metrics','/v1/alerts','/v1/traces'].map(async p=>{const r=await fetch(basePath+p,{headers:{accept:'application/json'}});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}));render({metrics,alerts,traces})}}catch(e){$('traces').innerHTML='<tr><td colspan="10" class="empty">Dashboard data unavailable: '+esc(e.message)+'</td></tr>'}finally{busy=false}}
  refresh();timer=setInterval(refresh,10000);window.addEventListener('beforeunload',()=>clearInterval(timer));
})();
</script></body></html>`;
}

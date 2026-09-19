const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function renderObservabilityPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AgentForge operations dashboard</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;background:#eef3f8;line-height:1.4}
    *{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:28px 18px 48px}
    .topbar{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:22px}.eyebrow{color:#53657a;font-size:.76rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    h1,h2,h3,p{margin-top:0}h1{font-size:clamp(1.75rem,3vw,2.6rem);line-height:1.05;margin-bottom:8px}.subtitle{color:#53657a;margin-bottom:0}.badge{border-radius:999px;padding:8px 12px;font-weight:800;font-size:.8rem;background:#d9f7e5;color:#087443;white-space:nowrap}.badge.warn{background:#fff1c7;color:#805b00}
    .notice{background:#fff9e8;border:1px solid #f2d487;border-left:5px solid #d49b00;padding:13px 15px;border-radius:10px;margin-bottom:18px;color:#674d00}.notice strong{color:#4e3900}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.card,.panel{background:#fff;border:1px solid #d9e2ec;border-radius:12px;box-shadow:0 2px 8px #17202a10}.card{padding:15px}.label{color:#66788a;font-size:.78rem;font-weight:700}.value{display:block;font-size:1.65rem;font-weight:850;letter-spacing:-.03em;margin:5px 0 2px}.delta{font-size:.76rem;color:#66788a}.ok{color:#087443}.bad{color:#b42318}.warn-text{color:#805b00}
    .two{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-bottom:18px}.panel{padding:18px}.panel h2{font-size:1.05rem;margin-bottom:15px}.panel h3{font-size:.84rem;color:#53657a;margin:18px 0 9px}.bars{display:grid;gap:10px}.bar-row{display:grid;grid-template-columns:92px 1fr 62px;align-items:center;gap:10px;font-size:.8rem}.bar-track{height:10px;background:#e8eef4;border-radius:99px;overflow:hidden}.bar-fill{height:100%;background:linear-gradient(90deg,#2774d9,#62b5e8);border-radius:99px;min-width:2px}.bar-fill.warn-fill{background:linear-gradient(90deg,#d49b00,#f1c75b)}
    .alerts{display:grid;gap:9px}.alert{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 12px;border-radius:9px;background:#f4f7fa}.alert.triggered{background:#fff0ef;color:#8f1d14}.alert-name{font-weight:800;font-size:.86rem}.alert-meta{font-size:.76rem;color:#66788a}.status{border-radius:999px;padding:4px 8px;font-size:.7rem;font-weight:850;text-transform:uppercase}.status.ok{background:#d9f7e5}.status.bad{background:#ffd9d6;color:#8f1d14}
    .trace-list{display:grid;gap:8px}.trace{display:grid;grid-template-columns:110px 1fr 90px 90px;gap:12px;align-items:center;border-top:1px solid #edf1f5;padding:9px 0;font-size:.78rem}.trace:first-child{border-top:0}.trace code{font-size:.72rem;color:#53657a}.trace .status{justify-self:start}.empty{color:#66788a;font-size:.85rem;padding:12px 0}.footer{color:#66788a;font-size:.75rem;margin-top:16px}
    @media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}.topbar{display:block}.badge{display:inline-block;margin-top:12px}}
    @media(max-width:520px){.grid{grid-template-columns:1fr}.trace{grid-template-columns:1fr 1fr}.trace code{grid-column:1/-1}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar"><div><div class="eyebrow">AgentForge / synthetic operations</div><h1>AgentForge observability</h1><p class="subtitle">Runtime dashboard: redacted service health, latency, safety outcomes, and alert state.</p></div><div id="health-badge" class="badge">Loading</div></header>
    <div class="notice"><strong>Safety boundary:</strong> synthetic data only. This dashboard exposes operational metadata, never chart text, prompts, responses, or PHI.</div>
    <section id="metric-cards" class="grid" aria-label="Key metrics"><div class="card">Loading metrics…</div></section>
    <section class="two">
      <article class="panel"><h2>Latency and traffic</h2><div id="latency-bars" class="bars"></div><h3>Requests by interaction</h3><div id="interaction-bars" class="bars"></div></article>
      <article class="panel"><h2>Safety and outcomes</h2><h3>Verification</h3><div id="verification-bars" class="bars"></div><h3>Display</h3><div id="display-bars" class="bars"></div><h3>Provider fallback</h3><div id="fallback-summary" class="empty">Loading…</div></article>
    </section>
    <section class="panel"><h2>Alert state <span id="window-label" class="label"></span></h2><div id="alerts" class="alerts"></div></section>
    <section class="panel" style="margin-top:18px"><h2>Recent redacted traces</h2><div id="traces" class="trace-list"></div></section>
    <p class="footer">Source: /v1/metrics, /v1/alerts, and /v1/traces. Alert calculations use the configured bounded window.</p>
  </main>
  <script>
  (() => {
    // Endpoint contract: basePath+'/v1/metrics', basePath+'/v1/alerts', basePath+'/v1/traces'.
    const basePath = location.pathname.startsWith('/agentforge') ? '/agentforge' : '';
    const byId = (id) => document.getElementById(id);
    const number = (value, suffix = '') => Number.isFinite(Number(value)) ? \`\${Number(value).toLocaleString()}\${suffix}\` : '—';
    const pct = (value) => \`\${(Number(value || 0) * 100).toFixed(1)}%\`;
    const safe = (value) => String(value ?? 'unknown').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const barRows = (values, formatter = number) => {
      const entries = Object.entries(values || {}); const max = Math.max(1, ...entries.map(([, value]) => Number(value) || 0));
      return entries.length ? entries.map(([key, value]) => \`<div class="bar-row"><span>\${safe(key)}</span><div class="bar-track"><div class="bar-fill" style="width:\${Math.min(100, ((Number(value) || 0) / max) * 100)}%"></div></div><strong>\${formatter(value)}</strong></div>\`).join('') : '<div class="empty">No observations in window.</div>';
    };
    const card = (label, value, detail = '', tone = '') => \`<div class="card"><span class="label">\${label}</span><span class="value \${tone}">\${value}</span><span class="delta">\${detail}</span></div>\`;
    Promise.all([fetch(basePath + '/v1/metrics').then((r) => r.json()), fetch(basePath + '/v1/alerts').then((r) => r.json()), fetch(basePath + '/v1/traces').then((r) => r.json())])
      .then(([metrics, alerts, traces]) => {
        const telemetry = metrics.telemetry || {}; const latency = metrics.latencyMs || {}; const errors = Number(metrics.errors || 0);
        byId('health-badge').textContent = errors ? 'Attention required' : 'Operational'; byId('health-badge').className = errors ? 'badge warn' : 'badge';
        byId('metric-cards').innerHTML = [
          card('Requests', number(metrics.requests), \`\${number((metrics.windowMs || alerts.windowMs || 0) / 60000)} minute window\`),
          card('Errors', number(errors), pct(metrics.errorRate) + ' operational error rate', errors ? 'bad' : 'ok'),
          card('p50 latency', number(latency.p50, ' ms'), 'typical request'),
          card('p95 latency', number(latency.p95, ' ms'), \`p99 \${number(latency.p99, ' ms')}\`),
          card('Retrieval attempts', number(metrics.retrievalAttempts), \`\${number(metrics.toolFailures)} failed or timed out\`),
          card('Retries', number(metrics.retries), \`\${number(metrics.providerFallbacks)} provider fallbacks\`),
          card('Queue depth', number(telemetry.pendingExports ?? metrics.queueDepth), \`\${number(telemetry.droppedExports || 0)} dropped exports\`),
          card('Estimated cost', \`$\${Number(metrics.estimatedCostUsd || 0).toFixed(4)}\`, 'synthetic metadata only')
        ].join('');
        byId('latency-bars').innerHTML = barRows({p50: latency.p50 || 0, p95: latency.p95 || 0, p99: latency.p99 || 0}, (v) => number(v, ' ms'));
        byId('interaction-bars').innerHTML = barRows(Object.fromEntries(Object.entries(metrics.latencyByInteraction || {}).map(([key, value]) => [key, value.p95 || 0])), (v) => number(v, ' ms'));
        byId('verification-bars').innerHTML = barRows(metrics.verificationOutcomes, number);
        byId('display-bars').innerHTML = barRows(metrics.displayOutcomes, number);
        byId('fallback-summary').textContent = \`\${number(metrics.providerFallbacks)} fallback\${Number(metrics.providerFallbacks) === 1 ? '' : 's'} in the active window.\`;
        byId('window-label').textContent = \`(\${number((alerts.windowMs || metrics.windowMs || 0) / 60000)} minute window)\`;
        byId('alerts').innerHTML = (alerts.rules || []).map((alert) => \`<div class="alert \${alert.triggered ? 'triggered' : ''}"><div><div class="alert-name">\${safe(alert.id)}</div><div class="alert-meta">Observed \${safe(alert.observed)} \${safe(alert.operator)} \${safe(alert.threshold)}</div></div><span class="status \${alert.triggered ? 'bad' : 'ok'}">\${alert.triggered ? 'Triggered' : 'Clear'}</span></div>\`).join('') || '<div class="empty">No alert rules returned.</div>';
        const recent = [...(Array.isArray(traces) ? traces : [])].reverse().slice(0, 8);
        byId('traces').innerHTML = recent.length ? recent.map((trace) => \`<div class="trace"><code>\${safe(trace.correlationId || '—')}</code><span>\${safe(trace.interactionType || trace.operation || 'request')}</span><strong>\${number(trace.durationMs, ' ms')}</strong><span class="status \${trace.status === 'failure' ? 'bad' : 'ok'}">\${safe(trace.status || 'unknown')}</span></div>\`).join('') : '<div class="empty">No redacted traces retained.</div>';
      })
      .catch((error) => { byId('health-badge').textContent = 'Unavailable'; byId('health-badge').className = 'badge warn'; byId('metric-cards').innerHTML = \`<div class="card bad">Dashboard data unavailable: \${safe(error.message)}</div>\`; });
  })();
  </script>
</body>
</html>`;
}

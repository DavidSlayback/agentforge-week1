// Synthetic provider readback helper. Set AGENTFORGE_BASE_URL to a target
// explicitly; this verifies a no-PHI synthetic lane and is not deployment
// certification or PHI/provider approval.
const base = String(process.env.AGENTFORGE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const get = async (path) => {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json() };
};
const post = async (path, body) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const health = await get('/health');
const ready = await get('/ready');
const context = await get('/v1/demo-context?patient_uuid=fixture-patient-001');
const briefing = await post('/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', case_id: 'complete_return_visit', demo_token: context.body.demo_token });
const traces = await get('/v1/traces');
const serializedTraces = traces.body.map((trace) => JSON.stringify(trace));
const providerPrimaryCount = serializedTraces.filter((trace) => trace.includes('"provider_status":"primary"')).length;
const providerFallbackCount = serializedTraces.filter((trace) => trace.includes('"provider_fallback":true')).length;
const dependencies = ready.body.dependencies || ready.body.checks || {};
const checks = Object.fromEntries(Object.entries(dependencies).map(([key, value]) => [key, typeof value === 'object' ? value.status : value]));
const dependencyStatuses = Object.values(checks);
const traceContainsPatientId = traces.body.some((trace) => JSON.stringify(trace).includes('fixture-patient-001'));
const traceContainsApiKeyMarker = traces.body.some((trace) => JSON.stringify(trace).includes('sk-sp-'));
if (
  health.status !== 200 ||
  ready.status !== 200 ||
  ready.body.status !== 'ready' ||
  dependencyStatuses.some((status) => status !== 'ready') ||
  context.status !== 200 ||
  briefing.status !== 200 ||
  briefing.body.disposition !== 'complete' ||
  briefing.body.verification?.status !== 'passed' ||
  traceContainsPatientId ||
  traceContainsApiKeyMarker
) process.exitCode = 1;
console.log(JSON.stringify({
  health_status: health.status,
  ready_status: ready.status,
  ready_state: ready.body.status,
  ready_keys: Object.keys(ready.body),
  ready_dependencies: checks,
  ready_dependencies_ready: dependencyStatuses.every((status) => status === 'ready'),
  context_status: context.status,
  context_error: context.body.error,
  briefing_status: briefing.status,
  briefing_disposition: briefing.body.disposition,
  briefing_verification: briefing.body.verification?.status,
  briefing_error: briefing.body.error,
  response_model_provider: briefing.body.model?.provider,
  response_model: briefing.body.model?.model,
  provider_status: briefing.body.provider_status,
  provider_fallback: briefing.body.provider_fallback,
  provider_error_code: briefing.body.provider_error_code,
  trace_count: traces.body.length,
  provider_primary_trace_count: providerPrimaryCount,
  provider_fallback_trace_count: providerFallbackCount,
  trace_contains_patient_id: traceContainsPatientId,
  trace_contains_api_key_marker: traceContainsApiKeyMarker,
}));

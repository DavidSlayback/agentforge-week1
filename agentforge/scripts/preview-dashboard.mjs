import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import observability from '../../observability/index.js';
import { renderObservabilityPage } from '../src/observabilityPage.js';

const { InMemoryTraceSink, evaluateAlerts } = observability;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const traces = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/observability/fake-traces.json'), 'utf8'));
const sink = new InMemoryTraceSink({ maxTraces: traces.length });
for (const trace of traces) sink.record(trace);
const metrics = sink.snapshot();
const alerts = evaluateAlerts(metrics);
const output = path.join(root, 'tmp/dashboard-preview.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, renderObservabilityPage({ previewData: { traces, metrics, alerts } }), 'utf8');
process.stdout.write(`Preview rendered with ${traces.length} synthetic traces: ${output}\n`);

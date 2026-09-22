import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';
import { AgentForgeService } from '../src/service.js';
import { DeterministicProvider } from '../src/modelProvider.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));

test('chart retrieval and synthetic writeback are separate collaborators', () => {
  const chartAdapter = new FixtureAdapter(fixturePath);
  const writeback = new SyntheticWriteback();
  const service = new AgentForgeService({ chartAdapter, writeback, provider: new DeterministicProvider() });

  assert.equal(service.chartAdapter, chartAdapter);
  assert.equal(service.writeback, writeback);
  assert.equal(typeof chartAdapter.retrieve, 'function');
  assert.equal(typeof chartAdapter.persistSourceDocument, 'undefined');
  assert.equal(typeof writeback.persistSourceDocument, 'function');
  assert.equal(typeof writeback.retrieve, 'undefined');
});

test('a read-only chart service has no synthetic writeback capability', () => {
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback: null, provider: new DeterministicProvider() });
  const result = service.draftClinicalAction({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', action_type: 'order', instruction: 'Order a CBC', instruction_source: 'clinician' });

  assert.deepEqual(result, { status: 'blocked', reason: 'synthetic_writeback_unavailable' });
});

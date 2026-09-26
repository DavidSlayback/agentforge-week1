import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadAllergies } from '../../bff/src/cards/allergies.ts';
import { loadProblems } from '../../bff/src/cards/problems.ts';
import { createUpstreamClient } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { isActiveIssue, normalizeLocalDateTime } from '../../core/rules/issues.ts';
import { FakeOpenEmr, PATIENT, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';
const NOW_LOCAL = '2026-09-25 13:00:00';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
const problemUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}/medical_problem`;

const FILES = {
  [PATIENT.p13]: 'shaped/patient-13.json',
  [PATIENT.p3]: 'shaped/patient-3.json',
  [PATIENT.dashSyn01]: 'shaped/dash-syn-01.json',
  [PATIENT.dashSyn02]: 'shaped/dash-syn-02.json',
} as const;
type Id = keyof typeof FILES;

interface ApiProblem {
  uuid: string;
  title: string;
  begdate: string | null;
  enddate: string | null;
  outcome: string;
  activity: string;
}

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

function setup() {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger: pino({ level: 'silent' }), now: () => 0 });
  const deps = { upstream, nowLocal: () => NOW_LOCAL };
  const ctx = (id: string) => ({ patientId: uuid(id), accessToken: TOKEN, correlationId: 'corr-2' });
  return { fake, run: (id: string) => loadProblems(deps, ctx(id)), runAllergies: (id: string) => loadAllergies(deps, ctx(id)) };
}

function serve(fake: FakeOpenEmr, id: Id, problems?: FixtureResponse) {
  fake.on('GET', patientUrl(id), routeFixture(FILES[id], 'rest.patient.read')).on('GET', problemUrl(id), problems ?? routeFixture(FILES[id], 'rest.problem.list'));
}

function apiRows(id: Id): ApiProblem[] {
  return (routeFixture(FILES[id], 'rest.problem.list').body as { data: ApiProblem[] }).data;
}

function withRows(rows: ApiProblem[]): FixtureResponse {
  return { status: 200, body: { validationErrors: [], internalErrors: [], data: rows, links: [] } };
}

describe('Medical Problems use case against shaped fixtures (contract)', () => {
  it('pid 13: 13 of 39 rows, in begdate order (checked against the fixture), via exactly the two allow-listed reads', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    const card = await run(PATIENT.p13);
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13), problemUrl(PATIENT.p13)]);
    for (const c of fake.calls) expect(new URL(c.url).search).toBe('');

    const api = apiRows(PATIENT.p13);
    expect(api).toHaveLength(39);
    // Every row has activity=1, so an `activity`-based (FHIR-style) filter would show all 39.
    expect(api.every((r) => r.activity === '1')).toBe(true);
    expect(card.kind).toBe('ok');
    if (card.kind !== 'ok') return;
    expect(card.rows).toHaveLength(13);

    // The expected order comes from the fixture's own begdate values, not a hard-coded list.
    const active = api.filter((r) => isActiveIssue(r, NOW_LOCAL));
    const begdates = active.map((r) => normalizeLocalDateTime(r.begdate ?? '') ?? '');
    const expectedTitles = active
      .map((r, i) => ({ t: r.title, k: begdates[i] ?? '', i }))
      .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1))
      .map((x) => x.t);
    expect(card.rows.map((r) => r.title)).toEqual(expectedTitles);
    // The fixture's API order is not begdate order, so the sort is really exercised.
    expect(active.map((r) => r.title)).not.toEqual(expectedTitles);
  });

  it('pid 3 and DASH-SYN-02: HTTP 200 data:[] is "Nothing Recorded"', async () => {
    for (const id of [PATIENT.p3, PATIENT.dashSyn02] as const) {
      const { fake, run } = setup();
      serve(fake, id);
      expect(await run(id)).toEqual({ kind: 'empty', patientId: id });
    }
  });

  it('DASH-SYN-01: the past-enddate problem is filtered out, the other two are sorted by begdate', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    const card = await run(PATIENT.dashSyn01);
    const api = apiRows(PATIENT.dashSyn01);
    expect(api).toHaveLength(3);
    expect(card.kind).toBe('ok');
    if (card.kind !== 'ok') return;
    const kept = api.filter((r) => r.enddate === null).sort((a, b) => ((a.begdate ?? '') < (b.begdate ?? '') ? -1 : 1));
    expect(card.rows.map((r) => r.title)).toEqual(kept.map((r) => r.title));
  });

  it('a problem repeated once per linked encounter is shown once', async () => {
    const { fake, run } = setup();
    const api = apiRows(PATIENT.dashSyn01);
    const first = api[0];
    if (!first) throw new Error('fixture');
    serve(fake, PATIENT.dashSyn01, withRows([...api, { ...first }, { ...first }]));
    const card = await run(PATIENT.dashSyn01);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows).toHaveLength(2);
  });

  it('403 (encounters/notes denied) is forbidden for this card while Allergies stays ok (3.14)', async () => {
    const { fake, run, runAllergies } = setup();
    serve(fake, PATIENT.p13, { status: 403, body: { error: 'forbidden' } });
    fake
      .on('GET', `${BASE}/apis/default/api/patient/${PATIENT.p13}/allergy`, routeFixture(FILES[PATIENT.p13], 'rest.allergy.list'))
      .on('GET', `${BASE}/apis/default/api/list/severity_ccda`, routeFixture('shaped/list-severity-ccda.json', 'rest.list.read'));
    expect(await run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    expect(await runAllergies(PATIENT.p13)).toMatchObject({ kind: 'ok', patientId: PATIENT.p13 });
  });

  it('HTTP 200 validationErrors, a 500 and an unexpected shape are errors, never "Nothing Recorded"', async () => {
    const cases: [FixtureResponse, string][] = [
      [responseFixture('hand-built/rest-200-validation-errors.json'), 'UPSTREAM_VALIDATION'],
      [responseFixture('hand-built/rest-500-sqlstate.json'), 'UPSTREAM_STATUS'],
      [{ status: 200, body: { validationErrors: [], internalErrors: [] } }, 'SCHEMA_MISMATCH'],
      [{ status: 200, body: { validationErrors: [], internalErrors: [], data: [{ title: 'no uuid' }] } }, 'SCHEMA_MISMATCH'],
    ];
    for (const [response, code] of cases) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, response);
      const card = await run(PATIENT.p13);
      expect(card).toMatchObject({ kind: 'error', code });
      expect(JSON.stringify(card)).not.toContain('SQLSTATE');
    }
  });

  it('a row about another patient fails the card (PATIENT_MISMATCH)', async () => {
    const { fake, run } = setup();
    const rows = apiRows(PATIENT.dashSyn01).map((r, i) => (i === 2 ? { ...r, puuid: PATIENT.p13 } : r));
    serve(fake, PATIENT.dashSyn01, withRows(rows));
    expect(await run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
  });

  it('no problem call before the patient read succeeds', async () => {
    const { fake, run } = setup();
    fake.on('GET', patientUrl(PATIENT.p13), { status: 403, body: null });
    expect(await run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13)]);
  });
});

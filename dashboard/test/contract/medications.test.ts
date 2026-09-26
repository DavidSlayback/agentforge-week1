import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadAllergies } from '../../bff/src/cards/allergies.ts';
import { DOSAGE_NOT_AVAILABLE, loadMedications } from '../../bff/src/cards/medications.ts';
import { loadProblems } from '../../bff/src/cards/problems.ts';
import { createUpstreamClient } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { FakeOpenEmr, PATIENT, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';
const NOW_LOCAL = '2026-09-25 13:00:00';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
// The medication route takes the integer pid, never the uuid.
const medicationUrl = (pid: number) => `${BASE}/apis/default/api/patient/${String(pid)}/medication`;

const FILES = {
  [PATIENT.p13]: { file: 'shaped/patient-13.json', pid: 13 },
  [PATIENT.p3]: { file: 'shaped/patient-3.json', pid: 3 },
  [PATIENT.dashSyn01]: { file: 'shaped/dash-syn-01.json', pid: 14 },
  [PATIENT.dashSyn02]: { file: 'shaped/dash-syn-02.json', pid: 15 },
} as const;
type Id = keyof typeof FILES;

interface ApiMedication {
  uuid: string;
  pid: string;
  title: string;
  begdate: string | null;
  enddate: string | null;
  outcome: string;
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
  const ctx = (id: string) => ({ patientId: uuid(id), accessToken: TOKEN, correlationId: 'corr-3' });
  return {
    fake,
    run: (id: string) => loadMedications(deps, ctx(id)),
    runAllergies: (id: string) => loadAllergies(deps, ctx(id)),
    runProblems: (id: string) => loadProblems(deps, ctx(id)),
  };
}

function serve(fake: FakeOpenEmr, id: Id, medications?: FixtureResponse) {
  const { file, pid } = FILES[id];
  fake.on('GET', patientUrl(id), routeFixture(file, 'rest.patient.read')).on('GET', medicationUrl(pid), medications ?? routeFixture(file, 'rest.medication.list'));
}

function apiRows(id: Id): ApiMedication[] {
  return routeFixture(FILES[id].file, 'rest.medication.list').body as ApiMedication[];
}

describe('Medications use case against shaped fixtures (contract)', () => {
  it('pid 13: 1 of 5 rows, title only, with the dosage gap noted; the pid comes from the patient read', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    const card = await run(PATIENT.p13);
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13), medicationUrl(13)]);
    for (const c of fake.calls) expect(new URL(c.url).search).toBe('');
    expect(apiRows(PATIENT.p13)).toHaveLength(5);
    expect(card).toMatchObject({ kind: 'ok', patientId: PATIENT.p13, notes: [DOSAGE_NOT_AVAILABLE] });
    if (card.kind !== 'ok') return;
    expect(card.rows).toHaveLength(1);
    const kept = apiRows(PATIENT.p13).filter((r) => r.enddate === null);
    expect(card.rows.map((r) => r.title)).toEqual(kept.map((r) => r.title));
    expect(Object.keys(card.rows[0] ?? {})).toEqual(['title']);
  });

  it('pid 3: the route answers 404 with an empty body, which is "Nothing Recorded", not an error (6.04)', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p3);
    const raw = routeFixture(FILES[PATIENT.p3].file, 'rest.medication.list');
    expect(raw).toEqual({ status: 404, body: null });
    expect(await run(PATIENT.p3)).toEqual({ kind: 'empty', patientId: PATIENT.p3 });
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p3), medicationUrl(3)]);
  });

  it('DASH-SYN-02 (404, empty body) is empty; DASH-SYN-01 keeps only the medication without a past enddate', async () => {
    const a = setup();
    serve(a.fake, PATIENT.dashSyn02);
    expect(await a.run(PATIENT.dashSyn02)).toEqual({ kind: 'empty', patientId: PATIENT.dashSyn02 });

    const b = setup();
    serve(b.fake, PATIENT.dashSyn01);
    const card = await b.run(PATIENT.dashSyn01);
    expect(apiRows(PATIENT.dashSyn01)).toHaveLength(2);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows.map((r) => r.title)).toEqual(apiRows(PATIENT.dashSyn01).filter((r) => r.enddate === null).map((r) => r.title));
  });

  it('a 404 with a body is an error, and a 404 on any other route is an error', async () => {
    const withBody = setup();
    serve(withBody.fake, PATIENT.p3, { status: 404, body: { error: 'not found' } });
    expect(await withBody.run(PATIENT.p3)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });

    const others = setup();
    const empty404 = { status: 404, body: null };
    others.fake
      .on('GET', patientUrl(PATIENT.p3), routeFixture(FILES[PATIENT.p3].file, 'rest.patient.read'))
      .on('GET', `${BASE}/apis/default/api/patient/${PATIENT.p3}/allergy`, empty404)
      .on('GET', `${BASE}/apis/default/api/patient/${PATIENT.p3}/medical_problem`, empty404);
    expect(await others.runAllergies(PATIENT.p3)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(await others.runProblems(PATIENT.p3)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });

    // A 404 on the patient read itself (unknown patient) is an error, never "Nothing Recorded".
    const unknown = setup();
    unknown.fake.on('GET', patientUrl(PATIENT.p3), empty404);
    expect(await unknown.run(PATIENT.p3)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(unknown.fake.calls).toHaveLength(1);
  });

  it('HTTP 200 [] is empty; 200 validationErrors, a 500 and an unexpected shape are errors', async () => {
    const empty = setup();
    serve(empty.fake, PATIENT.p13, { status: 200, body: [] });
    expect(await empty.run(PATIENT.p13)).toEqual({ kind: 'empty', patientId: PATIENT.p13 });

    const cases: [FixtureResponse, string][] = [
      [responseFixture('hand-built/rest-200-validation-errors.json'), 'UPSTREAM_VALIDATION'],
      [responseFixture('hand-built/rest-500-sqlstate.json'), 'UPSTREAM_STATUS'],
      [{ status: 200, body: { validationErrors: [], internalErrors: [], data: [] } }, 'SCHEMA_MISMATCH'],
      [{ status: 200, body: [{ title: 'no uuid' }] }, 'SCHEMA_MISMATCH'],
      [{ status: 200, body: apiRows(PATIENT.p13).map((r) => ({ ...r, type: 'allergy' })) }, 'SCHEMA_MISMATCH'],
    ];
    for (const [response, code] of cases) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, response);
      const card = await run(PATIENT.p13);
      expect(card).toMatchObject({ kind: 'error', code });
      expect(JSON.stringify(card)).not.toContain('SQLSTATE');
    }
  });

  it('sorts active rows by begdate ascending, NULLs first (the route sorts by date DESC)', async () => {
    const { fake, run } = setup();
    const base = apiRows(PATIENT.p13)[0];
    if (!base) throw new Error('fixture');
    const rows: ApiMedication[] = [
      { ...base, uuid: 'u-1', title: 'Synthetic med late', begdate: '2024-01-01 00:00:00', enddate: null },
      { ...base, uuid: 'u-2', title: 'Synthetic med no begdate', begdate: null, enddate: null },
      { ...base, uuid: 'u-3', title: 'Synthetic med early', begdate: '2001-01-01 00:00:00', enddate: '2099-01-01 00:00:00' },
      { ...base, uuid: 'u-4', title: 'Synthetic med resolved', begdate: '1999-01-01 00:00:00', enddate: null, outcome: '1' },
    ];
    serve(fake, PATIENT.p13, { status: 200, body: rows });
    const card = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows.map((r) => r.title)).toEqual(['Synthetic med no begdate', 'Synthetic med early', 'Synthetic med late']);
  });

  it('a row for another pid fails the card (PATIENT_MISMATCH); 403 is forbidden; 401 is reauth', async () => {
    const mismatch = setup();
    serve(mismatch.fake, PATIENT.p13, { status: 200, body: apiRows(PATIENT.p13).map((r, i) => (i === 4 ? { ...r, pid: '3' } : r)) });
    expect(await mismatch.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });

    const forbidden = setup();
    serve(forbidden.fake, PATIENT.p13, { status: 403, body: { error: 'forbidden' } });
    expect(await forbidden.run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });

    const reauth = setup();
    serve(reauth.fake, PATIENT.p13, { status: 401, body: null });
    expect(await reauth.run(PATIENT.p13)).toEqual({ kind: 'reauth' });
  });
});

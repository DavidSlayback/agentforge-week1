import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { FORM_NOT_AVAILABLE, loadPrescriptions, REFILLS_NOT_AVAILABLE } from '../../bff/src/cards/prescriptions.ts';
import { createUpstreamClient } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { AllowListViolation } from '../../core/upstreamRoutes.ts';
import { FakeOpenEmr, PATIENT, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
// The ONLY prescription URL the BFF may ever send (M-1 / 2.01): exactly these two keys, in this order.
const rxUrl = (pid: number) => `${BASE}/apis/default/api/prescription?patient_id=${String(pid)}&source_table=prescriptions`;

const FILES = {
  [PATIENT.p13]: { file: 'shaped/patient-13.json', pid: 13 },
  [PATIENT.p3]: { file: 'shaped/patient-3.json', pid: 3 },
  [PATIENT.dashSyn01]: { file: 'shaped/dash-syn-01.json', pid: 14 },
  [PATIENT.dashSyn02]: { file: 'shaped/dash-syn-02.json', pid: 15 },
} as const;
type Id = keyof typeof FILES;

interface ApiRx {
  uuid: string;
  drug: string;
  active: string;
  date_added: string;
  date_modified: string | null;
  puuid: string;
  source_table: string;
}

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

function setup() {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger: pino({ level: 'silent' }), now: () => 0 });
  return {
    fake,
    upstream,
    run: (id: string) => loadPrescriptions({ upstream }, { patientId: uuid(id), accessToken: TOKEN, correlationId: 'corr-rx' }),
  };
}

function serve(fake: FakeOpenEmr, id: Id, rx?: FixtureResponse) {
  const { file, pid } = FILES[id];
  fake.on('GET', patientUrl(id), routeFixture(file, 'rest.patient.read')).on('GET', rxUrl(pid), rx ?? routeFixture(file, 'rest.prescription.search'));
}

function apiRows(id: Id): ApiRx[] {
  return (routeFixture(FILES[id].file, 'rest.prescription.search').body as { data: ApiRx[] }).data;
}

describe('Prescriptions use case against shaped fixtures (contract)', () => {
  it('pid 13: the outbound URL is exactly patient_id=<pid>&source_table=prescriptions, after the patient read', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    await run(PATIENT.p13);
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13), rxUrl(13)]);
    const sent = new URL(fake.calls[1]?.url ?? '');
    expect([...sent.searchParams.keys()]).toEqual(['patient_id', 'source_table']);
    expect(sent.searchParams.get('patient_id')).toBe('13');
    expect(sent.searchParams.get('source_table')).toBe('prescriptions');
  });

  it('pid 13: all 5 rows, newest date_added first (ids 66, 65, 64, 63, 62), Refills and form gaps noted', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    const card = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'ok', patientId: PATIENT.p13, notes: [REFILLS_NOT_AVAILABLE, FORM_NOT_AVAILABLE] });
    if (card.kind !== 'ok') return;
    // Expected order derived from the fixture's own values (the fixture lists rows id-ascending, as the API would).
    const expected = [...apiRows(PATIENT.p13)].sort((a, b) => (a.date_added < b.date_added ? 1 : -1));
    expect(card.rows.map((r) => r.filled)).toEqual(expected.map((r) => r.date_added));
    expect(card.rows.map((r) => r.drug)).toEqual(expected.map((r) => r.drug));
    expect(card.rows).toHaveLength(5);
    expect(apiRows(PATIENT.p13).map((r) => r.drug)).not.toEqual(card.rows.map((r) => r.drug)); // the sort did something
    for (const r of card.rows) {
      expect(r.refills).toBeNull();
      expect(r.details).toBe('1.00'); // no size/unit, no " in <form> <interval>" suffix (walkthrough (e) item 6)
      expect(r.quantity).toBe('');
    }
    expect(Object.keys(card.rows[0] ?? {})).toEqual(['drug', 'details', 'quantity', 'refills', 'filled']);
  });

  it('DASH-SYN-01: all 3 rows including the inactive one, active first then date_modified DESC', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    const card = await run(PATIENT.dashSyn01);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind !== 'ok') return;
    const api = apiRows(PATIENT.dashSyn01);
    expect(api.filter((r) => r.active === '0')).toHaveLength(1);
    const inactive = api.find((r) => r.active === '0');
    const active = api.filter((r) => r.active === '1').sort((a, b) => ((a.date_modified ?? '') < (b.date_modified ?? '') ? 1 : -1));
    expect(card.rows.map((r) => r.drug)).toEqual([...active.map((r) => r.drug), inactive?.drug]);
    expect(card.rows.map((r) => r.details)).toEqual(['500mg 1', '10mg 1', '500mg 1']);
    expect(card.rows.map((r) => r.quantity)).toEqual(['60', '90', '21']);
  });

  it('pid 3 and DASH-SYN-02: HTTP 200 with data [] is empty (the legacy "None"), not an error', async () => {
    for (const id of [PATIENT.p3, PATIENT.dashSyn02] as const) {
      const { fake, run } = setup();
      serve(fake, id);
      expect(routeFixture(FILES[id].file, 'rest.prescription.search').status).toBe(200);
      expect(await run(id)).toEqual({ kind: 'empty', patientId: id });
      expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(id), rxUrl(FILES[id].pid)]);
    }
  });

  it('a row for another patient fails the card (PATIENT_MISMATCH), as does a row with no puuid', async () => {
    const other = setup();
    serve(other.fake, PATIENT.p13, {
      status: 200,
      body: { validationErrors: [], internalErrors: [], data: apiRows(PATIENT.p13).map((r, i) => (i === 2 ? { ...r, puuid: PATIENT.p3 } : r)), links: [] },
    });
    expect(await other.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });

    const missing = setup();
    serve(missing.fake, PATIENT.p13, {
      status: 200,
      body: { validationErrors: [], internalErrors: [], data: apiRows(PATIENT.p13).map((r, i) => (i === 0 ? { ...r, puuid: null } : r)), links: [] },
    });
    expect(await missing.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
  });

  it('a row from the lists branch, 200 validationErrors, a 500 with SQL and a bare array are errors, never data or "None"', async () => {
    const cases: [FixtureResponse, string][] = [
      [
        { status: 200, body: { validationErrors: [], internalErrors: [], data: apiRows(PATIENT.p13).map((r) => ({ ...r, source_table: 'lists' })), links: [] } },
        'SCHEMA_MISMATCH',
      ],
      [responseFixture('hand-built/rest-200-validation-errors.json'), 'UPSTREAM_VALIDATION'],
      [responseFixture('hand-built/rest-500-sqlstate.json'), 'UPSTREAM_STATUS'],
      [{ status: 200, body: apiRows(PATIENT.p13) }, 'SCHEMA_MISMATCH'],
      [{ status: 200, body: { validationErrors: [], internalErrors: [], data: [{ uuid: 'x' }], links: [] } }, 'SCHEMA_MISMATCH'],
    ];
    for (const [response, code] of cases) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, response);
      const card = await run(PATIENT.p13);
      expect(card).toMatchObject({ kind: 'error', code });
      expect(JSON.stringify(card)).not.toContain('SQLSTATE');
    }
  });

  it('403 is forbidden (the route needs patients/med), 401 is reauth, and no Rx call happens before the patient read succeeds', async () => {
    const forbidden = setup();
    serve(forbidden.fake, PATIENT.p13, { status: 403, body: { error: 'forbidden' } });
    expect(await forbidden.run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });

    const reauth = setup();
    serve(reauth.fake, PATIENT.p13, { status: 401, body: null });
    expect(await reauth.run(PATIENT.p13)).toEqual({ kind: 'reauth' });

    const noPatient = setup();
    noPatient.fake.on('GET', patientUrl(PATIENT.p13), { status: 404, body: null });
    expect(await noPatient.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(noPatient.fake.calls).toHaveLength(1);
  });

  it('a caller that adds any other query key never reaches OpenEMR (M-1): the client refuses before fetching', async () => {
    const { fake, upstream } = setup();
    fake.on('GET', rxUrl(14), routeFixture(FILES[PATIENT.dashSyn01].file, 'rest.prescription.search'));
    const extras: [string, string][] = [
      ['drug', 'x'],
      ['pid', '14'],
      ['1=1) OR (1', '1'],
    ];
    for (const [key, value] of extras) {
      await expect(
        upstream.get({ routeId: 'rest.prescription.search', query: { patient_id: 14, [key]: value }, accessToken: TOKEN, correlationId: 'corr-m1' }),
      ).rejects.toThrow(AllowListViolation);
    }
    expect(fake.calls).toEqual([]);
  });
});

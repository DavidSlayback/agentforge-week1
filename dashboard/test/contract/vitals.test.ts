import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadVitals, SECONDARY_UNITS_NOT_SHOWN, VITALS_DEADLINE_MS } from '../../bff/src/cards/vitals.ts';
import { createUpstreamClient } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { MAX_ENCOUNTER_SCAN } from '../../core/rules/vitals.ts';
import { FakeOpenEmr, PATIENT, readFixtureFile, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';
const TODAY = '2026-09-25';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
const encountersUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}/encounter`;
const vitalUrl = (pid: number, eid: number | string) => `${BASE}/apis/default/api/patient/${String(pid)}/encounter/${String(eid)}/vital`;
// FHIR vitals include soft-deleted sets (5.02 / M-5). The fake serves them so a port that read them would show the deleted set.
const fhirVitalsUrl = (id: string) => `${BASE}/apis/default/fhir/Observation?patient=${id}&category=vital-signs`;

const FILES = {
  [PATIENT.p13]: { file: 'shaped/patient-13.json', pid: 13 },
  [PATIENT.p3]: { file: 'shaped/patient-3.json', pid: 3 },
  [PATIENT.dashSyn01]: { file: 'shaped/dash-syn-01.json', pid: 14 },
  [PATIENT.dashSyn02]: { file: 'shaped/dash-syn-02.json', pid: 15 },
} as const;
type Id = keyof typeof FILES;

interface ApiEncounter {
  eid: string;
  pid: string;
  puuid: string;
}
interface ApiVital {
  id: string;
  eid: string;
  pid: string;
  puuid: string;
  date: string;
  note: string | null;
  [k: string]: unknown;
}

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

function setup(maxEncounters?: number) {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger: pino({ level: 'silent' }), now: () => 0 });
  const deps = { upstream, today: () => TODAY, ...(maxEncounters === undefined ? {} : { maxEncounters }) };
  return { fake, run: (id: string) => loadVitals(deps, { patientId: uuid(id), accessToken: TOKEN, correlationId: 'corr-vit' }) };
}

/** Serve the patient read, the encounter list and every per-encounter vitals response the shaped file records. */
function serve(fake: FakeOpenEmr, id: Id, encounterList?: FixtureResponse) {
  const { file, pid } = FILES[id];
  fake.on('GET', patientUrl(id), routeFixture(file, 'rest.patient.read')).on('GET', encountersUrl(id), encounterList ?? routeFixture(file, 'rest.encounter.list'));
  for (const key of Object.keys(readFixtureFile(file))) {
    const [route, eid] = key.split(':');
    if (route === 'rest.vital.list' && eid) fake.on('GET', vitalUrl(pid, eid), routeFixture(file, key));
  }
}

const encountersOf = (id: Id): ApiEncounter[] => (routeFixture(FILES[id].file, 'rest.encounter.list').body as { data: ApiEncounter[] }).data;
const vitalsOf = (id: Id, eid: number): ApiVital[] => routeFixture(FILES[id].file, `rest.vital.list:${String(eid)}`).body as ApiVital[];
const envelope = (data: unknown[]): FixtureResponse => ({ status: 200, body: { validationErrors: [], internalErrors: [], data, links: [] } });

describe('Vitals use case against shaped fixtures (contract)', () => {
  it('DASH-SYN-01: the latest NON-deleted set (35), from one call on the newest encounter; never the deleted newer set 36 (5.01 / 5.02)', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    fake.on('GET', fhirVitalsUrl(PATIENT.dashSyn01), responseFixture('hand-built/fhir-observation-vitals-dash-syn-01.json'));
    const card = await run(PATIENT.dashSyn01);
    // What the user sees first: the deleted set on the same encounter is newer (2026-05-01 09:00:00) and must never be shown.
    expect(card.kind === 'ok' ? card.rows[0]?.date : card.kind).not.toBe('2026-05-01 09:00:00');
    expect(card.kind === 'ok' ? card.rows[0]?.date : card.kind).toBe('2026-04-05 09:10:00');
    expect(JSON.stringify(card)).not.toContain('DELETED');
    // How: one call on the newest encounter, and never a FHIR call.
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.some((c) => c.url.includes('/fhir/'))).toBe(false);
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.dashSyn01), encountersUrl(PATIENT.dashSyn01), vitalUrl(14, 370)]);
    expect(card).toMatchObject({ kind: 'ok', patientId: PATIENT.dashSyn01, notes: [SECONDARY_UNITS_NOT_SHOWN] });
    if (card.kind !== 'ok') return;
    const [set] = vitalsOf(PATIENT.dashSyn01, 370);
    expect(card.rows[0]?.date).toBe(set?.date);
    expect(card.rows[0]?.fields.find((f) => f.label === 'Blood Pressure')?.value).toBe('128/82 mmHg');
    expect(card.rows[0]?.fields.find((f) => f.label === 'Weight')?.value).toBe('176 lb');
  });

  it('pid 13: walks encounter 367 first and gets set 27 from one call; no older encounter is called', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    expect(encountersOf(PATIENT.p13)).toHaveLength(36);
    const card = await run(PATIENT.p13);
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13), encountersUrl(PATIENT.p13), vitalUrl(13, 367)]);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind !== 'ok') return;
    expect(vitalsOf(PATIENT.p13, 367).map((v) => v.id)).toEqual(['27']);
    expect(card.rows[0]?.date).toBe('2026-04-05 20:06:27');
    expect(card.rows[0]?.fields.find((f) => f.label === 'Height')?.value).toBe('67 in'); // a plausible adult height (D-6)
  });

  it('pid 3: set 14 from encounter 12, not "Nothing Recorded"; the patient is 19, so BMI Status reads "See Growth-Chart"', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p3);
    const card = await run(PATIENT.p3);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind !== 'ok') return;
    expect(card.rows[0]?.date).toBe('2014-02-01 21:47:33');
    expect(card.rows[0]?.fields.map((f) => f.label)).toEqual([
      'Blood Pressure',
      'Height',
      'Weight',
      'Temperature',
      'Temp Method',
      'Pulse',
      'Respiration',
      'BMI',
      'BMI Status',
      'Waist Circ',
      'Head Circ',
      'Oxygen Saturation',
    ]);
    expect(card.rows[0]?.fields.find((f) => f.label === 'BMI Status')?.value).toBe('See Growth-Chart');
  });

  it('DASH-SYN-02 has no encounters: HTTP 200 data [] (what the wire carries) and the intended 404 empty envelope are both empty', async () => {
    const a = setup();
    serve(a.fake, PATIENT.dashSyn02);
    expect(routeFixture(FILES[PATIENT.dashSyn02].file, 'rest.encounter.list').status).toBe(200);
    expect(await a.run(PATIENT.dashSyn02)).toEqual({ kind: 'empty', patientId: PATIENT.dashSyn02 });
    expect(a.fake.calls).toHaveLength(2);

    const b = setup();
    serve(b.fake, PATIENT.dashSyn02, { status: 404, body: { validationErrors: [], internalErrors: [], data: [], links: [] } });
    expect(await b.run(PATIENT.dashSyn02)).toEqual({ kind: 'empty', patientId: PATIENT.dashSyn02 });
  });

  it('any other 404 on the encounter list (route not found, a body with data or errors, an empty body) is an error', async () => {
    const bodies: FixtureResponse[] = [
      { status: 404, body: { error: 'An error occurred', message: 'Route not found', code: 0 } },
      { status: 404, body: { validationErrors: { uuid: ['x'] }, internalErrors: [], data: [], links: [] } },
      { status: 404, body: null },
    ];
    for (const response of bodies) {
      const { fake, run } = setup();
      serve(fake, PATIENT.dashSyn02, response);
      expect(await run(PATIENT.dashSyn02)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    }
  });

  it('an encounter without live vitals (HTTP 404, empty body) is skipped and the walk goes on to the next', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    fake.on('GET', vitalUrl(14, 370), { status: 404, body: null });
    const card = await run(PATIENT.dashSyn01);
    expect(fake.calls.map((c) => c.url).slice(2)).toEqual([vitalUrl(14, 370), vitalUrl(14, 369)]);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows[0]?.date).toBe(vitalsOf(PATIENT.dashSyn01, 369)[0]?.date);
  });

  it('a 5xx on one encounter is an error, never "Nothing Recorded", and the walk stops there', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    fake.on('GET', vitalUrl(14, 370), responseFixture('hand-built/rest-500-sqlstate.json'));
    const card = await run(PATIENT.dashSyn01);
    expect(card).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(JSON.stringify(card)).not.toContain('SQLSTATE');
    expect(fake.calls).toHaveLength(3);
  });

  it('the scan cap: past it with encounters left unchecked the card is VITALS_SCAN_LIMIT; with every encounter checked it is empty', async () => {
    const encounters = encountersOf(PATIENT.dashSyn01);
    const capped = setup(2);
    serve(capped.fake, PATIENT.dashSyn01);
    for (const e of encounters) capped.fake.on('GET', vitalUrl(14, e.eid), { status: 404, body: null });
    expect(await capped.run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'VITALS_SCAN_LIMIT' });
    expect(capped.fake.calls.filter((c) => c.url.endsWith('/vital'))).toHaveLength(2);

    const all = setup(3);
    serve(all.fake, PATIENT.dashSyn01);
    for (const e of encounters) all.fake.on('GET', vitalUrl(14, e.eid), { status: 404, body: null });
    expect(await all.run(PATIENT.dashSyn01)).toEqual({ kind: 'empty', patientId: PATIENT.dashSyn01 });
  });

  it(`production cap: ${String(MAX_ENCOUNTER_SCAN)} encounter calls at most, then VITALS_SCAN_LIMIT`, async () => {
    const template = encountersOf(PATIENT.dashSyn01)[0];
    const many = Array.from({ length: MAX_ENCOUNTER_SCAN + 1 }, (_, i) => ({ ...template, eid: String(1000 + i) }));
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01, envelope(many));
    for (const e of many) fake.on('GET', vitalUrl(14, e.eid), { status: 404, body: null });
    expect(await run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'VITALS_SCAN_LIMIT' });
    const walked = fake.calls.filter((c) => c.url.endsWith('/vital')).map((c) => c.url);
    expect(walked).toHaveLength(MAX_ENCOUNTER_SCAN);
    expect(walked[0]).toBe(vitalUrl(14, 1000 + MAX_ENCOUNTER_SCAN)); // newest first
  });

  // W3 hardening H4: the walk was sequential, up to 50 calls of up to 5 s each, with no overall
  // budget. A load now has a deadline; past it the card is the labeled VITALS_DEADLINE error (never
  // "Nothing Recorded"), and the in-flight call is aborted, not waited out.
  it('an overall deadline ends a slow walk with VITALS_DEADLINE, aborting the in-flight call', async () => {
    const template = encountersOf(PATIENT.dashSyn01)[0];
    const many = Array.from({ length: 40 }, (_, i) => ({ ...template, eid: String(1000 + i) }));
    const fake = new FakeOpenEmr();
    serve(fake, PATIENT.dashSyn01, envelope(many));
    let vitalCalls = 0;
    // Every vitals call hangs until it is aborted; the per-call timeout (5 s) is far past the deadline.
    const fetch = (url: string, init?: RequestInit): Promise<Response> => {
      if (!url.endsWith('/vital')) return fake.fetch(url, init);
      vitalCalls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    };
    const upstream = createUpstreamClient({ fetch, baseUrl: BASE, timeoutMs: 5000, logger: pino({ level: 'silent' }), now: () => 0 });
    const started = Date.now();
    const card = await loadVitals({ upstream, today: () => TODAY, deadlineMs: 50 }, { patientId: uuid(PATIENT.dashSyn01), accessToken: TOKEN, correlationId: 'corr-dl' });
    expect(card).toEqual({ kind: 'error', patientId: PATIENT.dashSyn01, correlationId: 'corr-dl', code: 'VITALS_DEADLINE' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(vitalCalls).toBe(1);
  });

  it('the deadline also covers many fast-but-slow calls (each under the per-call timeout)', async () => {
    const template = encountersOf(PATIENT.dashSyn01)[0];
    const many = Array.from({ length: 40 }, (_, i) => ({ ...template, eid: String(1000 + i) }));
    const fake = new FakeOpenEmr();
    serve(fake, PATIENT.dashSyn01, envelope(many));
    for (const e of many) fake.on('GET', vitalUrl(14, e.eid), () => new Promise((r) => {
        setTimeout(() => {
          r({ status: 404, body: null });
        }, 20);
      }));
    const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger: pino({ level: 'silent' }), now: () => 0 });
    const card = await loadVitals({ upstream, today: () => TODAY, deadlineMs: 120 }, { patientId: uuid(PATIENT.dashSyn01), accessToken: TOKEN, correlationId: 'c' });
    expect(card).toMatchObject({ kind: 'error', code: 'VITALS_DEADLINE' });
    expect(fake.calls.filter((c) => c.url.endsWith('/vital')).length).toBeLessThan(many.length);
    expect(VITALS_DEADLINE_MS).toBeGreaterThan(0);
    expect(VITALS_DEADLINE_MS).toBeLessThanOrEqual(30_000);
  });

  it('encounters are walked newest first by encounter number, whatever the list order', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01, envelope([...encountersOf(PATIENT.dashSyn01)].reverse()));
    await run(PATIENT.dashSyn01);
    expect(fake.calls[2]?.url).toBe(vitalUrl(14, 370));
  });

  it("an encounter or vitals row for another patient or encounter fails the card (PATIENT_MISMATCH)", async () => {
    const enc = setup();
    serve(enc.fake, PATIENT.dashSyn01, envelope(encountersOf(PATIENT.dashSyn01).map((e, i) => (i === 1 ? { ...e, puuid: PATIENT.p3 } : e))));
    expect(await enc.run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });

    for (const change of [{ eid: '369' }, { pid: '3' }, { puuid: PATIENT.p13 }]) {
      const vit = setup();
      serve(vit.fake, PATIENT.dashSyn01);
      vit.fake.on('GET', vitalUrl(14, 370), { status: 200, body: vitalsOf(PATIENT.dashSyn01, 370).map((v) => ({ ...v, ...change })) });
      expect(await vit.run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
    }
  });

  it('200 validationErrors, a vitals row without its unit key or with a non-numeric measure, 403 and 401 map to their states', async () => {
    const validation = setup();
    serve(validation.fake, PATIENT.dashSyn01, responseFixture('hand-built/rest-200-validation-errors.json'));
    expect(await validation.run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'UPSTREAM_VALIDATION' });

    const [row] = vitalsOf(PATIENT.dashSyn01, 370);
    if (!row) throw new Error('fixture');
    const noUnit: Record<string, unknown> = { ...row };
    delete noUnit['weight_unit'];
    for (const bad of [noUnit, { ...row, pulse: 'seventy' }]) {
      const schema = setup();
      serve(schema.fake, PATIENT.dashSyn01);
      schema.fake.on('GET', vitalUrl(14, 370), { status: 200, body: [bad] });
      expect(await schema.run(PATIENT.dashSyn01)).toMatchObject({ kind: 'error', code: 'SCHEMA_MISMATCH' });
    }

    // The vitals route needs encounters/notes, the list encounters/auth_a: either can be the card's 403.
    const forbiddenVital = setup();
    serve(forbiddenVital.fake, PATIENT.dashSyn01);
    forbiddenVital.fake.on('GET', vitalUrl(14, 370), { status: 403, body: null });
    expect(await forbiddenVital.run(PATIENT.dashSyn01)).toEqual({ kind: 'forbidden', patientId: PATIENT.dashSyn01 });
    const forbiddenList = setup();
    serve(forbiddenList.fake, PATIENT.dashSyn01, { status: 403, body: null });
    expect(await forbiddenList.run(PATIENT.dashSyn01)).toEqual({ kind: 'forbidden', patientId: PATIENT.dashSyn01 });

    const reauth = setup();
    serve(reauth.fake, PATIENT.dashSyn01, { status: 401, body: null });
    expect(await reauth.run(PATIENT.dashSyn01)).toEqual({ kind: 'reauth' });
  });
});

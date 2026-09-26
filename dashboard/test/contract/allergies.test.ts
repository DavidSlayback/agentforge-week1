import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadAllergies, SEVERITY_LABELS_UNAVAILABLE } from '../../bff/src/cards/allergies.ts';
import { createUpstreamClient, type Logger } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { captureLogger, FakeOpenEmr, PATIENT, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';
// 2026-09-25 13:00 in OpenEMR's timezone (the local stack's PHP runs UTC).
const NOW_LOCAL = '2026-09-25 13:00:00';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
const allergyUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}/allergy`;
const LIST_URL = `${BASE}/apis/default/api/list/severity_ccda`;

const FILES = {
  [PATIENT.p13]: 'shaped/patient-13.json',
  [PATIENT.p3]: 'shaped/patient-3.json',
  [PATIENT.dashSyn01]: 'shaped/dash-syn-01.json',
  [PATIENT.dashSyn02]: 'shaped/dash-syn-02.json',
} as const;

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

function setup(logger: Logger = pino({ level: 'silent' })) {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger, now: () => 0 });
  const run = (patientId: string) =>
    loadAllergies({ upstream, nowLocal: () => NOW_LOCAL }, { patientId: uuid(patientId), accessToken: TOKEN, correlationId: 'corr-1' });
  return { fake, run };
}

/** Serve one shaped patient: its REST patient read, its allergy list and the severity list. */
function serve(fake: FakeOpenEmr, id: keyof typeof FILES, overrides: { allergy?: FixtureResponse; list?: FixtureResponse } = {}) {
  const file = FILES[id];
  fake
    .on('GET', patientUrl(id), routeFixture(file, 'rest.patient.read'))
    .on('GET', allergyUrl(id), overrides.allergy ?? routeFixture(file, 'rest.allergy.list'))
    .on('GET', LIST_URL, overrides.list ?? routeFixture('shaped/list-severity-ccda.json', 'rest.list.read'));
}

/** A copy of a shaped allergy response with its rows edited. */
function editedAllergies(id: keyof typeof FILES, edit: (rows: Record<string, unknown>[]) => void): FixtureResponse {
  const base = routeFixture(FILES[id], 'rest.allergy.list');
  const body = JSON.parse(JSON.stringify(base.body)) as { data: Record<string, unknown>[] };
  edit(body.data);
  return { status: base.status, body };
}

describe('Allergies use case against shaped fixtures (contract)', () => {
  it('pid 13: 2 rows labelled "1" (raw-code fallback), neither highlighted, API order kept', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    const card = await run(PATIENT.p13);
    expect(fake.unexpected).toEqual([]);
    // The patient read resolves first; no allergy call before it (ISSUE-CARDS.md (e)).
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13), allergyUrl(PATIENT.p13), LIST_URL]);
    for (const c of fake.calls) {
      expect(new URL(c.url).search).toBe('');
      expect(c.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    }
    expect(card.kind).toBe('ok');
    if (card.kind !== 'ok') return;
    expect(card.patientId).toBe(PATIENT.p13);
    const apiTitles = (routeFixture(FILES[PATIENT.p13], 'rest.allergy.list').body as { data: { title: string }[] }).data.map((r) => r.title);
    expect(card.rows.map((r) => r.title)).toEqual(apiTitles);
    expect(card.rows.map((r) => r.severityLabel)).toEqual(['1', '1']);
    expect(card.rows.every((r) => !r.severe)).toBe(true);
    expect(card.notes).toEqual([]);
  });

  it('pid 3: HTTP 200 data:[] is "Nothing Recorded" (empty), and no severity lookup is made', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p3);
    expect(await run(PATIENT.p3)).toEqual({ kind: 'empty', patientId: PATIENT.p3 });
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p3), allergyUrl(PATIENT.p3)]);
  });

  it('DASH-SYN-01: the outcome=1 allergy is filtered out; the severe one is labelled and highlighted', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    const card = await run(PATIENT.dashSyn01);
    expect(card.kind).toBe('ok');
    if (card.kind !== 'ok') return;
    const api = (routeFixture(FILES[PATIENT.dashSyn01], 'rest.allergy.list').body as { data: { outcome: string; severity_al: string }[] }).data;
    expect(api).toHaveLength(2);
    expect(api.filter((r) => r.outcome === '1')).toHaveLength(1);
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0]).toMatchObject({ severityLabel: 'Severe', severe: true });
  });

  it('DASH-SYN-02: one moderate allergy, labelled, not highlighted', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn02);
    const card = await run(PATIENT.dashSyn02);
    expect(card).toMatchObject({ kind: 'ok', rows: [{ severityLabel: 'Moderate', severe: false }] });
  });

  it('a failing severity_ccda lookup gives raw codes and a note; the card stays ok', async () => {
    for (const list of [responseFixture('hand-built/rest-500-sqlstate.json'), { status: 403, body: null }, { status: 404, body: null }]) {
      const { fake, run } = setup();
      serve(fake, PATIENT.dashSyn01, { list });
      const card = await run(PATIENT.dashSyn01);
      expect(card).toMatchObject({ kind: 'ok', rows: [{ severityLabel: 'severe', severe: true }], notes: [SEVERITY_LABELS_UNAVAILABLE] });
    }
  });

  it('future and past enddates: only the future one stays (filter runs on the raw REST fields)', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, {
      allergy: editedAllergies(PATIENT.p13, (rows) => {
        if (rows[0]) rows[0]['enddate'] = '2026-09-25 13:00:01';
        if (rows[1]) rows[1]['enddate'] = '2026-09-25 13:00:00';
      }),
    });
    const card = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows).toHaveLength(1);
  });

  it('every row filtered out is empty, not an error', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, {
      allergy: editedAllergies(PATIENT.p13, (rows) => {
        for (const r of rows) r['outcome'] = '1';
      }),
    });
    expect(await run(PATIENT.p13)).toEqual({ kind: 'empty', patientId: PATIENT.p13 });
  });

  it('HTTP 200 with validationErrors is an error, never "Nothing Recorded" (6.02)', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, { allergy: responseFixture('hand-built/rest-200-validation-errors.json') });
    expect(await run(PATIENT.p13)).toEqual({ kind: 'error', patientId: PATIENT.p13, correlationId: 'corr-1', code: 'UPSTREAM_VALIDATION' });
  });

  it('an unexpected 200 shape is SCHEMA_MISMATCH, never "Nothing Recorded"', async () => {
    const shapes: unknown[] = [
      { validationErrors: [], internalErrors: [], data: { title: 'not a list' } },
      [{ title: 'bare array where an envelope is expected' }],
      null,
      { validationErrors: [], internalErrors: [], data: [{ title: 'no uuid' }] },
    ];
    for (const body of shapes) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, { allergy: { status: 200, body } });
      expect(await run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'SCHEMA_MISMATCH' });
    }
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, {
      allergy: editedAllergies(PATIENT.p13, (rows) => {
        if (rows[0]) rows[0]['enddate'] = '25/09/2026';
      }),
    });
    expect(await run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'SCHEMA_MISMATCH' });
  });

  it('a row about another patient fails the whole card (PATIENT_MISMATCH, 5.04)', async () => {
    const other = setup();
    serve(other.fake, PATIENT.p13, {
      allergy: editedAllergies(PATIENT.p13, (rows) => {
        if (rows[1]) rows[1]['puuid'] = PATIENT.p3;
      }),
    });
    expect(await other.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });

    const otherPid = setup();
    serve(otherPid.fake, PATIENT.p13, {
      allergy: editedAllergies(PATIENT.p13, (rows) => {
        if (rows[0]) rows[0]['pid'] = '3';
      }),
    });
    expect(await otherPid.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
  });

  it('403 is forbidden for this card, 401 is reauth', async () => {
    const a = setup();
    serve(a.fake, PATIENT.p13, { allergy: { status: 403, body: { error: 'forbidden' } } });
    expect(await a.run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    const b = setup();
    serve(b.fake, PATIENT.p13, { allergy: { status: 401, body: null } });
    expect(await b.run(PATIENT.p13)).toEqual({ kind: 'reauth' });
  });

  it('no allergy call until the patient read succeeds: a failed read fails the card', async () => {
    const { fake, run } = setup();
    fake.on('GET', patientUrl(PATIENT.p13), { status: 404, body: null });
    expect(await run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p13)]);

    const mismatch = setup();
    mismatch.fake.on('GET', patientUrl(PATIENT.p13), routeFixture('shaped/patient-3.json', 'rest.patient.read'));
    expect(await mismatch.run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
    expect(mismatch.fake.calls).toHaveLength(1);
  });

  it('a 500 carrying SQL text reaches neither the DTO nor the logs (6.01)', async () => {
    const { logger, lines } = captureLogger();
    const { fake, run } = setup(logger);
    serve(fake, PATIENT.p13, { allergy: responseFixture('hand-built/rest-500-sqlstate.json') });
    const card = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    const everything = JSON.stringify(card) + lines.join('');
    expect(everything).not.toContain('SQLSTATE');
    expect(everything).not.toContain('LEAKED_SQL_MARKER');
    expect(lines.join('')).toContain('"routeId":"rest.allergy.list"');
    expect(lines.join('')).not.toContain(PATIENT.p13);
  });
});

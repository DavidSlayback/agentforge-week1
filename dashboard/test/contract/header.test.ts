import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { loadHeader } from '../../bff/src/cards/header.ts';
import { lookupPatientByMrn } from '../../bff/src/cards/patientLookup.ts';
import { createUpstreamClient, type Logger } from '../../bff/src/upstream/client.ts';
import { parseMrn, parsePatientUuid, type Mrn, type PatientUuid } from '../../core/ids.ts';
import { captureLogger, FakeOpenEmr, PATIENT, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';
const fhirUrl = (id: string) => `${BASE}/apis/default/fhir/Patient/${id}`;
const restUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
function mrn(v: string): Mrn {
  const m = parseMrn(v);
  if (m === null) throw new Error('bad mrn');
  return m;
}

function setup(logger: Logger = pino({ level: 'silent' })) {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger, now: () => 0 });
  const run = (patientId: string) =>
    loadHeader({ upstream, today: () => '2026-09-25' }, { patientId: uuid(patientId), accessToken: TOKEN, correlationId: 'corr-1' });
  return { fake, upstream, run };
}

function serve(fake: FakeOpenEmr, id: string, fhir: FixtureResponse, rest: FixtureResponse) {
  fake.on('GET', fhirUrl(id), fhir).on('GET', restUrl(id), rest);
}

describe('header use case against shaped fixtures (contract)', () => {
  it.each([
    ['pid 13', PATIENT.p13, 'shaped/patient-13.json', 'Active', 13],
    ['pid 3', PATIENT.p3, 'shaped/patient-3.json', 'Active', 3],
    ['pid 12', PATIENT.p12, 'shaped/patient-12.json', 'Deceased', 12],
  ] as const)('%s: exactly the two allow-listed reads, the expected status, pid resolved once', async (_label, id, file, status, pid) => {
    const { fake, run } = setup();
    serve(fake, id, routeFixture(file, 'fhir.patient.read'), routeFixture(file, 'rest.patient.read'));
    const { card, pid: resolved } = await run(id);
    expect(fake.unexpected).toEqual([]);
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${fhirUrl(id)}`, `GET ${restUrl(id)}`]);
    for (const c of fake.calls) {
      expect(new URL(c.url).search).toBe('');
      expect(c.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    }
    expect(card.kind).toBe('ok');
    if (card.kind !== 'ok') return;
    expect(card.patientId).toBe(id);
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0]?.status).toBe(status);
    expect(card.rows[0]?.ageLabel).toBe(status === 'Deceased' ? 'Age at death' : 'Age');
    expect(resolved).toBe(pid);
  });

  it('a FHIR Patient for another uuid is PATIENT_MISMATCH (5.04)', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, routeFixture('shaped/patient-12.json', 'fhir.patient.read'), routeFixture('shaped/patient-13.json', 'rest.patient.read'));
    const { card } = await run(PATIENT.p13);
    expect(card).toEqual({ kind: 'error', patientId: PATIENT.p13, correlationId: 'corr-1', code: 'PATIENT_MISMATCH' });
  });

  it('a REST patient for another uuid (another pid) is PATIENT_MISMATCH', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, routeFixture('shaped/patient-13.json', 'fhir.patient.read'), routeFixture('shaped/patient-3.json', 'rest.patient.read'));
    const { card, pid } = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
    expect(pid).toBeNull();
  });

  it('a REST record whose pubpid disagrees with the FHIR MRN is PATIENT_MISMATCH', async () => {
    const { fake, run } = setup();
    const rest = routeFixture('shaped/patient-13.json', 'rest.patient.read');
    const tampered = JSON.parse(JSON.stringify(rest.body)) as { data: { pubpid: string } };
    tampered.data.pubpid = '999';
    serve(fake, PATIENT.p13, routeFixture('shaped/patient-13.json', 'fhir.patient.read'), { status: 200, body: tampered });
    expect((await run(PATIENT.p13)).card).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
  });

  it('no header without both authorized reads (3.02): 403 → forbidden, 401 → reauth', async () => {
    const a = setup();
    serve(a.fake, PATIENT.p13, { status: 403, body: null }, routeFixture('shaped/patient-13.json', 'rest.patient.read'));
    expect((await a.run(PATIENT.p13)).card).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    expect(a.fake.calls).toHaveLength(1);

    const b = setup();
    serve(b.fake, PATIENT.p13, routeFixture('shaped/patient-13.json', 'fhir.patient.read'), { status: 401, body: null });
    expect((await b.run(PATIENT.p13)).card).toEqual({ kind: 'reauth' });
  });

  it('HTTP 200 validationErrors and OperationOutcome are errors, never a header', async () => {
    const a = setup();
    serve(a.fake, PATIENT.p13, routeFixture('shaped/patient-13.json', 'fhir.patient.read'), responseFixture('hand-built/rest-200-validation-errors.json'));
    expect((await a.run(PATIENT.p13)).card).toMatchObject({ kind: 'error', code: 'UPSTREAM_VALIDATION' });

    const b = setup();
    serve(b.fake, PATIENT.p13, responseFixture('hand-built/fhir-operation-outcome-200.json'), routeFixture('shaped/patient-13.json', 'rest.patient.read'));
    expect((await b.run(PATIENT.p13)).card).toMatchObject({ kind: 'error', code: 'UPSTREAM_OPERATION_OUTCOME' });
  });

  it('a 500 carrying SQL text reaches neither the DTO nor the logs (6.01)', async () => {
    const { logger, lines } = captureLogger();
    const { fake, run } = setup(logger);
    serve(fake, PATIENT.p13, routeFixture('shaped/patient-13.json', 'fhir.patient.read'), responseFixture('hand-built/rest-500-sqlstate.json'));
    const { card } = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS', correlationId: 'corr-1' });
    const everything = JSON.stringify(card) + lines.join('');
    expect(everything).not.toContain('SQLSTATE');
    expect(everything).not.toContain('LEAKED_SQL_MARKER');
    expect(lines.join('')).not.toContain(PATIENT.p13);
    expect(lines.join('')).not.toContain(TOKEN);
  });

  it('a timeout is an error, not a hang', async () => {
    const upstream = createUpstreamClient({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
      baseUrl: BASE,
      timeoutMs: 20,
      logger: pino({ level: 'silent' }),
      now: () => 0,
    });
    const { card } = await loadHeader({ upstream, today: () => '2026-09-25' }, { patientId: uuid(PATIENT.p13), accessToken: TOKEN, correlationId: 'c' });
    expect(card).toMatchObject({ kind: 'error', code: 'UPSTREAM_TIMEOUT' });
  });
});

describe('patient selection by MRN (contract)', () => {
  const searchUrl = (m: string) => `${BASE}/apis/default/fhir/Patient?identifier=${encodeURIComponent(m)}`;

  it('DASH-SYN-02 resolves to its uuid through exactly one allow-listed search', async () => {
    const { fake, upstream } = setup();
    fake.on('GET', searchUrl('DASH-SYN-02'), routeFixture('shaped/search-identifier-dash-syn-02.json', 'fhir.patient.search'));
    const result = await lookupPatientByMrn(upstream, { mrn: mrn('DASH-SYN-02'), accessToken: TOKEN, correlationId: 'c' });
    expect(result).toEqual({ kind: 'found', patientId: PATIENT.dashSyn02 });
    expect(fake.calls.map((c) => c.url)).toEqual([searchUrl('DASH-SYN-02')]);
  });

  it('an empty Bundle is not-found; an SS-only match is not-found; two PT matches is an error', async () => {
    const hit = routeFixture('shaped/search-identifier-dash-syn-02.json', 'fhir.patient.search');
    const entry = (hit.body as { entry: { resource: { identifier: unknown[] } }[] }).entry[0];
    if (!entry) throw new Error('fixture');

    const a = setup();
    a.fake.on('GET', searchUrl('NOPE-1'), { status: 200, body: { resourceType: 'Bundle', type: 'collection', total: 0 } });
    expect(await lookupPatientByMrn(a.upstream, { mrn: mrn('NOPE-1'), accessToken: TOKEN, correlationId: 'c' })).toEqual({ kind: 'not-found' });

    // The token search also matches `ss`; an entry whose PT identifier differs must not count.
    const b = setup();
    b.fake.on('GET', searchUrl('999'), hit);
    expect(await lookupPatientByMrn(b.upstream, { mrn: mrn('999'), accessToken: TOKEN, correlationId: 'c' })).toEqual({ kind: 'not-found' });

    const c = setup();
    c.fake.on('GET', searchUrl('DASH-SYN-02'), { status: 200, body: { resourceType: 'Bundle', type: 'collection', total: 2, entry: [entry, entry] } });
    expect(await lookupPatientByMrn(c.upstream, { mrn: mrn('DASH-SYN-02'), accessToken: TOKEN, correlationId: 'c' })).toEqual({
      kind: 'error',
      correlationId: 'c',
      code: 'AMBIGUOUS_MRN',
    });
  });
});

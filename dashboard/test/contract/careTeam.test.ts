import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadCareTeam, MAX_NAME_LOOKUPS, MEMBER_NOTE_NOT_AVAILABLE, MEMBER_STATUS_NOT_AVAILABLE, NAMES_UNAVAILABLE } from '../../bff/src/cards/careTeam.ts';
import { createUpstreamClient } from '../../bff/src/upstream/client.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { FakeOpenEmr, PATIENT, readFixtureFile, responseFixture, routeFixture, type FixtureResponse } from '../support/harness.ts';

const BASE = 'http://openemr';
const TOKEN = 'synthetic-access-token-CONTRACT';

const patientUrl = (id: string) => `${BASE}/apis/default/api/patient/${id}`;
const careTeamUrl = (id: string) => `${BASE}/apis/default/fhir/CareTeam?patient=${id}`;
const practitionerUrl = (id: string) => `${BASE}/apis/default/fhir/Practitioner/${id}`;
const organizationUrl = (id: string) => `${BASE}/apis/default/fhir/Organization/${id}`;

const FILES = {
  [PATIENT.p13]: 'shaped/patient-13.json',
  [PATIENT.p3]: 'shaped/patient-3.json',
  [PATIENT.dashSyn01]: 'shaped/dash-syn-01.json',
  [PATIENT.dashSyn02]: 'shaped/dash-syn-02.json',
} as const;
type Id = keyof typeof FILES;

interface Participant {
  member: { reference: string };
  onBehalfOf?: { reference: string };
  role?: { coding?: { display?: string }[] }[];
  period?: { start?: string };
}
interface Team {
  resourceType: 'CareTeam';
  id: string;
  name?: string;
  status?: string;
  subject: { reference: string };
  participant: Participant[];
}

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}

function setup() {
  const fake = new FakeOpenEmr();
  const upstream = createUpstreamClient({ fetch: fake.fetch, baseUrl: BASE, timeoutMs: 1000, logger: pino({ level: 'silent' }), now: () => 0 });
  return { fake, run: (id: string) => loadCareTeam({ upstream }, { patientId: uuid(id), accessToken: TOKEN, correlationId: 'corr-ct' }) };
}

/** Serve the patient read, the CareTeam search and every name read the shaped file records. */
function serve(fake: FakeOpenEmr, id: Id, search?: FixtureResponse) {
  const file = FILES[id];
  fake.on('GET', patientUrl(id), routeFixture(file, 'rest.patient.read')).on('GET', careTeamUrl(id), search ?? routeFixture(file, 'fhir.careteam.search'));
  for (const key of Object.keys(readFixtureFile(file))) {
    const [route, ref] = key.split(':');
    if (route === 'fhir.practitioner.read' && ref) fake.on('GET', practitionerUrl(ref), routeFixture(file, key));
    if (route === 'fhir.organization.read' && ref) fake.on('GET', organizationUrl(ref), routeFixture(file, key));
  }
}

function teamsOf(id: Id): Team[] {
  const body = routeFixture(FILES[id], 'fhir.careteam.search').body as { entry?: { resource: Team }[] };
  return (body.entry ?? []).map((e) => e.resource);
}

function bundleOf(teams: Team[]): FixtureResponse {
  return { status: 200, body: { resourceType: 'Bundle', type: 'collection', total: teams.length, entry: teams.map((resource) => ({ resource })) } };
}

const idOf = (reference: string) => reference.split('/')[1] ?? '';

describe('Care Team use case against shaped fixtures (contract)', () => {
  it('pid 13: 1 team, all 3 members (the inactive specialist too, M-6), roles and since from the participants', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    const card = await run(PATIENT.p13);
    expect(fake.unexpected).toEqual([]);
    const team = teamsOf(PATIENT.p13)[0];
    if (!team) throw new Error('fixture');
    // participant[] has 4 entries: 3 Practitioners + 1 Organization (the members' shared facility).
    expect(team.participant).toHaveLength(4);
    expect(card).toMatchObject({ kind: 'ok', patientId: PATIENT.p13 });
    if (card.kind !== 'ok') return;
    expect(card.rows).toHaveLength(1);
    const dto = card.rows[0];
    expect(dto?.teamName).toBe(team.name);
    expect(dto?.statusTitle).toBe('Active');
    expect(dto?.members.map((m) => m.role)).toEqual(['Primary Care Provider', 'Nurse', 'Specialist']);
    expect(dto?.members.map((m) => m.type)).toEqual(['Provider', 'Provider', 'Provider']);
    expect(dto?.members.map((m) => m.since)).toEqual(['2019-04-01', '2021-09-15', '2016-02-01']);
    // The facility name comes from the Organization read; the specialist has no facility.
    expect(dto?.members.map((m) => m.facility)).toEqual(['Great Clinic', 'Great Clinic', '']);
    // Locally no seeded member has an NPI, so every Practitioner read is 404: names are unavailable, and the card says why.
    expect(dto?.members.map((m) => m.name)).toEqual([null, null, null]);
    expect(card.notes).toEqual([MEMBER_STATUS_NOT_AVAILABLE, MEMBER_NOTE_NOT_AVAILABLE, NAMES_UNAVAILABLE]);
  });

  it('pid 13: the outbound calls are exactly the patient read, one CareTeam search by uuid, and one read per distinct reference', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.p13);
    await run(PATIENT.p13);
    const urls = fake.calls.map((c) => c.url);
    expect(urls.slice(0, 2)).toEqual([patientUrl(PATIENT.p13), careTeamUrl(PATIENT.p13)]);
    const team = teamsOf(PATIENT.p13)[0];
    const practitioners = (team?.participant ?? []).filter((p) => p.member.reference.startsWith('Practitioner/')).map((p) => practitionerUrl(idOf(p.member.reference)));
    const orgs = [...new Set((team?.participant ?? []).flatMap((p) => (p.onBehalfOf ? [organizationUrl(idOf(p.onBehalfOf.reference))] : [])))];
    expect(urls.slice(2).sort()).toEqual([...practitioners, ...orgs].sort());
    expect(urls).toHaveLength(2 + 3 + 1);
  });

  it('a Practitioner that resolves shows its name, and the names note disappears when every name resolved', async () => {
    const { fake, run } = setup();
    serve(fake, PATIENT.dashSyn01);
    const team = teamsOf(PATIENT.dashSyn01)[0];
    const practitionerId = idOf(team?.participant[0]?.member.reference ?? '');
    const ok = responseFixture('hand-built/fhir-practitioner-200.json');
    fake.on('GET', practitionerUrl(practitionerId), { status: 200, body: { ...(ok.body as object), id: practitionerId } });
    const card = await run(PATIENT.dashSyn01);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind !== 'ok') return;
    expect(card.rows[0]?.members).toEqual([
      { type: 'Provider', name: 'Prac Synthetic', role: 'Primary Care Provider', facility: 'Great Clinic', since: '2020-01-15' },
    ]);
    expect(card.notes).toEqual([MEMBER_STATUS_NOT_AVAILABLE, MEMBER_NOTE_NOT_AVAILABLE]);
  });

  it('a name read that is forbidden, or answers for another id shows "Name unavailable"; the card stays ok', async () => {
    for (const response of [{ status: 403, body: { error: 'forbidden' } }, { status: 200, body: { resourceType: 'Practitioner', id: PATIENT.p3 } }]) {
      const { fake, run } = setup();
      serve(fake, PATIENT.dashSyn01);
      const team = teamsOf(PATIENT.dashSyn01)[0];
      fake.on('GET', practitionerUrl(idOf(team?.participant[0]?.member.reference ?? '')), response);
      const card = await run(PATIENT.dashSyn01);
      expect(card).toMatchObject({ kind: 'ok' });
      if (card.kind === 'ok') expect(card.rows[0]?.members[0]?.name).toBeNull();
    }
  });

  it('pid 3 and DASH-SYN-02: Bundle total 0 after a successful patient read is empty ("Nothing Recorded")', async () => {
    for (const id of [PATIENT.p3, PATIENT.dashSyn02] as const) {
      const { fake, run } = setup();
      serve(fake, id);
      expect((routeFixture(FILES[id], 'fhir.careteam.search').body as { total: number }).total).toBe(0);
      expect(await run(id)).toEqual({ kind: 'empty', patientId: id });
      expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(id), careTeamUrl(id)]);
    }
  });

  it('without a successful patient read, the CareTeam search is never called: an unknown patient is an error, never empty (6.03)', async () => {
    const { fake, run } = setup();
    fake.on('GET', patientUrl(PATIENT.p3), { status: 404, body: null }).on('GET', careTeamUrl(PATIENT.p3), routeFixture(FILES[PATIENT.p3], 'fhir.careteam.search'));
    expect(await run(PATIENT.p3)).toMatchObject({ kind: 'error', code: 'UPSTREAM_STATUS' });
    expect(fake.calls.map((c) => c.url)).toEqual([patientUrl(PATIENT.p3)]);
  });

  it('an OperationOutcome in a 200, a non-CareTeam entry, a malformed member reference and a 500 are errors', async () => {
    const team = teamsOf(PATIENT.p13)[0];
    if (!team) throw new Error('fixture');
    const cases: [FixtureResponse, string][] = [
      [responseFixture('hand-built/fhir-operation-outcome-200.json'), 'UPSTREAM_OPERATION_OUTCOME'],
      [{ status: 200, body: { resourceType: 'Bundle', total: 1, entry: [{ resource: { resourceType: 'Patient', id: PATIENT.p13 } }] } }, 'SCHEMA_MISMATCH'],
      [bundleOf([{ ...team, participant: [{ member: { reference: 'https://elsewhere/Practitioner/1' } }] }]), 'SCHEMA_MISMATCH'],
      [responseFixture('hand-built/rest-500-sqlstate.json'), 'UPSTREAM_STATUS'],
    ];
    for (const [response, code] of cases) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, response);
      const card = await run(PATIENT.p13);
      expect(card).toMatchObject({ kind: 'error', code });
      expect(JSON.stringify(card)).not.toContain('SQLSTATE');
    }
  });

  it("a team whose subject is another patient fails the whole card (PATIENT_MISMATCH)", async () => {
    const team = teamsOf(PATIENT.p13)[0];
    if (!team) throw new Error('fixture');
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, bundleOf([team, { ...team, id: 'f31d59af-0000-11f1-8c7a-0ed9af59d05d', subject: { reference: `Patient/${PATIENT.p3}` } }]));
    expect(await run(PATIENT.p13)).toMatchObject({ kind: 'error', code: 'PATIENT_MISMATCH' });
  });

  it('several teams (hand-built): the card shows the first active team by name, whatever the Bundle order', async () => {
    const base = teamsOf(PATIENT.p13)[0];
    if (!base) throw new Error('fixture');
    const teams: Team[] = [
      { ...base, id: 'c0000000-0000-4000-8000-000000000003', name: 'Zeta team', status: 'active' },
      { ...base, id: 'c0000000-0000-4000-8000-000000000001', name: 'Alpha team', status: 'inactive' },
      { ...base, id: 'c0000000-0000-4000-8000-000000000002', name: 'Beta team', status: 'active' },
      { ...base, id: 'c0000000-0000-4000-8000-000000000000', name: 'Aardvark team', status: 'entered-in-error' },
    ];
    for (const order of [teams, [...teams].reverse()]) {
      const { fake, run } = setup();
      serve(fake, PATIENT.p13, bundleOf(order));
      const card = await run(PATIENT.p13);
      expect(card).toMatchObject({ kind: 'ok' });
      if (card.kind === 'ok') expect(card.rows[0]?.teamName).toBe('Beta team');
    }
  });

  it(`name reads are capped at ${String(MAX_NAME_LOOKUPS)} per load; the rest show "Name unavailable"`, async () => {
    const base = teamsOf(PATIENT.p13)[0];
    if (!base) throw new Error('fixture');
    const many = Array.from({ length: 25 }, (_, i) => ({
      member: { reference: `Practitioner/d0000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
      role: [{ coding: [{ display: 'Nurse' }] }],
    }));
    const { fake, run } = setup();
    serve(fake, PATIENT.p13, bundleOf([{ ...base, participant: many }]));
    const card = await run(PATIENT.p13);
    expect(card).toMatchObject({ kind: 'ok' });
    if (card.kind === 'ok') expect(card.rows[0]?.members).toHaveLength(25);
    expect(fake.calls.filter((c) => c.url.includes('/fhir/Practitioner/'))).toHaveLength(MAX_NAME_LOOKUPS);
  });

  it('403 on the search is forbidden (patients/med); 401 is reauth', async () => {
    const forbidden = setup();
    serve(forbidden.fake, PATIENT.p13, { status: 403, body: { error: 'forbidden' } });
    expect(await forbidden.run(PATIENT.p13)).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    const reauth = setup();
    serve(reauth.fake, PATIENT.p13, { status: 401, body: null });
    expect(await reauth.run(PATIENT.p13)).toEqual({ kind: 'reauth' });
  });
});

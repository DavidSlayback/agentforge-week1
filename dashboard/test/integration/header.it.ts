/**
 * Opt-in integration check against the LOCAL synthetic OpenEMR stack (never in
 * the pre-commit hook, MIGRATION-REACT.md §6.1 item 5). It runs the real
 * upstream client and header use case with a short-lived access token that the
 * owner obtains from a local sign-in and passes as DASHBOARD_IT_ACCESS_TOKEN.
 * The token is never logged or written.
 *
 *   npm run test:integration --prefix dashboard            # assert
 *   npm run test:integration --prefix dashboard -- --record  # also write test/fixtures/recorded/
 *
 * Without a token it prints "SKIPPED (no token)" and exits 0; that is a skip,
 * never a pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadAllergies } from '../../bff/src/cards/allergies.ts';
import { loadCareTeam } from '../../bff/src/cards/careTeam.ts';
import { loadHeader } from '../../bff/src/cards/header.ts';
import { loadMedications } from '../../bff/src/cards/medications.ts';
import { loadProblems } from '../../bff/src/cards/problems.ts';
import { loadVitals } from '../../bff/src/cards/vitals.ts';
import { localDateTimeInZone } from '../../bff/src/clock.ts';
import { lookupPatientByMrn } from '../../bff/src/cards/patientLookup.ts';
import { loadPrescriptions } from '../../bff/src/cards/prescriptions.ts';
import { createUpstreamClient, type FetchLike } from '../../bff/src/upstream/client.ts';
import { parseMrn, parsePatientUuid } from '../../core/ids.ts';

const token = process.env['DASHBOARD_IT_ACCESS_TOKEN'] ?? '';
const timeZone = process.env['DASHBOARD_OPENEMR_TZ'] ?? 'UTC';
const baseUrl = process.env['DASHBOARD_OPENEMR_INTERNAL_URL'] ?? 'http://localhost:8300';
const record = process.argv.includes('--record');

if (token === '') {
  console.log('integration header: SKIPPED (no token)');
  process.exit(0);
}

const recorded: Record<string, { status: number; body: unknown }> = {};
const recordingFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  recorded[new URL(url).pathname + new URL(url).search] = { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  return new Response(text === '' ? null : text, { status: res.status, headers: res.headers });
};

// Status codes and route ids only (AGENTS.md §PHI).
const upstream = createUpstreamClient({ fetch: recordingFetch, baseUrl, timeoutMs: 10000, logger: pino({ level: 'info' }), now: () => Date.now() });

const cases = [
  { label: 'pid 13 (data-rich)', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', status: 'Active', pid: 13 },
  { label: 'pid 3 (empty-state)', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', status: 'Active', pid: 3 },
  { label: 'pid 12 (deceased)', puuid: 'a2d4d05f-5ff1-4d5d-9b6f-883f99ffc212', status: 'Deceased', pid: 12 },
] as const;

let failures = 0;
for (const c of cases) {
  const patientId = parsePatientUuid(c.puuid);
  if (patientId === null) throw new Error('bad uuid');
  const { card, pid } = await loadHeader({ upstream, today: () => new Date().toISOString().slice(0, 10) }, { patientId, accessToken: token, correlationId: `it-${String(c.pid)}` });
  const row = card.kind === 'ok' ? card.rows[0] : undefined;
  const complete = row !== undefined && [row.name, row.birthDate, row.sex, row.mrn].every((v) => v !== null);
  const ok = card.kind === 'ok' && row?.status === c.status && pid === c.pid && complete;
  if (!ok) failures += 1;
  console.log(`integration header: ${c.label}: ${ok ? 'PASS' : 'FAIL'} (kind=${card.kind}, status=${row?.status ?? '-'}, pid resolved=${String(pid)}, fields complete=${String(complete)})`);
}

for (const [mrnText, expectFound] of [
  ['DASH-SYN-01', true],
  ['DASH-SYN-02', true],
  ['NO-SUCH-MRN-1', false],
] as const) {
  const mrn = parseMrn(mrnText);
  if (mrn === null) throw new Error('bad mrn');
  const result = await lookupPatientByMrn(upstream, { mrn, accessToken: token, correlationId: `it-${mrnText}` });
  const ok = expectFound ? result.kind === 'found' : result.kind === 'not-found';
  if (!ok) failures += 1;
  console.log(`integration lookup: ${mrnText}: ${ok ? 'PASS' : 'FAIL'} (kind=${result.kind})`);
}

// Clinical cards: expected row counts from read-only SQL (walkthroughs/ISSUE-CARDS.md (e)).
const issueDeps = { upstream, nowLocal: () => localDateTimeInZone(Date.now(), timeZone) };
const cardCases = [
  { card: 'allergies', label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', rows: 2, load: loadAllergies },
  { card: 'allergies', label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', rows: 0, load: loadAllergies },
  { card: 'allergies', label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', rows: 1, load: loadAllergies },
  { card: 'problems', label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', rows: 13, load: loadProblems },
  { card: 'problems', label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', rows: 0, load: loadProblems },
  { card: 'problems', label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', rows: 2, load: loadProblems },
  { card: 'medications', label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', rows: 1, load: loadMedications },
  // pid 3: the upstream answers 404 with an empty body; the card must be empty, not an error.
  { card: 'medications', label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', rows: 0, load: loadMedications },
  { card: 'medications', label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', rows: 1, load: loadMedications },
  // Prescriptions (walkthroughs/PRESCRIPTIONS.md (e)): all rows, including inactive ones; pid 3 is HTTP 200 [].
  { card: 'prescriptions', label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', rows: 5, load: loadPrescriptions },
  { card: 'prescriptions', label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', rows: 0, load: loadPrescriptions },
  { card: 'prescriptions', label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', rows: 3, load: loadPrescriptions },
] as const;
for (const c of cardCases) {
  const patientId = parsePatientUuid(c.puuid);
  if (patientId === null) throw new Error('bad uuid');
  const card = await c.load(issueDeps, { patientId, accessToken: token, correlationId: `it-${c.card}` });
  const shown = card.kind === 'ok' ? card.rows.length : 0;
  const ok = c.rows === 0 ? card.kind === 'empty' : card.kind === 'ok' && shown === c.rows;
  if (!ok) failures += 1;
  console.log(`integration ${c.card}: ${c.label}: ${ok ? 'PASS' : 'FAIL'} (kind=${card.kind}, rows=${String(shown)}, expected=${String(c.rows)})`);
}

// Care Team (walkthroughs/CARE-TEAM.md (e)): member rows (all members, inactive ones included), or empty.
for (const c of [
  { label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', members: 3 },
  { label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', members: 0 },
  { label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', members: 1 },
] as const) {
  const patientId = parsePatientUuid(c.puuid);
  if (patientId === null) throw new Error('bad uuid');
  const card = await loadCareTeam({ upstream }, { patientId, accessToken: token, correlationId: 'it-care-team' });
  const members = card.kind === 'ok' ? (card.rows[0]?.members.length ?? 0) : 0;
  const named = card.kind === 'ok' ? (card.rows[0]?.members.filter((m) => m.name !== null).length ?? 0) : 0;
  const ok = c.members === 0 ? card.kind === 'empty' : card.kind === 'ok' && members === c.members;
  if (!ok) failures += 1;
  // Counts only: names and roles are never printed.
  console.log(`integration care-team: ${c.label}: ${ok ? 'PASS' : 'FAIL'} (kind=${card.kind}, members=${String(members)}, named=${String(named)}, expected=${String(c.members)})`);
}

// Vitals (walkthroughs/VITALS.md (e)): the latest NON-deleted set's date, or empty. DASH-SYN-01 and pid 13 each have a
// newer soft-deleted set on the same encounter that must not be the one shown.
for (const c of [
  { label: 'pid 13', puuid: 'a2d4d063-d949-4f5a-9001-01c1d919afc6', date: '2026-04-05 20:06:27' },
  { label: 'pid 3', puuid: 'a2c331a5-3b72-45c1-884e-94015f1f34fa', date: '2014-02-01 21:47:33' },
  { label: 'DASH-SYN-01', puuid: '8e503ab1-b8c0-11f1-8c7a-0ed9af59d05d', date: '2026-04-05 09:10:00' },
  { label: 'DASH-SYN-02', puuid: '8e5045ab-b8c0-11f1-8c7a-0ed9af59d05d', date: null },
] as const) {
  const patientId = parsePatientUuid(c.puuid);
  if (patientId === null) throw new Error('bad uuid');
  const card = await loadVitals({ upstream, today: () => new Date().toISOString().slice(0, 10) }, { patientId, accessToken: token, correlationId: 'it-vitals' });
  const ok = c.date === null ? card.kind === 'empty' : card.kind === 'ok' && card.rows[0]?.date === c.date;
  if (!ok) failures += 1;
  // The expected set's date is compared, never printed (AGENTS.md §PHI).
  console.log(`integration vitals: ${c.label}: ${ok ? 'PASS' : 'FAIL'} (kind=${card.kind}, expected set=${c.date === null ? 'none' : 'latest non-deleted'})`);
}

if (record) {
  const dir = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const meta = { kind: 'recorded', note: 'Recorded from the LOCAL synthetic OpenEMR stack; not production, not live evidence.', date: new Date().toISOString(), baseUrl };
  writeFileSync(`${dir}header-responses.json`, `${JSON.stringify({ _meta: meta, responses: recorded }, null, 2)}\n`);
  console.log(`integration: recorded ${String(Object.keys(recorded).length)} responses to test/fixtures/recorded/header-responses.json (review the diff)`);
}

console.log(`integration: ${failures === 0 ? 'PASS' : `FAIL (${String(failures)})`}`);
process.exit(failures === 0 ? 0 : 1);

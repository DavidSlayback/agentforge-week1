import type { CardResult } from '../../../core/cardResult.ts';
import type { ProblemRow } from '../../../core/dto.ts';
import { dedupeByUuid, filterActiveIssues, sortByBegdateAsc } from '../../../core/rules/issues.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { problemListSchema } from '../upstream/schemas/problem.ts';
import type { IssueCardDeps } from './allergies.ts';
import type { CardContext } from './header.ts';
import { resolvePatient, rowBelongsTo } from './patientRead.ts';

/**
 * The Medical Problems card (W2D-3, slice 01-02-02): `rest.patient.read`, then
 * `rest.problem.list`. Rules: one row per problem (the route can repeat a
 * problem once per linked encounter), `filterActiveIssues` on the raw REST
 * `outcome`/`enddate` (never FHIR `clinical-status` or `activity`, 5.08 / M-8),
 * then `begdate` ascending with NULLs first; title only. The route needs
 * `encounters/notes`, so a 403 here is this card's own `forbidden` (3.14).
 */
export async function loadProblems(deps: IssueCardDeps, ctx: CardContext): Promise<CardResult<ProblemRow>> {
  const { patientId, accessToken, correlationId } = ctx;
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.problem.list', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: problemListSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
  if (mapped.kind === 'empty') return { kind: 'empty', patientId };
  const mismatch = !mapped.value.every((row) => row.puuid.toLowerCase() === patientId && rowBelongsTo(row.pid, patient.pid));
  if (mismatch) return { kind: 'error', patientId, correlationId, code: 'PATIENT_MISMATCH' };

  const active = sortByBegdateAsc(filterActiveIssues(dedupeByUuid(mapped.value), deps.nowLocal()));
  if (active.length === 0) return { kind: 'empty', patientId };
  return { kind: 'ok', patientId, rows: active.map((row): ProblemRow => ({ title: row.title })), notes: [] };
}

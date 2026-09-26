import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { AllergyRow } from '../../../core/dto.ts';
import { buildListLabels, filterActiveIssues, isSevereAllergy, severityLabel } from '../../../core/rules/issues.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { allergyListSchema } from '../upstream/schemas/allergy.ts';
import { listOptionsSchema } from '../upstream/schemas/list.ts';
import type { CardContext } from './header.ts';
import { resolvePatient, rowBelongsTo } from './patientRead.ts';

export interface IssueCardDeps {
  readonly upstream: UpstreamClient;
  /** Now as `YYYY-MM-DD HH:MM:SS` in OpenEMR's timezone (from the injected clock). */
  readonly nowLocal: () => string;
}

export const SEVERITY_LABELS_UNAVAILABLE: GapNote = {
  field: 'severity',
  text: 'Severity labels could not be loaded; raw severity codes are shown.',
};

/**
 * The `severity_ccda` labels, fetched once per card load (not once per row as
 * the legacy template's N+1 did). `null` when the lookup fails: the card then
 * shows raw codes and says so; it does not fail. Not cached across requests,
 * because the list route has its own ACL (`lists/default`) and a label map
 * fetched with one user's token must not serve another user.
 */
async function loadSeverityLabels(upstream: UpstreamClient, ctx: CardContext): Promise<ReadonlyMap<string, string> | null> {
  const mapped = mapUpstream(
    await upstream.get({ routeId: 'rest.list.read', accessToken: ctx.accessToken, correlationId: ctx.correlationId }),
    { shape: 'rest-array', schema: listOptionsSchema, emptyMeans: 'error' },
  );
  return mapped.kind === 'value' ? buildListLabels(mapped.value) : null;
}

/**
 * The Allergies card (W2D-3, slice 01-02-01): `rest.patient.read`, then
 * `rest.allergy.list`, then (only if a row is shown) `rest.list.read`.
 * Rules: `filterActiveIssues` on raw REST `outcome`/`enddate` (5.08); API order
 * kept, no severity sort (4.03); severity label with the raw-code fallback and
 * the severe-only highlight from raw `severity_al`, never FHIR `criticality` (5.18).
 */
export async function loadAllergies(deps: IssueCardDeps, ctx: CardContext): Promise<CardResult<AllergyRow>> {
  const { patientId, accessToken, correlationId } = ctx;
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'rest.allergy.list', pathParams: { puuid: patientId }, accessToken, correlationId }),
    { shape: 'rest-envelope', schema: allergyListSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
  if (mapped.kind === 'empty') return { kind: 'empty', patientId };
  const mismatch = !mapped.value.every((row) => row.puuid.toLowerCase() === patientId && rowBelongsTo(row.pid, patient.pid));
  if (mismatch) return { kind: 'error', patientId, correlationId, code: 'PATIENT_MISMATCH' };

  const active = filterActiveIssues(mapped.value, deps.nowLocal());
  if (active.length === 0) return { kind: 'empty', patientId };

  const labels = await loadSeverityLabels(deps.upstream, ctx);
  const rows = active.map(
    (row): AllergyRow => ({
      title: row.title,
      severityLabel: severityLabel(row.severity_al, labels ?? new Map<string, string>()),
      severe: isSevereAllergy(row.severity_al),
      reaction: row.reaction_title ? row.reaction_title : null,
    }),
  );
  return { kind: 'ok', patientId, rows, notes: labels === null ? [SEVERITY_LABELS_UNAVAILABLE] : [] };
}

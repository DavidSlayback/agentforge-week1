import type { CardResult, GapNote } from '../../../core/cardResult.ts';
import type { CareTeamDto, CareTeamMemberRow } from '../../../core/dto.ts';
import { formatName } from '../../../core/format.ts';
import { parseResourceUuid, type ResourceUuid } from '../../../core/ids.ts';
import { careTeamStatusTitle, chooseCareTeam, parseRelativeReference } from '../../../core/rules/careTeam.ts';
import type { UpstreamClient } from '../upstream/client.ts';
import { failureToCard, mapUpstream } from '../upstream/mapResponse.ts';
import { fhirCareTeamBundleSchema, fhirOrganizationSchema, fhirPractitionerSchema, type FhirCareTeamParticipant } from '../upstream/schemas/careTeam.ts';
import type { CardContext } from './header.ts';
import { resolvePatient } from './patientRead.ts';

export interface CareTeamCardDeps {
  readonly upstream: UpstreamClient;
}

/** 5.05 / M-6: FHIR `CareTeam.participant` has no status, so the legacy "hide inactive members" rule cannot run. */
export const MEMBER_STATUS_NOT_AVAILABLE: GapNote = {
  field: 'member-status',
  text: 'Member status: not available via API, so inactive members are listed too.',
};

/** The legacy Note column (`care_team_member.note`) has no FHIR mapping. */
export const MEMBER_NOTE_NOT_AVAILABLE: GapNote = { field: 'note', text: 'Note: not available via API.' };

/** Shown only when at least one Member or Facility name could not be read. */
export const NAMES_UNAVAILABLE: GapNote = {
  field: 'names',
  text: 'Some names could not be read from the API ("Name unavailable"): the Practitioner and Organization reads need the admin/users permission, OpenEMR serves only users with an NPI as Practitioners, and related-person names are not read.',
};

/** Upper bound on name reads per card load; references beyond it show "Name unavailable". */
export const MAX_NAME_LOOKUPS = 20;

type NameRoute = 'fhir.practitioner.read' | 'fhir.organization.read';

async function readName(upstream: UpstreamClient, ctx: CardContext, routeId: NameRoute, id: ResourceUuid): Promise<string | null> {
  const outcome = await upstream.get({ routeId, pathParams: { id }, accessToken: ctx.accessToken, correlationId: ctx.correlationId });
  if (routeId === 'fhir.practitioner.read') {
    const mapped = mapUpstream(outcome, { shape: 'fhir-resource', schema: fhirPractitionerSchema, emptyMeans: 'error' });
    return mapped.kind === 'value' && mapped.value.id.toLowerCase() === id ? formatName(mapped.value.name) : null;
  }
  const mapped = mapUpstream(outcome, { shape: 'fhir-resource', schema: fhirOrganizationSchema, emptyMeans: 'error' });
  return mapped.kind === 'value' && mapped.value.id.toLowerCase() === id && mapped.value.name ? mapped.value.name : null;
}

interface MemberRef {
  readonly participant: FhirCareTeamParticipant;
  readonly type: 'Practitioner' | 'RelatedPerson';
  readonly id: ResourceUuid;
  readonly facilityId: ResourceUuid | null;
}

/**
 * The Care Team card (W2D-3, slice 01-04-01): `rest.patient.read` (the patient
 * must exist and be readable before an empty Bundle may mean "no team", 6.03),
 * then `fhir.careteam.search?patient=<puuid>`. Every team must name the
 * patient as its subject, else `PATIENT_MISMATCH`. `chooseCareTeam` picks the
 * legacy team deterministically. Every Practitioner / RelatedPerson
 * participant is a row (inactive ones included: M-6); Organization
 * participants are the members' facilities (`CareTeamService::getCareTeamFacilities()`),
 * shown in the Facility column, not as rows. Names come from
 * `fhir.practitioner.read` / `fhir.organization.read`; a failed read shows
 * "Name unavailable" and the card stays up.
 */
export async function loadCareTeam(deps: CareTeamCardDeps, ctx: CardContext): Promise<CardResult<CareTeamDto>> {
  const { patientId, accessToken, correlationId } = ctx;
  const patient = await resolvePatient(deps.upstream, ctx);
  if (patient.kind === 'failed') return patient.card;

  const mapped = mapUpstream(
    await deps.upstream.get({ routeId: 'fhir.careteam.search', query: { patient: patientId }, accessToken, correlationId }),
    // "empty" is legitimate only because the patient read above succeeded in this chain (6.03).
    { shape: 'fhir-bundle', schema: fhirCareTeamBundleSchema, emptyMeans: 'empty' },
  );
  if (mapped.kind === 'failure') return failureToCard(mapped.failure, patientId, correlationId);
  if (mapped.kind === 'empty') return { kind: 'empty', patientId };
  const error = (code: 'PATIENT_MISMATCH' | 'SCHEMA_MISMATCH'): CardResult<CareTeamDto> => ({ kind: 'error', patientId, correlationId, code });

  const teams = (mapped.value.entry ?? []).map((e) => e.resource);
  const subjects = teams.map((t) => parseRelativeReference(t.subject?.reference));
  if (!subjects.every((s) => s?.type === 'Patient' && s.id === patientId)) return error('PATIENT_MISMATCH');

  const team = chooseCareTeam(teams);
  if (team === null) return { kind: 'empty', patientId }; // every team is entered-in-error: the legacy query skips them all

  const members: MemberRef[] = [];
  for (const participant of team.participant ?? []) {
    const ref = parseRelativeReference(participant.member?.reference);
    const id = parseResourceUuid(ref?.id);
    if (ref === null || id === null || ref.type === 'Patient') return error('SCHEMA_MISMATCH');
    if (ref.type === 'Organization') continue; // a member's facility, not a member
    let facilityId: ResourceUuid | null = null;
    if (participant.onBehalfOf !== undefined) {
      const org = parseRelativeReference(participant.onBehalfOf.reference);
      facilityId = org?.type === 'Organization' ? parseResourceUuid(org.id) : null;
      if (facilityId === null) return error('SCHEMA_MISMATCH');
    }
    members.push({ participant, type: ref.type, id, facilityId });
  }

  // One read per distinct reference, capped; in parallel.
  const wanted = new Map<string, { routeId: NameRoute; id: ResourceUuid }>();
  for (const m of members) {
    if (m.type === 'Practitioner') wanted.set(`p:${m.id}`, { routeId: 'fhir.practitioner.read', id: m.id });
    if (m.facilityId !== null) wanted.set(`o:${m.facilityId}`, { routeId: 'fhir.organization.read', id: m.facilityId });
  }
  const lookups = [...wanted.entries()].slice(0, MAX_NAME_LOOKUPS);
  const names = new Map<string, string | null>(
    await Promise.all(lookups.map(async ([key, l]) => [key, await readName(deps.upstream, ctx, l.routeId, l.id)] as const)),
  );

  const rows = members.map(
    (m): CareTeamMemberRow => ({
      type: m.type === 'Practitioner' ? 'Provider' : 'Related Person',
      name: m.type === 'Practitioner' ? (names.get(`p:${m.id}`) ?? null) : null,
      role: m.participant.role?.[0]?.coding?.[0]?.display ?? m.participant.role?.[0]?.text ?? '',
      facility: m.facilityId === null ? '' : (names.get(`o:${m.facilityId}`) ?? null),
      since: m.participant.period?.start ?? '',
    }),
  );
  const unavailable = rows.some((r) => r.name === null || r.facility === null);
  const notes = [MEMBER_STATUS_NOT_AVAILABLE, MEMBER_NOTE_NOT_AVAILABLE, ...(unavailable ? [NAMES_UNAVAILABLE] : [])];
  const dto: CareTeamDto = { teamName: team.name ?? '', statusTitle: careTeamStatusTitle(team.status), members: rows };
  return { kind: 'ok', patientId, rows: [dto], notes };
}

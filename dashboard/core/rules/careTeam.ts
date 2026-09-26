/**
 * Parity rules for the Care Team card (`walkthroughs/CARE-TEAM.md`), reproduced
 * from `CareTeamService::getCareTeamData()` for data served by FHIR `CareTeam`.
 * Pure.
 */

/**
 * The `Care_Team_Status` list titles (local `list_options`, read with SELECT on
 * 2026-09-25). FHIR `CareTeam.status` carries only the code; the legacy badge
 * shows the title. The code set is closed (`FhirCareTeamService::CARE_TEAM_STATII`).
 */
export const CARE_TEAM_STATUS_TITLES: Readonly<Record<string, string>> = {
  active: 'Active',
  proposed: 'Proposed',
  suspended: 'Suspended',
  inactive: 'Inactive',
  'entered-in-error': 'Entered In Error',
};

/** The status title, or the raw code when it is outside the closed set (never guessed). */
export function careTeamStatusTitle(status: string | undefined): string {
  if (status === undefined) return '';
  return CARE_TEAM_STATUS_TITLES[status] ?? status;
}

export interface TeamLike {
  readonly id: string;
  readonly name?: string | undefined;
  readonly status?: string | undefined;
}

/**
 * Sort key for `ORDER BY ct.team_name`: MySQL's default collation compares
 * case-insensitively, and a missing name (OpenEMR omits `name` for an empty
 * `team_name`) sorts first, as NULL and '' do in MySQL.
 */
function nameKey(team: TeamLike): string {
  return (team.name ?? '').toLowerCase();
}

/**
 * Pick the one team the legacy card shows (`CareTeamService::getCareTeamData()`,
 * `src/Services/CareTeamService.php:550-671@legacy-baseline`): teams marked
 * `entered-in-error` are ignored; of the rest, ordered by name, the first
 * `active` one, else the first one. FHIR search has no `ORDER BY`, so the port
 * orders the Bundle itself: name (case-insensitive, missing first), then the
 * exact name, then the resource `id` as a deterministic tiebreak (the legacy
 * second key, `date_created`, is not in the FHIR resource). The result does not
 * depend on Bundle order. `null` when no team qualifies.
 */
export function chooseCareTeam<T extends TeamLike>(teams: readonly T[]): T | null {
  const ordered = teams
    .filter((t) => t.status !== 'entered-in-error')
    .sort((a, b) => {
      const ka = nameKey(a);
      const kb = nameKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      const na = a.name ?? '';
      const nb = b.name ?? '';
      if (na !== nb) return na < nb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return ordered.find((t) => t.status === 'active') ?? ordered[0] ?? null;
}

export type MemberResourceType = 'Practitioner' | 'Organization' | 'RelatedPerson' | 'Patient';

const REFERENCE_RE = /^(Practitioner|Organization|RelatedPerson|Patient)\/([0-9A-Fa-f-]{36})$/;

/**
 * Split a relative FHIR reference as `UtilsService::createRelativeReference()`
 * writes it (`Practitioner/<uuid>`). `null` for any other shape; the id is
 * validated again (uuid) before it is used in a URL.
 */
export function parseRelativeReference(reference: string | undefined): { readonly type: MemberResourceType; readonly id: string } | null {
  if (reference === undefined) return null;
  const m = REFERENCE_RE.exec(reference);
  if (!m?.[1] || !m[2]) return null;
  return { type: m[1] as MemberResourceType, id: m[2].toLowerCase() };
}

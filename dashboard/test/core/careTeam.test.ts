import { describe, expect, it } from 'vitest';
import { careTeamStatusTitle, chooseCareTeam, parseRelativeReference, type TeamLike } from '../../core/rules/careTeam.ts';

const t = (id: string, name: string | undefined, status: string | undefined): TeamLike => ({ id, name, status });

/** Every ordering of a small list, to prove the choice does not depend on Bundle order. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe('chooseCareTeam: the legacy "first active by team_name, else first" rule, made deterministic', () => {
  it('picks the first active team by name, skipping an earlier-named inactive one', () => {
    const teams = [t('id-c', 'Cardiology', 'active'), t('id-a', 'Allergy', 'inactive'), t('id-b', 'Behavioral', 'active')];
    expect(chooseCareTeam(teams)?.id).toBe('id-b');
  });

  it('with no active team, picks the first by name', () => {
    expect(chooseCareTeam([t('id-z', 'Zeta', 'suspended'), t('id-m', 'Mu', 'proposed')])?.id).toBe('id-m');
  });

  it('compares names case-insensitively (MySQL default collation) and puts a missing name first', () => {
    expect(chooseCareTeam([t('id-2', 'beta', 'active'), t('id-1', 'Alpha', 'active')])?.id).toBe('id-1');
    expect(chooseCareTeam([t('id-2', 'Alpha', 'active'), t('id-1', undefined, 'active')])?.id).toBe('id-1');
  });

  it('ignores entered-in-error teams entirely (the legacy WHERE clause), and returns null when none is left', () => {
    expect(chooseCareTeam([t('id-a', 'A', 'entered-in-error'), t('id-b', 'B', 'inactive')])?.id).toBe('id-b');
    expect(chooseCareTeam([t('id-a', 'A', 'entered-in-error')])).toBeNull();
    expect(chooseCareTeam([])).toBeNull();
  });

  it('breaks a name tie by resource id, so the result is the same for every Bundle order', () => {
    const teams = [t('id-3', 'Same', 'active'), t('id-1', 'Same', 'active'), t('id-2', 'same', 'active'), t('id-0', 'Other', 'inactive')];
    const chosen = new Set(permutations(teams).map((p) => chooseCareTeam(p)?.id));
    expect([...chosen]).toEqual(['id-1']);
  });

  it('does not mutate its input', () => {
    const teams = [t('id-b', 'B', 'active'), t('id-a', 'A', 'active')];
    chooseCareTeam(teams);
    expect(teams.map((x) => x.id)).toEqual(['id-b', 'id-a']);
  });
});

describe('careTeamStatusTitle and parseRelativeReference', () => {
  it('maps the 5 Care_Team_Status codes to their titles and keeps any other code raw', () => {
    expect(['active', 'proposed', 'suspended', 'inactive', 'entered-in-error'].map(careTeamStatusTitle)).toEqual([
      'Active',
      'Proposed',
      'Suspended',
      'Inactive',
      'Entered In Error',
    ]);
    expect(careTeamStatusTitle('on-hold')).toBe('on-hold');
    expect(careTeamStatusTitle(undefined)).toBe('');
  });

  it('splits Type/<uuid> references and rejects anything else', () => {
    expect(parseRelativeReference('Practitioner/A2C331A5-4021-4F9B-893F-CD7DC6DB1147')).toEqual({ type: 'Practitioner', id: 'a2c331a5-4021-4f9b-893f-cd7dc6db1147' });
    expect(parseRelativeReference('Organization/a2c33197-4fba-465e-a39c-58e4fdfde53a')?.type).toBe('Organization');
    expect(parseRelativeReference('https://elsewhere/Practitioner/a2c331a5-4021-4f9b-893f-cd7dc6db1147')).toBeNull();
    expect(parseRelativeReference('Device/a2c331a5-4021-4f9b-893f-cd7dc6db1147')).toBeNull();
    expect(parseRelativeReference('Practitioner/5')).toBeNull();
    expect(parseRelativeReference(undefined)).toBeNull();
  });
});

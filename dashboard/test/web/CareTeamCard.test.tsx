import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CareTeamDto } from '../../core/dto.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { CareTeamCard } from '../../web/src/cards/CareTeamCard.tsx';
import type { CardState } from '../../web/src/useCard.ts';

function uuid(v: string): PatientUuid {
  const p = parsePatientUuid(v);
  if (p === null) throw new Error('bad uuid');
  return p;
}
const P13 = uuid('a2d4d063-d949-4f5a-9001-01c1d919afc6');

// Synthetic display values.
const TEAM: CareTeamDto = {
  teamName: 'Synthetic team',
  statusTitle: 'Active',
  members: [
    { type: 'Provider', name: 'Synthetic Prac', role: 'Primary Care Provider', facility: 'Synthetic Clinic', since: '2019-04-01' },
    { type: 'Provider', name: null, role: 'Specialist', facility: '', since: '' },
    { type: 'Related Person', name: null, role: 'Caregiver', facility: null, since: '' },
  ],
};
const NOTES = [
  { field: 'member-status', text: 'Member status: not available via API, so inactive members are listed too.' },
  { field: 'note', text: 'Note: not available via API.' },
];

async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe('CareTeamCard', () => {
  it('shows the team name with its status badge and the legacy columns, one row per member', async () => {
    const { container } = render(<CareTeamCard state={{ kind: 'ok', patientId: P13, rows: [TEAM], notes: NOTES }} />);
    expect(screen.getByRole('heading', { name: 'Care Team' })).toBeTruthy();
    expect(container.querySelector('.team-name')?.textContent).toBe('Synthetic team Active');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Type', 'Member', 'Role', 'Facility', 'Since', 'Status', 'Note']);
    const cells = [...container.querySelectorAll('tr.team-member')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(cells).toEqual([
      ['Provider', 'Synthetic Prac', 'Primary Care Provider', 'Synthetic Clinic', '2019-04-01', 'Not available via API', 'Not available via API'],
      ['Provider', 'Name unavailable', 'Specialist', '', '', 'Not available via API', 'Not available via API'],
      ['Related Person', 'Name unavailable', 'Caregiver', 'Name unavailable', '', 'Not available via API', 'Not available via API'],
    ]);
    expect(container.querySelector('[data-note="member-status"]')?.textContent).toMatch(/inactive members are listed too/);
    await expectNoAxeViolations(container);
  });

  it('every Status and Note cell reads "Not available via API"', () => {
    const { container } = render(<CareTeamCard state={{ kind: 'ok', patientId: P13, rows: [TEAM], notes: NOTES }} />);
    const gaps = [...container.querySelectorAll('[data-gap="status"], [data-gap="note"]')].map((td) => td.textContent);
    expect(gaps).toHaveLength(6);
    expect(new Set(gaps)).toEqual(new Set(['Not available via API']));
  });

  it('renders a stored-XSS payload as literal text, never markup (2.02: the legacy card used innerHTML)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const hostile: CareTeamDto = {
      teamName: payload,
      statusTitle: 'Active',
      members: [{ type: 'Provider', name: payload, role: payload, facility: payload, since: payload }],
    };
    const { container } = render(<CareTeamCard state={{ kind: 'ok', patientId: P13, rows: [hostile], notes: [] }} />);
    expect(container.querySelector('img')).toBeNull();
    const row = [...container.querySelectorAll('tr.team-member td')].map((td) => td.textContent);
    expect(row.slice(1, 5)).toEqual([payload, payload, payload, payload]);
    expect(container.querySelector('.team-name')?.textContent).toContain(payload);
  });

  it('a team with no members says so; an empty result says exactly "Nothing Recorded" (the legacy card had no text, 7.14)', async () => {
    const noMembers = render(<CareTeamCard state={{ kind: 'ok', patientId: P13, rows: [{ ...TEAM, members: [] }], notes: NOTES }} />);
    expect(noMembers.container.textContent).toContain('No members listed.');
    cleanup();
    const { container } = render(<CareTeamCard state={{ kind: 'empty', patientId: P13 }} />);
    expect(container.querySelector('.card-body')?.textContent).toBe('Nothing Recorded');
    await expectNoAxeViolations(container);
  });

  const states: [string, CardState<CareTeamDto>, RegExp][] = [
    ['loading', { kind: 'loading' }, /^Loading Care Team…$/],
    ['forbidden', { kind: 'forbidden', patientId: P13 }, /^Not authorized for this section\.$/],
    ['error', { kind: 'error', patientId: P13, correlationId: 'corr-4', code: 'UPSTREAM_OPERATION_OUTCOME' }, /^Couldn't load Care Team\. Reference corr-4 \(UPSTREAM_OPERATION_OUTCOME\)\.$/],
    ['reauth', { kind: 'reauth' }, /session has ended/],
  ];
  it.each(states)('state %s is distinct from empty and from data, and axe-clean', async (kind, state, text) => {
    const { container } = render(<CareTeamCard state={state} />);
    expect(container.querySelector('.card-body')?.textContent).toMatch(text);
    expect(container.textContent).not.toContain('Nothing Recorded');
    expect(container.querySelector('tr.team-member')).toBeNull();
    expect(container.querySelector('[data-card="care-team"]')?.getAttribute('data-state')).toBe(kind);
    await expectNoAxeViolations(container);
  });
});

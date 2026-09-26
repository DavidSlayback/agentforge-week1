import type { CareTeamDto } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

/** Status and Note cells for every member (M-6): an explained gap. */
export const NOT_AVAILABLE = 'Not available via API';
/** A Member or Facility name the API would not give us. */
export const NAME_UNAVAILABLE = 'Name unavailable';

function CareTeamBody({ team }: { readonly team: CareTeamDto }) {
  return (
    <>
      <h3 className="team-name">
        {team.teamName}
        {team.teamName !== '' && team.statusTitle !== '' ? (
          <>
            {' '}
            <span className="badge" data-team-status={team.statusTitle}>
              {team.statusTitle}
            </span>
          </>
        ) : null}
      </h3>
      {team.members.length === 0 ? (
        <p className="state state-empty">No members listed.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Facility</th>
              <th scope="col">Since</th>
              <th scope="col">Status</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {team.members.map((m, i) => (
              // 8.15: members have no stable id on the wire; keyed by position.
              <tr key={i} className="team-member">
                <td>{m.type}</td>
                <td className={m.name === null ? 'gap-cell' : undefined}>{m.name ?? NAME_UNAVAILABLE}</td>
                <td>{m.role}</td>
                <td className={m.facility === null ? 'gap-cell' : undefined}>{m.facility ?? NAME_UNAVAILABLE}</td>
                <td>{m.since}</td>
                <td className="gap-cell" data-gap="status">
                  {NOT_AVAILABLE}
                </td>
                <td className="gap-cell" data-gap="note">
                  {NOT_AVAILABLE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Care Team (legacy `templates/patient/card/manage_care_team.html.twig`, view
 * mode only; the port is read-only): the chosen team's name and status badge,
 * then one row per member. All text goes through JSX escaping, never
 * `innerHTML` (the legacy stored XSS, 2.02). Empty reads "Nothing Recorded";
 * the legacy card had no empty text at all (7.14).
 */
export function CareTeamCard({ state }: { readonly state: CardState<CareTeamDto> }) {
  return (
    <Card
      id="care-team"
      title="Care Team"
      state={state}
      renderRows={(rows) => (
        <>
          {rows.map((team, i) => (
            <CareTeamBody key={i} team={team} />
          ))}
        </>
      )}
    />
  );
}

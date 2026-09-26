import type { AllergyRow } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

function AllergyRows({ rows }: { readonly rows: readonly AllergyRow[] }) {
  return (
    <ul className="issue-list">
      {rows.map((row, i) => (
        // Rows have no stable id on the wire and never reorder: keyed by position.
        <li key={i} className="issue" title={`${row.title} Reaction: ${row.reaction ?? ''} - ${row.severityLabel}`}>
          {row.title} (
          <span className={row.severe ? 'severity severity-severe' : 'severity'} data-severe={row.severe ? 'true' : 'false'}>
            {row.severityLabel}
          </span>
          )
        </li>
      ))}
    </ul>
  );
}

/**
 * Allergies (legacy `templates/patient/card/allergies.html.twig`): title plus
 * the severity label in parentheses; severe, life-threatening and fatal rows
 * are highlighted, never moved (4.03). Rows arrive filtered and in API order.
 */
export function AllergiesCard({ state }: { readonly state: CardState<AllergyRow> }) {
  return <Card id="allergies" title="Allergies" state={state} renderRows={(rows) => <AllergyRows rows={rows} />} />;
}

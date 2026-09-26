import type { ProblemRow } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

function ProblemRows({ rows }: { readonly rows: readonly ProblemRow[] }) {
  return (
    <ul className="issue-list">
      {rows.map((row, i) => (
        // Rows have no stable id on the wire and never reorder: keyed by position.
        <li key={i} className="issue">
          {row.title}
        </li>
      ))}
    </ul>
  );
}

/**
 * Medical Problems (legacy `templates/patient/card/medical_problems.html.twig`):
 * title only. Rows arrive filtered and sorted by `begdate` ascending.
 */
export function ProblemsCard({ state }: { readonly state: CardState<ProblemRow> }) {
  return <Card id="problems" title="Medical Problems" state={state} renderRows={(rows) => <ProblemRows rows={rows} />} />;
}

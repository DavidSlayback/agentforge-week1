import type { MedicationRow } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

/** 7.25: Medications and Prescriptions are separate lists; each card says which one it is. */
export const MEDICATIONS_SOURCE = "The patient's medication list (active entries); prescriptions are listed separately.";

function MedicationRows({ rows }: { readonly rows: readonly MedicationRow[] }) {
  return (
    <ul className="issue-list">
      {rows.map((row, i) => (
        // Rows have no stable id on the wire and never reorder: keyed by position.
        <li key={i} className="issue">
          {row.title}
          {row.dosage === null ? null : (
            <>
              {' '}
              <span className="med-dosage" data-field="dosage">
                {row.dosage}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Medications (legacy `templates/patient/card/medication.html.twig`): the
 * title, then the dosage instructions where recorded, as the legacy
 * `<span>{{ m.drug_dosage_instructions }}</span>` does. Instructions come from
 * FHIR MedicationRequest (slice 01-06-04); when they are missing for a reason
 * other than "none recorded", the BFF sends a note. Rows arrive filtered and
 * sorted by `begdate` ascending.
 */
export function MedicationsCard({ state }: { readonly state: CardState<MedicationRow> }) {
  return <Card id="medications" title="Medications" source={MEDICATIONS_SOURCE} state={state} renderRows={(rows) => <MedicationRows rows={rows} />} />;
}

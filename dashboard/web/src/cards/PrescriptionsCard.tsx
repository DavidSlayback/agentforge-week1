import type { PrescriptionRow } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

/** 7.25: Prescriptions and Medications are separate lists; each card says which one it is. */
export const PRESCRIPTIONS_SOURCE = 'Prescriptions written in OpenEMR, every status, as the legacy card lists them; the medication list is separate.';

/** The Refills cell for every row (M-7): an explained gap, never 0 or blank. */
export const REFILLS_PLACEHOLDER = 'Not available via API';

/** The legacy Rx card's own empty text (`general_fragment.html`: `{xlt t='None'}`). */
export const PRESCRIPTIONS_EMPTY_TEXT = 'None';

function PrescriptionTable({ rows }: { readonly rows: readonly PrescriptionRow[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Drug</th>
          <th scope="col">Details</th>
          <th scope="col">Qty</th>
          <th scope="col">Refills</th>
          <th scope="col">Filled</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          // Rows have no stable id on the wire and arrive in their final order: keyed by position.
          <tr key={i} className="rx-row">
            <td>{row.drug}</td>
            <td>{row.details}</td>
            <td>{row.quantity}</td>
            <td className="gap-cell" data-gap="refills">
              {REFILLS_PLACEHOLDER}
            </td>
            <td>{row.filled}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Prescriptions (legacy `templates/prescription/general_fragment.html` inside
 * `templates/patient/card/rx.html.twig`): Drug, Details, Qty, Refills, Filled.
 * All rows, sorted by the BFF. Empty reads "None", the legacy card's text.
 */
export function PrescriptionsCard({ state }: { readonly state: CardState<PrescriptionRow> }) {
  return (
    <Card
      id="prescriptions"
      title="Prescriptions"
      source={PRESCRIPTIONS_SOURCE}
      emptyText={PRESCRIPTIONS_EMPTY_TEXT}
      state={state}
      renderRows={(rows) => <PrescriptionTable rows={rows} />}
    />
  );
}

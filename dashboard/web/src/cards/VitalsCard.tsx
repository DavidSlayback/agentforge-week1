import { Fragment } from 'react';
import type { VitalsDto } from '../../../core/dto.ts';
import { Card } from '../components/Card.tsx';
import type { CardState } from '../useCard.ts';

function VitalsBody({ vitals }: { readonly vitals: VitalsDto }) {
  return (
    <>
      <p className="vitals-date">
        Most recent vitals from: <span data-vitals-date="">{vitals.date}</span>
      </p>
      <dl className="vitals-fields">
        {vitals.fields.map((f) => (
          <Fragment key={f.label}>
            <dt>{f.label}:</dt>
            <dd>{f.value}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

/**
 * Vitals (legacy `interface/patient_file/summary/vitals_fragment.php` +
 * `interface/forms/vitals/report.php`): "Most recent vitals from: <date>" and
 * the fields in the legacy order. The set is the latest NON-DELETED one (a
 * deliberate deviation from the legacy join bug, 5.01), chosen by the BFF.
 */
export function VitalsCard({ state }: { readonly state: CardState<VitalsDto> }) {
  return (
    <Card
      id="vitals"
      title="Vitals"
      state={state}
      renderRows={(rows) => (
        <>
          {rows.map((v, i) => (
            <VitalsBody key={i} vitals={v} />
          ))}
        </>
      )}
    />
  );
}

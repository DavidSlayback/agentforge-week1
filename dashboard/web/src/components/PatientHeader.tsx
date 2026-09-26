import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { HeaderDto } from '../../../core/dto.ts';
import type { CardState } from '../useCard.ts';
import { NonDataState } from './States.tsx';

const NOT_RECORDED = 'Not recorded';

function HeaderFields({ header }: { readonly header: HeaderDto }) {
  const dob = header.birthDate ?? NOT_RECORDED;
  const age = header.age ?? NOT_RECORDED;
  return (
    <dl className="header-fields">
      <div>
        <dt>Name</dt>
        <dd data-field="name">{header.name ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt>DOB</dt>
        <dd data-field="dob">
          {dob} ({header.ageLabel}: {age})
        </dd>
      </div>
      <div>
        <dt>Sex</dt>
        <dd data-field="sex">{header.sex ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt>MRN</dt>
        <dd data-field="mrn">{header.mrn ?? NOT_RECORDED}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd data-field="status" className={header.status === 'Deceased' ? 'status status-deceased' : 'status status-active'}>
          {header.status}
          {header.deceasedDate ? ` (${header.deceasedDate})` : ''}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The persistent patient header (W2D-2). It renders only from a successful,
 * authorized BFF answer for the patient in the route (3.02, 7.04).
 */
/** Room kept between the bottom of the sticky bar and a focused or scrolled-to element. */
const FOCUS_GAP_PX = 8;

/**
 * Keeps `--sticky-header-offset` (the page's `scroll-padding-top`) equal to the bar's real height.
 * The stylesheet's fixed fallbacks (5 rem, 9 rem on phones) are too small when the fields wrap onto
 * more lines (a long name, a 320 px viewport), which left focused controls partly under the bar
 * (WCAG 2.4.11). Without ResizeObserver the fallbacks stay.
 */
function useStickyOffset(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const update = (): void => {
      root.style.setProperty('--sticky-header-offset', `${Math.ceil(el.getBoundingClientRect().height) + FOCUS_GAP_PX}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--sticky-header-offset');
    };
  }, [ref]);
}

export function PatientHeader({ state }: { readonly state: CardState<HeaderDto> }) {
  const ref = useRef<HTMLElement>(null);
  useStickyOffset(ref);
  return (
    <section ref={ref} className="patient-header" aria-label="Patient header">
      {state.kind === 'ok' && state.rows[0] ? (
        <HeaderFields header={state.rows[0]} />
      ) : state.kind === 'ok' ? (
        <NonDataState state={{ kind: 'error', patientId: state.patientId, correlationId: 'none', code: 'SCHEMA_MISMATCH' }} title="the patient header" />
      ) : (
        <NonDataState state={state} title="the patient header" />
      )}
    </section>
  );
}

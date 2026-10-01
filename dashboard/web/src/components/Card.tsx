import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { GapNote } from '../../../core/cardResult.ts';
import type { CardState } from '../useCard.ts';
import { RenderErrorBoundary } from './RenderErrorBoundary.tsx';
import { NonDataState } from './States.tsx';

const STORAGE_PREFIX = 'dashboard.card.';

/**
 * Per-viewer collapse state (7.05, 7.13): default expanded, fixed in code; a
 * viewer's own toggle is remembered in `localStorage`. Storage can be missing
 * or throw (private mode, blocked site data), so every access is guarded and
 * the card still works without it.
 */
function readCollapsed(id: string): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${id}.collapsed`) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(id: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${id}.collapsed`, collapsed ? '1' : '0');
  } catch {
    // Not persisted; the toggle still works for this page view.
  }
}

/**
 * Whether the element is wider inside than out (a wide table on a phone or at high zoom).
 * Re-checked when the element resizes, and after every render of the card (new rows).
 */
function useHorizontalOverflow(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = (): void => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', check);
      return () => {
        window.removeEventListener('resize', check);
      };
    }
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run when the card's content changes
  }, deps);
  return overflowing;
}

export interface CardProps<T> {
  /** Stable DOM / storage id, e.g. `allergies`. */
  readonly id: string;
  /** The legacy card title, e.g. "Allergies". */
  readonly title: string;
  readonly state: CardState<T>;
  readonly renderRows: (rows: readonly T[]) => ReactNode;
  /** Optional one-line source label under the title (7.25). */
  readonly source?: string;
  /** Empty-state text; defaults to "Nothing Recorded" (4.02). */
  readonly emptyText?: string;
}

function Notes({ notes }: { readonly notes: readonly GapNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="card-notes">
      {notes.map((n) => (
        <li key={n.field} data-note={n.field}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/** Calls the card's row renderer inside the boundary, so a throw in it is caught there. */
function CardRows({ render }: { readonly render: () => ReactNode }) {
  return <>{render()}</>;
}

/** What a card shows when its data rendered with an error: the title stays, no error text is shown. */
function RenderErrorState({ id, title }: { readonly id: string; readonly title: string }) {
  return (
    <p className="state state-error" role="alert" data-render-error={id}>
      Couldn&apos;t display {title} (RENDER_ERROR).
    </p>
  );
}

/**
 * The shared card shell: title bar with a collapse toggle, and exactly one of
 * loading, ok, empty ("Nothing Recorded"), forbidden, error or reauth
 * (MIGRATION-REACT.md §2.5). No upstream text is ever rendered (6.01).
 */
export function Card<T>({ id, title, state, renderRows, source, emptyText }: CardProps<T>) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(id, next);
  };
  const headingId = `card-${id}-title`;
  const bodyId = `card-${id}-body`;
  const bodyRef = useRef<HTMLDivElement>(null);
  // A card body that scrolls sideways (Prescriptions, Care Team or Vitals on a phone or at 400 % zoom)
  // must be reachable and named for keyboard and screen-reader users (WCAG 2.1.1, 4.1.2). Chrome makes
  // such scrollers focusable on its own, but unnamed; Safari does not make them focusable at all.
  const scrolls = useHorizontalOverflow(bodyRef, [state, collapsed]);
  return (
    <section className="card" aria-labelledby={headingId} data-card={id} data-state={state.kind}>
      <div className="card-head">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="card-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
          {collapsed ? 'Expand' : 'Collapse'}
          <span className="visually-hidden"> {title}</span>
        </button>
      </div>
      {source ? <p className="card-source">{source}</p> : null}
      <div
        id={bodyId}
        ref={bodyRef}
        className="card-body"
        hidden={collapsed}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must be focusable to be scrolled by keyboard (axe scrollable-region-focusable); only while it overflows
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? `${title}, scrolls sideways` : undefined}
      >
        {state.kind === 'ok' ? (
          // A render throw stays inside this card: it shows its error state, the other cards keep rendering.
          <RenderErrorBoundary resetKey={state} fallback={<RenderErrorState id={id} title={title} />}>
            <CardRows render={() => renderRows(state.rows)} />
            <Notes notes={state.notes} />
          </RenderErrorBoundary>
        ) : state.kind === 'forbidden' ? (
          // 3.14: one card can be denied while the others load (e.g. Medical Problems needs encounters/notes).
          <p className="state state-forbidden">Not authorized for this section.</p>
        ) : (
          <NonDataState state={state} title={title} {...(emptyText === undefined ? {} : { emptyText })} />
        )}
      </div>
    </section>
  );
}

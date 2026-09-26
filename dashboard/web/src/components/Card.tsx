import { useState, type ReactNode } from 'react';
import type { GapNote } from '../../../core/cardResult.ts';
import type { CardState } from '../useCard.ts';
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
      <div id={bodyId} className="card-body" hidden={collapsed}>
        {state.kind === 'ok' ? (
          <>
            {renderRows(state.rows)}
            <Notes notes={state.notes} />
          </>
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

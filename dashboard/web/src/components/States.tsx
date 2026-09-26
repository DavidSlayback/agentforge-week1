import type { CardState } from '../useCard.ts';
import { BASE } from '../api.ts';

/**
 * The non-data states every card shares (MIGRATION-REACT.md §2.5). Each is
 * visually and textually distinct; upstream error text is never shown, only a
 * reference id (6.01).
 */
export function NonDataState({ state, title }: { readonly state: Exclude<CardState<unknown>, { kind: 'ok' }>; readonly title: string }) {
  switch (state.kind) {
    case 'loading':
      return (
        <p className="state state-loading" role="status">
          Loading {title}…
        </p>
      );
    case 'empty':
      return <p className="state state-empty">Nothing Recorded</p>;
    case 'forbidden':
      return <p className="state state-forbidden">You are not authorized to view {title}.</p>;
    case 'reauth':
      return (
        <p className="state state-reauth" role="alert">
          Your session has ended. <a href={`${BASE}/login?returnTo=${encodeURIComponent(window.location.pathname)}`}>Sign in again</a>
        </p>
      );
    case 'error':
      return (
        <p className="state state-error" role="alert">
          Couldn&apos;t load {title}. Reference {state.correlationId} ({state.code}).
        </p>
      );
  }
}

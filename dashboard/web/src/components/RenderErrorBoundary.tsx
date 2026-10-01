import { Component, type ReactNode } from 'react';

interface Props {
  /** Shown instead of the children after one of them throws while rendering. */
  readonly fallback: ReactNode;
  /** When this changes (a new card state, another patient), a failed boundary tries its children again. */
  readonly resetKey?: unknown;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/**
 * Contains a render throw (an `assertNever`, a malformed row) to the part of the
 * page that threw (W3 hardening H4). Without it React unmounts the whole SPA
 * and the page goes blank. The error itself is never rendered or logged here:
 * its message can carry the value that failed (`assertNever` stringifies it).
 */
export class RenderErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

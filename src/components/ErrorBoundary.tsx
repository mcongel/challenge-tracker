import { Component } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn, errorMessage, primaryBtnCls } from '../lib/utils';

interface Props {
  children: ReactNode;
}

interface State {
  /** Discriminator, not a sentinel — a thrown null/undefined must still trip. */
  caught: boolean;
  error?: unknown;
}

/** Last line of defense: a render crash shows a house-styled card instead of
 * a white page. Mount it keyed by route so navigating away resets it, and
 * Reload stays the full remedy — state re-derives from the DB. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { caught: false };

  static getDerivedStateFromError(error: unknown): State {
    return { caught: true, error };
  }

  render() {
    if (!this.state.caught) return this.props.children;
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-lg mx-auto mt-8">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Something broke rendering this screen</p>
            <p className="mt-1 text-sm text-gray-600">
              Your data is safe — this is a display crash, not a data problem. Another screen may
              work fine; reloading re-reads everything from the database.
            </p>
            <p className="mt-2 text-xs text-gray-400 font-mono break-all">
              {errorMessage(this.state.error)}
            </p>
            <button onClick={() => window.location.reload()} className={cn(primaryBtnCls, 'mt-3')}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

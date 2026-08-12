import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { errorMessage } from '../lib/utils';

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

/** Last line of defense: a render crash shows a house-styled card instead of
 * a white page. Reload is the honest remedy — state re-derives from the DB. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error == null) return this.props.children;
    return (
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-lg mx-auto mt-8">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Something broke rendering this screen</p>
            <p className="mt-1 text-sm text-gray-600">
              Your data is safe — this is a display crash, not a data problem. Reloading re-reads
              everything from the database.
            </p>
            <p className="mt-2 text-xs text-gray-400 font-mono break-all">
              {errorMessage(this.state.error)}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

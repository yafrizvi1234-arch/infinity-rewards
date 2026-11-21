import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      let friendlyMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed?.error) {
          friendlyMessage = `Database ${parsed.operationType ?? 'operation'} failed (${parsed.path ?? 'unknown path'}): ${parsed.error}`;
        }
      } catch {
        // Use raw message
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#060A17] p-4 text-slate-100">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/15 text-rose-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="font-display mt-4 text-xl font-bold text-white">
              Something Went Wrong
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300 break-words">
              {friendlyMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

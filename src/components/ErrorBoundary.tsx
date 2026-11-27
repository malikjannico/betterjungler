import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Keep recovery UI strictly free of M3 styling when used inside the isolated HUD window. */
  compact?: boolean;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Top-level error boundary preventing unrecoverable white-screen crashes in both
 * the main WebView2 window and the isolated HUD overlay window.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message =
      error instanceof Error && error.message ? error.message : 'Unexpected rendering error';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[BetterJungler ErrorBoundary]', error, info.componentStack);
  }

  private handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.compact) {
      return (
        <div
          role="alert"
          style={{
            background: 'rgba(17, 19, 24, 0.94)',
            color: '#e2e2e9',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '12px',
            padding: '10px 14px',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span>HUD recovered from an unexpected error.</span>
          <button
            type="button"
            onClick={this.handleRecover}
            style={{
              background: '#a2c9ff',
              color: '#00315b',
              border: 'none',
              borderRadius: '999px',
              padding: '4px 10px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          background: '#111318',
          color: '#e2e2e9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            background: '#1b1d24',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '20px',
            padding: '24px',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#ffb4ab', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            BetterJungler Recovery
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '8px 0 6px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '13px', color: '#c3c6d0', margin: '0 0 16px', lineHeight: 1.5 }}>
            The interface encountered an unexpected error and recovered to prevent a blank screen.
          </p>
          <div
            style={{
              background: '#111318',
              borderRadius: '10px',
              padding: '10px 12px',
              fontSize: '12px',
              fontFamily: 'monospace',
              color: '#e2e2e9',
              marginBottom: '18px',
              wordBreak: 'break-word',
            }}
          >
            {this.state.message}
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.handleRecover}
              style={{
                background: '#a2c9ff',
                color: '#00315b',
                border: 'none',
                borderRadius: '999px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Restore View
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                background: 'rgba(255,255,255,0.08)',
                color: '#e2e2e9',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '999px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }
}

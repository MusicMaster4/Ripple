import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keep a failed network-backed view from leaving the entire game blank. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Never render exception contents: backend errors may contain request details.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        className="error-state"
        style={{
          minHeight: "70svh",
          display: "grid",
          placeContent: "center",
          gap: "1rem",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1
          style={{
            fontFamily: '"Cormorant Garamond", serif',
            fontSize: "clamp(2rem, 6vw, 3.5rem)",
            fontWeight: 400,
            margin: 0,
          }}
        >
          A moment of stillness.
        </h1>
        <p>Could not open this page. Please try again.</p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            alignItems: "center",
          }}
        >
          <button
            className="button solid"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
          <a className="text-button" href="/">
            Back to the game
          </a>
        </div>
      </main>
    );
  }
}

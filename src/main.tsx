import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./lib/auth";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "@fontsource/anton/latin-400.css";
import "@fontsource/dm-mono/latin-400.css";
import "./styles.css";
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ConvexBetterAuthProvider>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./styles/themes/dark.css";
import "./styles/themes/light.css";
import "./styles/themes/compact.css";
import { useThemeStore } from "./store/themeStore";

// Initialize Sentry for frontend crash reporting (privacy-conscious).
// Set VITE_SENTRY_DSN in your .env to enable; otherwise Sentry is a no-op.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  environment: import.meta.env.DEV ? "development" : "production",
  release: "file-nova-app@1.0.0",
  // Privacy: no PII, no session replay, no user tracking
  sendDefaultPii: false,
  // Only capture unhandled errors
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0,      // disable performance tracing
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
});

// Initialize theme on app load
const initializeTheme = () => {
  useThemeStore.getState().initializeTheme();
};

initializeTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p style={{ padding: "2rem", color: "#ef4444" }}>Something went wrong. The error has been reported.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);

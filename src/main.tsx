import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/themes/dark.css";
import "./styles/themes/light.css";
import "./styles/themes/compact.css";
import { useThemeStore } from "./store/themeStore";

// Initialize theme on app load
const initializeTheme = () => {
  useThemeStore.getState().initializeTheme();
};

initializeTheme();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

const renderPlainApp = () => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

if (!sentryDsn) {
  renderPlainApp();
} else {
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.DEV ? "development" : "production",
        release: "file-nova-app@1.0.0",
        sendDefaultPii: false,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        enabled: true,
      });

      root.render(
        <React.StrictMode>
          <Sentry.ErrorBoundary fallback={<p style={{ padding: "2rem", color: "#ef4444" }}>Something went wrong. The error has been reported.</p>}>
            <App />
          </Sentry.ErrorBoundary>
        </React.StrictMode>,
      );
    })
    .catch(() => {
      renderPlainApp();
    });
}

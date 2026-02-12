// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Initialize Sentry crash reporting (privacy-conscious, opt-in via Settings).
    // The _guard keeps Sentry active for the lifetime of the process.
    // Replace the DSN below with your project's Sentry DSN.
    let _guard = sentry::init(sentry::ClientOptions {
        dsn: option_env!("SENTRY_DSN")
            .and_then(|s| s.parse().ok()),
        release: Some(std::borrow::Cow::Borrowed(env!("CARGO_PKG_VERSION"))),
        environment: Some(if cfg!(debug_assertions) {
            "development".into()
        } else {
            "production".into()
        }),
        // Privacy: only send crash data, no PII
        send_default_pii: false,
        sample_rate: 1.0,
        // Attach panic handler
        auto_session_tracking: true,
        ..sentry::ClientOptions::default()
    });

    file_nova_app_lib::run()
}

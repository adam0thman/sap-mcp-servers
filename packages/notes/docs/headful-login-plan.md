# Visible Notes login browser (#58)

## Cause and fix

An MCP client starts Notes with stdin as a pipe. The old configuration treats a pipe, missing DISPLAY, and NODE_ENV=production as proof that no desktop exists. It therefore discards HEADFUL=true, including on Windows and macOS. Interactive login fails before opening a browser; MFA cannot be completed.

Use one small resolver for both transports. Honor HEADFUL=true on desktop systems. Keep explicit Docker/CI and Linux without DISPLAY or WAYLAND_DISPLAY headless, and log the reason. Keep the note-retrieval browser policy separate; it consumes the authenticated session and does not perform interactive login.

## Validation

- Test Windows, macOS, X11 and Wayland, explicit Docker/CI, production mode, and default headless behavior.
- Test both server configurations with piped stdin.
- Run the actual Notes authenticator with visible Chromium, piped stdin, and a synthetic local IAS flow. Check Chromium reports a headed browser and that the resulting session is saved. Both transports use temporary files, never the developer's saved SAP sessions.
- Build/typecheck and run all Notes unit tests; retest together with the shared-state fix in #81 and login-boundary fix in #49.

Browser test command: `node --test packages/notes/test/headful.browser.mjs`. On Linux run it under `xvfb-run --auto-servernum`.

Release: include this fix in the next `sap-note-search-mcp` patch release. No new auth API or dependency release is required for this change alone.

Verified on macOS / Node 22.18.0: both real headed-browser tests pass with stdin piped, DISPLAY/WAYLAND_DISPLAY absent, and NODE_ENV=production. Reverting the server configuration to main makes both tests fail before browser launch. All 31 Notes unit tests and build/typecheck pass. The browser contexts are explicitly offline and every page response is fulfilled by the fixture.

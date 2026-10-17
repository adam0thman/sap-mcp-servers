# Review plan: shared SSO and Notes login

## PR #81: shared state, session expiry, and version

The default shared state path uses the current directory when HOME is absent. Windows MCP clients can therefore create a different login state per server. Node's `os.homedir()` already handles Windows USERPROFILE and the operating system fallback. Keep the existing environment override and change only the fallback.

Notes also saves browser state in `finally` after discovering a sign-in page. Close and clear that expired browser before cleanup saves state; the next authentication attempt can then create a fresh context. Keep the existing session error and retry flow.

Both Notes transports currently announce 0.3.0 regardless of their package version. Read the installed package manifest once and use its version in MCP initialization and HTTP health.

Validation:

1. Reproduce all paths without HOME, with different working directories, and with explicit paths.
2. Verify a real writable SSO file is preserved after session expiry, browser-close failure still clears the context, successful calls still save state, and retry creates a fresh browser.
3. Verify version through MCP initialization and HTTP health, including the packaged entrypoint.
4. Build, typecheck, auth tests, Notes tests, published-bin smoke tests, and native Windows CI.

## PR #82: visible login browser

A pipe on stdin identifies the MCP transport, not whether a desktop exists. DISPLAY is only relevant on Linux. Keep a small environment-based helper shared by the two Notes transports: explicit Docker/CI and display-less Linux stay headless with an explanation; Windows/macOS and Linux desktops honor HEADFUL=true. NODE_ENV does not determine display availability.

Validation:

1. Reproduce HEADFUL=true becoming false on macOS with piped stdin and no DISPLAY.
2. Test the OS/environment matrix and both server configurations.
3. Run the actual authenticator with a visible Chromium window and routed local login fixtures, with stdin piped. Do not use real credentials or saved user sessions.
4. Test the combined #81/#82 result and the integration with #49 before merge.

## Scope and release

Keep the production changes small. Do not consolidate all configuration modules or redesign authentication. #81 changes all four packages and needs four package releases; #82 needs the Notes release. Publish auth first when #49 is included. Release-please owns version bumps.

References: [Node os.homedir](https://nodejs.org/api/os.html#oshomedir), [Playwright authentication state](https://playwright.dev/docs/auth), issues #28 and #58.

## Evidence collected on macOS, Node 22.18.0

- Main reproduced the wrong working-directory state path in auth, API Hub, Roadmap, and both Notes transports when HOME was unset. Both Notes transports returned headful=false with HEADFUL=true, no DISPLAY, and piped stdin.
- With #81 production changes reverted, 10 of 13 focused behavioral regressions fail: state preservation, browser retry, all three version endpoints, and home-directory resolution. Normal successful persistence and explicit overrides still pass.
- The original session test used `/never/written`; its no-write assertion could pass because directory creation failed before its storage mock ran. Replaced it with a writable temporary file and byte-for-byte preservation assertions.
- With #81 applied: build/typecheck, 3 auth tests, 40 Notes/shared-config tests, all three published-bin smoke tests, and MCPB manifest validation pass. Real Chromium locally reproduces the sign-in redirect, preserves the shared file, and uses a fresh browser/state for successful retry.
- Real Windows behavior is covered by the added Windows CI job. Linux browser fixtures run under Xvfb. No real SAP credentials are needed for these tests; a live corporate MFA login remains environment-specific.

## Concurrent expiry follow-up

Review found that closing an expired browser before clearing its shared references can erase a replacement created by another request while close is pending. An older page can also report expiry after a replacement already exists.

Capture the browser used by the call, detach it only if it is still current, and close that captured browser. An expired call skips state persistence entirely, so it cannot save another request's unfinished context. This needs no lock or new browser manager.

Two deterministic regressions fail on the previous implementation and pass after this fix. All seven session tests and the offline Chromium expiry/retry test pass. The cases cover replacement during close, replacement before expiry is reported, close failure, successful persistence, and both transports' retry paths.

Claude's follow-up review identified one related case: closing an expired browser can interrupt a sibling with a generic "Target closed" error. Only save if that call still owns the current browser. The save helper also captures its context and checks it again after asynchronous imports, so replacing the context during those imports cannot save either old or unfinished replacement state. Both additional deterministic regressions fail before the fix and pass afterwards; all nine session tests and the real Chromium expiry test pass.

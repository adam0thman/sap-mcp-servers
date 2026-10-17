import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SapNotesApiClient } from '../dist/sap-notes-api.js';
import { SapNoteMcpServer } from '../dist/mcp-server.js';
import { HttpSapNoteMcpServer } from '../dist/http-mcp-server.js';

function clientWithBrowser(t, { closeFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sap-notes-session-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'sso-storage-state.json');
  const originalState = JSON.stringify({ cookies: [{ name: 'session', value: 'shared-login' }], origins: [] });
  writeFileSync(stateFile, originalState);
  const client = new SapNotesApiClient({ ssoStorageStateFile: stateFile });
  const calls = { storageState: 0, browserClosed: 0, browserCreated: 0, pageClosed: 0 };
  client.ensurePersistentBrowser = async function (token) {
    if (this.browser) return;
    calls.browserCreated++;
    const expired = token === 'expired';
    const body = expired
      ? '<html><title>Sign In</title><form id="logOnForm"></form></html>'
      : JSON.stringify({ id: '3096734', title: 'Test note', content: 'Actual note content' });
    this.browser = { close: async () => {
      calls.browserClosed++;
      if (closeFails) throw new Error('browser disconnected');
    } };
    this.browserContext = {
      newPage: async () => ({
        goto: async () => ({ ok: () => true, status: () => 200 }),
        waitForTimeout: async () => {},
        content: async () => body,
        title: async () => expired ? 'Sign In' : '',
        url: () => expired ? 'https://accounts.sap.com/saml2/idp/sso' : 'https://me.sap.com/backend/raw/sapnotes/Detail',
        locator: () => ({ textContent: async () => body }),
        close: async () => { calls.pageClosed++; }
      }),
      storageState: async ({ path }) => {
        calls.storageState++;
        writeFileSync(path, JSON.stringify({ cookies: expired ? [] : [{ name: 'session', value: token }], origins: [] }));
      }
    };
  };
  return { client, calls, stateFile, originalState };
}

for (const closeFails of [false, true]) {
  test(`session expiry preserves shared state and clears the browser (close fails: ${closeFails})`, async t => {
    const { client, calls, stateFile, originalState } = clientWithBrowser(t, { closeFails });
    await assert.rejects(client.getNoteWithPlaywright('3096734', 'expired'), /SESSION_EXPIRED/);
    assert.equal(readFileSync(stateFile, 'utf8'), originalState);
    assert.equal(calls.storageState, 0);
    assert.equal(calls.browserClosed, 1);
    assert.equal(calls.pageClosed, 1);
    assert.equal(client.browser, null);
    assert.equal(client.browserContext, null);
  });
}

test('successful note retrieval saves state and reuses the browser', async t => {
  const { client, calls, stateFile } = clientWithBrowser(t);
  for (let i = 0; i < 2; i++) {
    const note = await client.getNoteWithPlaywright('3096734', 'valid');
    assert.equal(note.content, 'Actual note content');
  }
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).cookies[0].value, 'valid');
  assert.equal(calls.storageState, 2);
  assert.equal(calls.browserCreated, 1);
  assert.equal(calls.browserClosed, 0);
  assert.equal(calls.pageClosed, 2);
});

test('a call interrupted by sibling expiry cannot save the replacement context', async t => {
  const { client, calls, stateFile, originalState } = clientWithBrowser(t);
  await client.ensurePersistentBrowser('valid');
  const originalBrowser = client.browser;
  const newPage = client.browserContext.newPage;
  let replacementSaves = 0;
  const replacement = { close: async () => {} };
  const replacementContext = { storageState: async ({ path }) => {
    replacementSaves++;
    writeFileSync(path, 'unfinished replacement state');
  } };
  client.browserContext.newPage = async () => {
    const page = await newPage();
    page.goto = async () => {
      // A sibling closes our shared browser after expiry; a retry then replaces it.
      await originalBrowser.close();
      client.browser = replacement;
      client.browserContext = replacementContext;
      throw new Error('Target page, context or browser has been closed');
    };
    return page;
  };
  await assert.rejects(client.getNoteWithPlaywright('3096734', 'valid'), /Target page, context or browser has been closed/);
  assert.equal(replacementSaves, 0);
  assert.equal(readFileSync(stateFile, 'utf8'), originalState);
  assert.equal(client.browser, replacement);
  assert.equal(client.browserContext, replacementContext);
  assert.equal(calls.pageClosed, 1);
  await client.cleanup();
});

test('state persistence stops if the context changes while imports are pending', async t => {
  const { client, calls, stateFile, originalState } = clientWithBrowser(t);
  await client.ensurePersistentBrowser('valid');
  let replacementSaves = 0;
  const saving = client.savePersistentStorageState();
  // The helper has started but its dynamic imports have not resumed yet.
  client.browserContext = { storageState: async ({ path }) => {
    replacementSaves++;
    writeFileSync(path, 'unfinished replacement state');
  } };
  await saving;
  assert.equal(replacementSaves, 0);
  assert.equal(calls.storageState, 0, 'the old context must not overwrite newer shared state either');
  assert.equal(readFileSync(stateFile, 'utf8'), originalState);
  await client.cleanup();
});

for (const Server of [SapNoteMcpServer, HttpSapNoteMcpServer]) {
  test(`${Server.name} retries an expired note with a fresh browser and token`, async t => {
    const { client, calls } = clientWithBrowser(t);
    client.getNoteViaBackend = async () => null;
    let invalidations = 0;
    const server = { authenticator: {
      ensureSession: async () => ({ cookieHeader: invalidations ? 'fresh' : 'expired' }),
      invalidateAuth: () => { invalidations++; }
    } };
    const note = await Server.prototype.withAuthRetry.call(server, token => client.getNote('3096734', token));
    assert.equal(note.content, 'Actual note content');
    assert.equal(invalidations, 1);
    assert.equal(calls.browserCreated, 2);
    assert.equal(calls.browserClosed, 1);
    assert.equal(calls.storageState, 1);
  });
}

for (const replacementTiming of ['during-close', 'before-expiry']) {
  test(`an expired call preserves another call's replacement browser (${replacementTiming})`, async t => {
    const { client, calls, stateFile, originalState } = clientWithBrowser(t);
    let replacementCloses = 0;
    let replacementSaves = 0;
    const replacement = { close: async () => { replacementCloses++; } };
    const replacementContext = { storageState: async () => { replacementSaves++; } };
    const replace = () => { client.browser = replacement; client.browserContext = replacementContext; };
    const ensure = client.ensurePersistentBrowser.bind(client);
    client.ensurePersistentBrowser = async token => {
      await ensure(token);
      const close = client.browser.close;
      client.browser.close = async () => {
        await close();
        // While close waits, a concurrent request can open a new context.
        if (replacementTiming === 'during-close') replace();
      };
      if (replacementTiming === 'before-expiry') {
        const newPage = client.browserContext.newPage;
        client.browserContext.newPage = async () => {
          const page = await newPage();
          const content = page.content;
          page.content = async () => { replace(); return content(); };
          return page;
        };
      }
    };
    await assert.rejects(client.getNoteWithPlaywright('3096734', 'expired'), /SESSION_EXPIRED/);
    assert.equal(client.browser, replacement);
    assert.equal(client.browserContext, replacementContext);
    assert.equal(calls.browserClosed, 1, 'close the browser used by the expired request');
    assert.equal(replacementCloses, 0, 'leave the concurrent request running');
    assert.equal(replacementSaves, 0, 'the expired request must not persist another request before it finishes');
    assert.equal(readFileSync(stateFile, 'utf8'), originalState);
    await client.cleanup();
    assert.equal(replacementCloses, 1, 'the replacement must remain reachable for shutdown');
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SapNotesApiClient } from '../dist/sap-notes-api.js';

// All requests are fulfilled locally. This uses Chromium's real cookie/storage
// handling, but never connects to SAP or reads the developer's saved sessions.
test('a sign-in redirect preserves the shared file and the next browser reads fresh state', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sap-notes-browser-'));
  const stateFile = join(dir, 'state.json');
  const cookie = { name: 'test-session', value: 'shared-valid', domain: 'me.sap.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' };
  const initialState = JSON.stringify({ cookies: [cookie], origins: [] });
  writeFileSync(stateFile, initialState);
  const client = new SapNotesApiClient({ ssoStorageStateFile: stateFile, tokenCacheFile: join(dir, 'cache.json'), headful: false });
  t.after(async () => { await client.cleanup(); rmSync(dir, { recursive: true, force: true }); });
  const ensureBrowser = client.ensurePersistentBrowser.bind(client);
  let expired = true;
  const browsers = [];
  client.ensurePersistentBrowser = async token => {
    await ensureBrowser(token);
    browsers.push(client.browser);
    await client.browserContext.setOffline(true);
    await client.browserContext.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'accounts.sap.com') {
        return route.fulfill({ contentType: 'text/html', body: '<title>Sign In</title><form id="logOnForm"></form>' });
      }
      if (expired) {
        return route.fulfill({ contentType: 'text/html',
          headers: { 'set-cookie': 'test-session=; Path=/; Secure; Max-Age=0' },
          body: '<script>location.replace("https://accounts.sap.com/login")</script>'
        });
      }
      assert.match(route.request().headers().cookie, /test-session=fresh-login/);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '3096734', title: 'Test', content: 'Actual note text' }) });
    });
  };

  await assert.rejects(client.getNoteWithPlaywright('3096734', 'test-session=old'), /SESSION_EXPIRED/);
  assert.equal(readFileSync(stateFile, 'utf8'), initialState);
  assert.equal(browsers[0].isConnected(), false);
  assert.equal(client.browserContext, null);

  // The authenticator writes fresh state before the server retries the note.
  writeFileSync(stateFile, JSON.stringify({ cookies: [{ ...cookie, value: 'fresh-login' }], origins: [] }));
  expired = false;
  const note = await client.getNoteWithPlaywright('3096734', 'test-session=fresh-login');
  assert.equal(note.content, 'Actual note text');
  assert.notEqual(browsers[1], browsers[0]);
  assert.equal(browsers[1].isConnected(), true);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).cookies[0].value, 'fresh-login');
});

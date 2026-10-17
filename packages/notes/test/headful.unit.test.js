import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHeadful } from '../dist/headful.js';
import { SapNoteMcpServer } from '../dist/mcp-server.js';
import { HttpSapNoteMcpServer } from '../dist/http-mcp-server.js';

test('HEADFUL=true is honoured on a desktop, whatever the transport (#58)', () => {
  assert.equal(resolveHeadful({ HEADFUL: 'true' }, 'win32').headful, true, 'Windows has no DISPLAY');
  assert.equal(resolveHeadful({ HEADFUL: 'true' }, 'darwin').headful, true);
  assert.equal(resolveHeadful({ HEADFUL: 'true', DISPLAY: ':0' }, 'linux').headful, true);
  assert.equal(resolveHeadful({ HEADFUL: 'true', WAYLAND_DISPLAY: 'wayland-0' }, 'linux').headful, true);
  assert.equal(resolveHeadful({ HEADFUL: 'true', NODE_ENV: 'production' }, 'win32').headful, true);
});

test('a container, CI, or a Linux host without a display stays headless, and says why', () => {
  for (const [env, platform] of [
    [{ HEADFUL: 'true', DOCKER_ENV: 'true' }, 'win32'],
    [{ HEADFUL: 'true', CI: 'true', DISPLAY: ':0' }, 'linux'],
    [{ HEADFUL: 'true' }, 'linux']
  ]) {
    const result = resolveHeadful(env, platform);
    assert.equal(result.headful, false, JSON.stringify(env));
    assert.ok(result.overridden, `no reason given for ${JSON.stringify(env)}`);
  }
});

test('without HEADFUL=true the browser is headless, and nothing is overridden', () => {
  for (const env of [{}, { HEADFUL: 'false' }, { HEADFUL: '1' }]) {
    assert.deepEqual(resolveHeadful(env, 'win32'), { headful: false });
  }
});

test('both notes servers take HEADFUL=true over stdio, where stdin is no TTY', () => {
  const saved = { ...process.env };
  try {
    for (const name of ['DOCKER_ENV', 'CI', 'NODE_ENV']) delete process.env[name];
    Object.assign(process.env, { HEADFUL: 'true', DISPLAY: ':0' });
    assert.notEqual(process.stdin.isTTY, true, 'the test must run with stdin as a pipe, as under an MCP client');
    for (const Server of [SapNoteMcpServer, HttpSapNoteMcpServer]) {
      assert.equal(Server.prototype.loadConfig.call({}).headful, true, Server.name);
    }
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

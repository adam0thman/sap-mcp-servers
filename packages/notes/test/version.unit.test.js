import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SERVER_VERSION } from '../dist/version.js';
import { SapNoteMcpServer } from '../dist/mcp-server.js';
import { HttpSapNoteMcpServer } from '../dist/http-mcp-server.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the version comes from the installed package manifest', () => {
  assert.equal(SERVER_VERSION, manifest.version);
});

for (const Server of [SapNoteMcpServer, HttpSapNoteMcpServer]) {
  test(`${Server.name} announces the package version to an MCP client`, async () => {
    const server = new Server();
    const mcp = server.mcpServer ?? server.createMcpServer();
    const client = new Client({ name: 'version-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await mcp.connect(serverTransport);
      await client.connect(clientTransport);
      assert.deepEqual(client.getServerVersion(), { name: manifest.name, version: manifest.version });
    } finally {
      await client.close();
      await mcp.close();
    }
  });
}

test('HTTP health reports the package version', async () => {
  const server = new HttpSapNoteMcpServer();
  const listener = server.app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, manifest.version);
  } finally {
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});

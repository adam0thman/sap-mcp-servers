import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SapNoteMcpServer } from '../dist/mcp-server.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sap-attachment-tool-'));
  const server = new SapNoteMcpServer();
  const body = Buffer.from('synthetic attachment');
  server.withAuthRetry = fn => fn('synthetic');
  server.sapNotesClient.fetchAttachment = async () => ({ body, contentType: 'application/pdf', bytes: body.length, suggestedFilename: 'note.pdf' });
  const client = new Client({ name: 'attachment-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.mcpServer.connect(b)]);
  t.after(async () => { await client.close(); await server.mcpServer.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, body, client, server, call: args => client.callTool({ name: 'fetch_attachment', arguments: { url: 'https://documents.support.sap.com/attachment.htm', ...args } }) };
}

test('the actual MCP tool saves the attachment and reports its hash', async t => {
  const { dir, body, call, client } = await fixture(t);
  const result = await call({ outputDir: dir });
  assert.ok(!result.isError);
  assert.deepEqual(await readFile(result.structuredContent.path), body);
  assert.equal(result.structuredContent.filename, 'note.pdf');
  assert.equal(result.structuredContent.sha256, createHash('sha256').update(body).digest('hex'));
  const tool = (await client.listTools()).tools.find(tool => tool.name === 'fetch_attachment');
  assert.equal(tool.inputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(tool.outputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
});

test('an existing file is never overwritten', async t => {
  const { dir, call } = await fixture(t);
  const target = join(dir, 'note.pdf');
  await writeFile(target, 'keep this');
  const result = await call({ outputDir: dir });
  assert.equal(result.isError, true);
  assert.equal(await readFile(target, 'utf8'), 'keep this');
});

test('a symlink cannot redirect the write outside the selected directory', async t => {
  const { dir, call } = await fixture(t);
  const outside = join(dir, 'outside.txt');
  await writeFile(outside, 'keep this');
  const output = await mkdtemp(join(dir, 'output-'));
  try { await symlink(outside, join(output, 'note.pdf')); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlink creation unavailable'); throw error; }
  const result = await call({ outputDir: output });
  assert.equal(result.isError, true);
  assert.equal(await readFile(outside, 'utf8'), 'keep this');
});

test('concurrent downloads with the same output name cannot overwrite one another', async t => {
  const { dir, call, body } = await fixture(t);
  const results = await Promise.all([call({ outputDir: dir }), call({ outputDir: dir })]);
  assert.equal(results.filter(result => !result.isError).length, 1);
  assert.deepEqual(await readFile(join(dir, 'note.pdf')), body);
});

test('the default output lives in its own temporary directory', async t => {
  const { call } = await fixture(t);
  const filename = `sap-audit-${randomUUID()}.pdf`;
  const result = await call({ filename });
  assert.ok(!result.isError);
  const path = result.structuredContent.path;
  t.after(() => rm(dirname(path) === tmpdir() ? path : dirname(path), { recursive: true, force: true }));
  assert.notEqual(dirname(path), tmpdir());
  assert.equal(basename(path), filename);
});

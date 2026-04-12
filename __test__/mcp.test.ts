import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../src/extract/extractor.js';
import { PassThrough } from 'node:stream';
import type { ApiSnapshot } from '../src/extract/api-snapshot.js';
import { createMcpServer } from '../src/mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, 'fixtures');

async function createConnectedClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function sendStdioMessage(stdin: PassThrough, message: unknown): void {
  stdin.write(`${JSON.stringify(message)}\n`);
}

async function receiveStdioMessage(stdout: PassThrough, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      cleanup();
      resolve(JSON.parse(line));
    };

    const onTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for stdio MCP response'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(onTimeout);
      stdout.off('data', onData);
    };

    stdout.on('data', onData);
  });
}

describe('MCP server', () => {
  describe('listTools', () => {
    it('returns all three tools', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('semver_compare');
      expect(names).toContain('semver_snapshot');
      expect(names).toContain('semver_diff');
      expect(result.tools).toHaveLength(3);
    });

    it('semver_compare requires "old" argument', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const compareTool = result.tools.find((t) => t.name === 'semver_compare')!;
      expect(compareTool.inputSchema.required).toContain('old');
    });

    it('semver_diff requires oldSnapshot and newSnapshot', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const diffTool = result.tools.find((t) => t.name === 'semver_diff')!;
      expect(diffTool.inputSchema.required).toContain('oldSnapshot');
      expect(diffTool.inputSchema.required).toContain('newSnapshot');
    });
  });

  describe('semver_compare', () => {
    it('detects MAJOR breaking change (export-removed)', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'export-removed', 'old');
      const newPath = path.join(FIXTURES, 'export-removed', 'new');

      const result = await client.callTool({ name: 'semver_compare', arguments: { old: oldPath, new: newPath, oldAs: 'path', newAs: 'path' } });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const report = JSON.parse(text);
      expect(report.recommended).toBe('major');
      expect(report.summary.major).toBeGreaterThan(0);
    });

    it('detects MINOR change (export-added)', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'export-added', 'old');
      const newPath = path.join(FIXTURES, 'export-added', 'new');

      const result = await client.callTool({ name: 'semver_compare', arguments: { old: oldPath, new: newPath, oldAs: 'path', newAs: 'path' } });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const report = JSON.parse(text);
      expect(report.recommended).toBe('minor');
    });

    it('returns error for invalid path', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({ name: 'semver_compare', arguments: { old: '/nonexistent/path', oldAs: 'path' } });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/Error:/);
    });

    it('rejects invalid argument types', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: 123, installDeps: 'true' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/argument must be a string/);
    });

    it('rejects invalid source kind values', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: 'HEAD', oldAs: 'ref' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('"oldAs" argument must be either "path" or "git"');
    });
  });

  describe('semver_snapshot', () => {
    it('returns a valid API snapshot', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');

      const result = await client.callTool({ name: 'semver_snapshot', arguments: { path: fixturePath } });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const snapshot = JSON.parse(text) as ApiSnapshot;
      expect(snapshot).toHaveProperty('symbols');
      expect(typeof snapshot.symbols).toBe('object');
      expect(Object.keys(snapshot.symbols).length).toBeGreaterThan(0);
    });

    it('defaults to current directory when path is omitted', async () => {
      // Just verify no crash — CWD may not have tsconfig but error is returned gracefully
      const { client } = await createConnectedClient();
      const result = await client.callTool({ name: 'semver_snapshot', arguments: {} });
      // Either succeeds or returns a graceful error, never throws
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(typeof text).toBe('string');
    });

    it('rejects invalid boolean arguments', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: '.', asGitRef: 'false' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('"asGitRef" argument must be a boolean');
    });
  });

  describe('semver_diff', () => {
    it('diffs two snapshots and returns a report', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'export-removed', 'old');
      const newPath = path.join(FIXTURES, 'export-removed', 'new');

      // First extract both snapshots
      const [oldSnap, newSnap] = await Promise.all([
        extract({ projectPath: oldPath }),
        extract({ projectPath: newPath }),
      ]);

      const result = await client.callTool({ name: 'semver_diff', arguments: { oldSnapshot: oldSnap, newSnapshot: newSnap } });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const report = JSON.parse(text);
      expect(report.recommended).toBe('major');
      expect(report.changes).toBeInstanceOf(Array);
      expect(report.changes.length).toBeGreaterThan(0);
    });

    it('reports patch when snapshots are identical', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');
      const snap = await extract({ projectPath: fixturePath });

      const result = await client.callTool({ name: 'semver_diff', arguments: { oldSnapshot: snap, newSnapshot: snap } });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const report = JSON.parse(text);
      expect(report.recommended).toBe('patch');
      expect(report.changes).toHaveLength(0);
    });
  });

  describe('unknown tool', () => {
    it('returns isError for unknown tool name', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
      expect(result.isError).toBe(true);
    });
  });

  describe('stdio transport', () => {
    it('serves MCP requests over stdio transport', async () => {
      const server = createMcpServer();
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const transport = new StdioServerTransport(stdin, stdout);

      await server.connect(transport);

      try {
        sendStdioMessage(stdin, {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'stdio-test-client', version: '1.0.0' },
          },
        });

        const initializeResponse = await receiveStdioMessage(stdout);
        expect(initializeResponse.result.serverInfo).toMatchObject({
          name: 'semver-checks',
        });

        sendStdioMessage(stdin, {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        });

        sendStdioMessage(stdin, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        });

        const listResponse = await receiveStdioMessage(stdout);
        const toolNames = listResponse.result.tools.map((tool: { name: string }) => tool.name);
        expect(toolNames).toContain('semver_compare');
        expect(toolNames).toContain('semver_snapshot');
        expect(toolNames).toContain('semver_diff');

        const oldPath = path.join(FIXTURES, 'export-added', 'old');
        const newPath = path.join(FIXTURES, 'export-added', 'new');

        sendStdioMessage(stdin, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'semver_compare',
            arguments: { old: oldPath, new: newPath, oldAs: 'path', newAs: 'path' },
          },
        });

        const compareResponse = await receiveStdioMessage(stdout, 20_000);
        const report = JSON.parse(compareResponse.result.content[0].text);
        expect(report.recommended).toBe('minor');
      } finally {
        await server.close();
      }
    });
  });
});

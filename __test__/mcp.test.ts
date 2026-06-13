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
      expect(snapshot).toHaveProperty('entrypoints');
      expect(typeof snapshot.entrypoints).toBe('object');
      expect(Object.keys(snapshot.entrypoints['.']).length).toBeGreaterThan(0);
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

    // Deep validation: a nested null/array entrypoint must fail with a clear
    // error instead of slipping into the classifier and surfacing as
    // `entrypoint-removed` (or crashing inside `Object.keys(null)`).
    it('rejects a null entrypoint value with a deep-validation error', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');
      const snap = await extract({ projectPath: fixturePath });

      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: snap, newSnapshot: { entrypoints: { '.': null } } },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('newSnapshot.entrypoints');
      expect(text).toContain('non-null object');
    });

    it('rejects an array entrypoint value with a deep-validation error', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');
      const snap = await extract({ projectPath: fixturePath });

      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: { entrypoints: { '.': [] } }, newSnapshot: snap },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('oldSnapshot.entrypoints');
    });

    // A malformed symbol value (`{ x: [] }`) used to slip past the entry-level
    // guard and surface as a noisy "patch" report because the classifier
    // walked the array as a symbol map. Validation now reaches per-symbol.
    it('rejects a malformed symbol value with a deep-validation error', async () => {
      const { client } = await createConnectedClient();
      const malformed = { entrypoints: { '.': { x: [] } } };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('oldSnapshot.entrypoints');
      expect(text).toContain('non-null object');
    });

    // Leaf validation: a symbol that passes the `kind` check but carries a
    // non-string `SerializedType.text` (here `5`) used to slip through and feed
    // a numeric "type" into the classifier's text comparisons, surfacing as a
    // silent patch instead of a validation error.
    it('rejects a symbol with a non-string serialized type as a leaf error', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: { '.': { v: { kind: 'variable', name: 'v', type: { text: 5 } } } },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('serialized type');
    });

    it('rejects a function symbol missing its signatures array', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: { '.': { f: { kind: 'function', name: 'f' } } },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('signatures');
    });

    it('rejects a class with a malformed constructor signature leaf', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: {
          '.': {
            C: {
              kind: 'class',
              name: 'C',
              properties: [],
              methods: [],
              typeParameters: [],
              constructorSignatures: [
                { parameters: [{ name: 'x', type: { text: 5 } }], returnType: { text: 'void' }, typeParameters: [] },
              ],
            },
          },
        },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('constructorSignatures');
    });

    it('rejects a non-string type-parameter constraint leaf', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: {
          '.': {
            T: {
              kind: 'type-alias',
              name: 'T',
              type: { text: 'unknown' },
              typeParameters: [{ name: 'T', constraint: { text: 5 }, hasDefault: false }],
            },
          },
        },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('constraint');
    });

    it('rejects an enum member with a non-string name', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: { '.': { E: { kind: 'enum', name: 'E', members: [{ name: 5, value: 1 }] } } },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('members[0].name');
    });

    it('rejects a function parameter with a non-string name', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: {
          '.': {
            f: {
              kind: 'function',
              name: 'f',
              signatures: [
                { parameters: [{ name: 5, type: { text: 'string' } }], returnType: { text: 'void' }, typeParameters: [] },
              ],
            },
          },
        },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('parameters[0].name');
    });

    it('rejects an interface index signature with a non-serialized value type', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: {
          '.': {
            D: {
              kind: 'interface',
              name: 'D',
              properties: [],
              methods: [],
              typeParameters: [],
              indexSignatures: [{ keyType: 'string', valueType: { text: 5 }, isReadonly: false }],
            },
          },
        },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('indexSignatures');
    });

    // A genuine extract() snapshot now carries call/index signatures and
    // type-parameter defaults; the stricter validation must not false-reject it.
    it('accepts a real extracted snapshot carrying the new interface/typeparam fields', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'interface-index-signature-changed', 'old');
      const newPath = path.join(FIXTURES, 'interface-index-signature-changed', 'new');
      const [oldSnap, newSnap] = await Promise.all([
        extract({ projectPath: oldPath }),
        extract({ projectPath: newPath }),
      ]);
      const result = await client.callTool({ name: 'semver_diff', arguments: { oldSnapshot: oldSnap, newSnapshot: newSnap } });
      expect(result.isError).toBeFalsy();
      const report = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(report.recommended).toBe('major');
    });

    it('rejects a symbol with a non-string name', async () => {
      const { client } = await createConnectedClient();
      const malformed = {
        entrypoints: { '.': { v: { kind: 'variable', name: 5, type: { text: 'string' } } } },
      };
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: malformed, newSnapshot: malformed },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('.name must be a string');
    });

    // Reserved prototype keys (`__proto__`, `constructor`, `prototype`) must
    // be refused at every level — they let a hostile JSON pollute the maps
    // the classifier iterates over and trigger runtime crashes downstream.
    it('rejects reserved prototype-pollution keys at the entrypoint level', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');
      const snap = await extract({ projectPath: fixturePath });
      const hostile = JSON.parse('{"entrypoints":{"__proto__":{"x":{"kind":"function","name":"x","signatures":[]}}}}');
      const result = await client.callTool({
        name: 'semver_diff',
        arguments: { oldSnapshot: hostile, newSnapshot: snap },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('reserved key');
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

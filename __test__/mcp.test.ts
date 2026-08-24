import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    it('returns both tools', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('semver_compare');
      expect(names).toContain('semver_snapshot');
      expect(result.tools).toHaveLength(2);
    });

    it('semver_compare requires "old" argument', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const compareTool = result.tools.find((t) => t.name === 'semver_compare')!;
      expect(compareTool.inputSchema.required).toContain('old');
    });

    // The CLI has taken `--declared` and `--old-as npm` since 0.9.0. An agent
    // reading this schema is the only way it learns either exists, so the
    // schema is what gets pinned, not just the handler behind it.
    it('semver_compare exposes the declared gate and a change cap', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const props = (result.tools.find((t) => t.name === 'semver_compare')!.inputSchema as any).properties;
      expect(props.declared.enum).toEqual(['major', 'minor', 'patch', 'none', 'auto']);
      expect(props.maxChanges).toBeDefined();
    });

    // Both tools take the same three source forms on the CLI, so the schema an
    // agent reads has to say so in the same words.
    it('both tools declare entry in the two shapes the CLI takes', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      for (const name of ['semver_compare', 'semver_snapshot']) {
        const props = (result.tools.find((t) => t.name === name)!.inputSchema as any).properties;
        expect(props.entry.anyOf).toEqual([
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ]);
      }
    });

    // The handler takes whole counts only, so declaring `number` would invite a
    // client to send 1.5 and get an error the schema said was fine.
    it('declares the size knobs as the whole counts the handler takes', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const tools = Object.fromEntries(result.tools.map((t) => [t.name, t.inputSchema as any]));
      expect(tools['semver_compare'].properties.maxChanges).toMatchObject({ type: 'integer', minimum: 0 });
      expect(tools['semver_snapshot'].properties.maxBytes).toMatchObject({ type: 'integer', minimum: 0 });
    });

    it('semver_snapshot takes the same three source forms', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const props = (result.tools.find((t) => t.name === 'semver_snapshot')!.inputSchema as any).properties;
      expect(props.pathAs.enum).toEqual(['path', 'git', 'npm']);
      expect(props.asGitRef).toBeUndefined();
      expect(props.detail.type).toBe('boolean');
      expect(props.maxBytes).toBeDefined();
    });

    it('semver_compare offers npm as a source kind', async () => {
      const { client } = await createConnectedClient();
      const result = await client.listTools();
      const props = (result.tools.find((t) => t.name === 'semver_compare')!.inputSchema as any).properties;
      expect(props.oldAs.enum).toContain('npm');
      expect(props.newAs.enum).toContain('npm');
      expect(props.old.description).toMatch(/npm/);
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
      expect(text).toContain('"oldAs" argument must be one of: path, git, npm');
    });

    // Only the second entry file changes, so a comma that is not split reads as
    // a missing file and, before that error existed, as a missed break.
    it('takes several entry points as a comma string or an array', async () => {
      const { client } = await createConnectedClient();
      const dir = path.join(FIXTURES, 'mcp-multi-entry');
      const call = (entry: unknown) =>
        client.callTool({
          name: 'semver_compare',
          arguments: { old: path.join(dir, 'old'), new: path.join(dir, 'new'), oldAs: 'path', newAs: 'path', entry },
        });

      const one = JSON.parse((await call('main.ts')).content[0].text);
      expect(one.changes).toHaveLength(0);

      const commas = JSON.parse((await call('main.ts,extra.ts')).content[0].text);
      expect(commas.changes.map((c: any) => c.kind)).toEqual(['param-removed']);

      const array = JSON.parse((await call(['main.ts', 'extra.ts'])).content[0].text);
      expect(array.changes).toEqual(commas.changes);
    });

    it('rejects an entry list that is not all strings', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: path.join(FIXTURES, 'export-removed', 'old'), oldAs: 'path', entry: ['a.ts', 7] },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain(
        '"entry" argument must be a string or an array of strings',
      );
    });

    it('grades the bump a release declares', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'export-removed', 'old');
      const newPath = path.join(FIXTURES, 'export-removed', 'new');
      const call = (declared: string) =>
        client.callTool({
          name: 'semver_compare',
          arguments: { old: oldPath, new: newPath, oldAs: 'path', newAs: 'path', declared },
        });

      const short = JSON.parse((await call('patch')).content[0].text);
      expect(short.declaration).toMatchObject({ declared: 'patch', required: 'major', verdict: 'mismatch' });

      const covered = JSON.parse((await call('major')).content[0].text);
      expect(covered.declaration.verdict).toBe('ok');
    });

    it('omits the declaration when none was asked for', async () => {
      const { client } = await createConnectedClient();
      const oldPath = path.join(FIXTURES, 'export-removed', 'old');
      const newPath = path.join(FIXTURES, 'export-removed', 'new');

      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: oldPath, new: newPath, oldAs: 'path', newAs: 'path' },
      });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0].text).declaration).toBeUndefined();
    });

    it('rejects a declared bump outside the enum', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: path.join(FIXTURES, 'export-removed', 'old'), oldAs: 'path', declared: 'nope' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain('declared must be one of');
      // The CLI flag name has no meaning to a caller that passed `declared`.
      expect(text).not.toContain('--declared');
    });

    // A gate that was asked for and found nothing to read must not answer with
    // a pass. The fixtures carry no package.json and no changeset, which is
    // exactly that case.
    it('errors when auto finds no declaration to read', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: {
          old: path.join(FIXTURES, 'export-removed', 'old'),
          new: path.join(FIXTURES, 'export-removed', 'new'),
          oldAs: 'path',
          newAs: 'path',
          declared: 'auto',
        },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toMatch(/Cannot read a declared bump/);
    });

    // Reaching the npm resolver at all is the assertion: before 0.12.0 this
    // input was turned away by the source-kind check without ever getting there.
    it('accepts npm as a forced source kind', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: 'lodash', oldAs: 'npm' },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toMatch(/Invalid npm spec/);
    });

    it('puts proven breaks ahead of additions and review-only findings', async () => {
      const { client } = await createConnectedClient();
      const dir = path.join(FIXTURES, 'function-type-generic-changed');

      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: path.join(dir, 'old'), new: path.join(dir, 'new'), oldAs: 'path', newAs: 'path' },
      });
      const report = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      // The differ emits these in source order as minor, proven, review.
      expect(report.changes.map((c: any) => c.kind)).toEqual([
        'return-type-changed',
        'param-type-widened',
        'generic-param-removed',
      ]);
      expect(report.omitted).toBeUndefined();
    });

    it('caps the change list and says what was left out', async () => {
      const { client } = await createConnectedClient();
      const dir = path.join(FIXTURES, 'function-type-generic-changed');

      const result = await client.callTool({
        name: 'semver_compare',
        arguments: {
          old: path.join(dir, 'old'),
          new: path.join(dir, 'new'),
          oldAs: 'path',
          newAs: 'path',
          maxChanges: 1,
        },
      });
      const report = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(report.changes).toHaveLength(1);
      expect(report.changes[0].kind).toBe('return-type-changed');
      expect(report.omitted).toMatchObject({ count: 2, total: 3 });
      expect(report.omitted.note).toContain('maxChanges: 3');
      // The counts are the one thing a cap must not distort.
      expect(report.summary).toMatchObject({ major: 2, minor: 1, majorProven: 1, majorReview: 1 });
    });

    // The cap has to hold without being asked for: an agent that knows nothing
    // about maxChanges is exactly the caller a 137KB response breaks.
    it('bounds the response with no maxChanges given', async () => {
      const { client } = await createConnectedClient();
      const dir = path.join(FIXTURES, 'mcp-over-default-cap');

      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: path.join(dir, 'old'), new: path.join(dir, 'new'), oldAs: 'path', newAs: 'path' },
      });
      const report = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(report.changes).toHaveLength(50);
      expect(report.omitted).toMatchObject({ count: 9, total: 59 });
      expect(report.summary.majorProven).toBe(59);
    });

    it('rejects a maxChanges that is not a whole count', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_compare',
        arguments: { old: path.join(FIXTURES, 'export-removed', 'old'), oldAs: 'path', maxChanges: -1 },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain(
        '"maxChanges" argument must be a non-negative integer',
      );
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
        arguments: { path: '.', detail: 'false' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('"detail" argument must be a boolean');
    });

    // Silently ignoring it would resolve a git ref as a path and answer about
    // the wrong project, which is worse than the error.
    it('refuses the argument pathAs replaced', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: 'v1.2.3', asGitRef: true },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toContain(
        '"asGitRef" was replaced by "pathAs"',
      );
    });

    it('accepts npm as a forced source kind', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: 'lodash', pathAs: 'npm' },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toMatch(/Invalid npm spec/);
    });

    it('returns kinds by default and full shapes under detail', async () => {
      const { client } = await createConnectedClient();
      const fixturePath = path.join(FIXTURES, 'export-removed', 'old');
      const call = (args: Record<string, unknown>) =>
        client.callTool({ name: 'semver_snapshot', arguments: { path: fixturePath, pathAs: 'path', ...args } });

      const brief = JSON.parse((await call({})).content[0].text);
      expect(brief.entrypoints['.'].foo).toBe('function');

      const full = JSON.parse((await call({ detail: true })).content[0].text);
      expect(full.entrypoints['.'].foo).toMatchObject({ kind: 'function', name: 'foo' });
    });

    // The default has to bound on its own: an agent that knows nothing about
    // maxBytes is exactly the caller a 2.6MB response breaks. Each interface in
    // this fixture serializes to ~29KB under detail, so the second one is what
    // the 40000 default drops.
    it('bounds the response with no maxBytes given', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'mcp-over-byte-budget'), pathAs: 'path', detail: true },
      });
      const text = (result.content as Array<{ text: string }>)[0].text;
      const snapshot = JSON.parse(text);
      expect(Object.keys(snapshot.entrypoints['.'])).toHaveLength(1);
      expect(snapshot.omitted).toMatchObject({ count: 1, total: 2 });
      expect(text.length).toBeLessThan(40_000);
    });

    // 29KB for one interface under `detail`, against a budget of 0. Admitting it
    // would have made the number the caller passed meaningless.
    it('keeps a wide symbol out when the budget cannot hold it', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'mcp-over-byte-budget'), pathAs: 'path', detail: true, maxBytes: 0 },
      });
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(1000);
      expect(JSON.parse(text).omitted).toMatchObject({ count: 2, total: 2 });
    });

    // `compare` and the CLI both refuse this. A successful `{}` reads as a
    // package with no public API when it means the extraction found nothing.
    it('refuses an empty surface instead of reporting it as one', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'mcp-empty-surface'), pathAs: 'path' },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{ text: string }>)[0].text).toMatch(/no API symbols could be extracted/);
    });

    it('refuses an entry that was given but names nothing', async () => {
      const { client } = await createConnectedClient();
      for (const entry of ['', [], ',']) {
        const result = await client.callTool({
          name: 'semver_snapshot',
          arguments: { path: path.join(FIXTURES, 'mcp-entry-autodetect'), pathAs: 'path', entry },
        });
        expect(result.isError).toBe(true);
        expect((result.content as Array<{ text: string }>)[0].text).toContain('entry must name at least one file');
      }
    });

    it('takes several entry points too', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: {
          path: path.join(FIXTURES, 'mcp-multi-entry', 'old'),
          pathAs: 'path',
          entry: ['main.ts', 'extra.ts'],
        },
      });
      expect(result.isError).toBeFalsy();
      const snapshot = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      const names = Object.values(snapshot.entrypoints).flatMap((e) => Object.keys(e as object));
      expect(names).toContain('fromMain');
      expect(names).toContain('fromExtra');
    });

    // The budget is named in bytes, and a Hangul identifier costs three of them
    // per character where String.length reports one. Counting code units spent
    // 1,156 bytes on a 400 byte budget.
    it('spends the budget in bytes, not in code units', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'mcp-non-ascii-symbols'), pathAs: 'path', maxBytes: 400 },
      });
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(700);
      expect(JSON.parse(text).omitted.count).toBeGreaterThan(0);
    });

    // With no `entry`, the entry has to be found from package.json. A default
    // filename baked in here would answer about a file the package never named.
    it('lets the extractor find the entry when none is given', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'mcp-entry-autodetect'), pathAs: 'path' },
      });
      expect(result.isError).toBeFalsy();
      const snapshot = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(snapshot.entrypoints['.']).toHaveProperty('fromDetectedEntry');
    });

    it('stops at the byte budget and says what was left out', async () => {
      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: 'semver_snapshot',
        arguments: { path: path.join(FIXTURES, 'export-removed', 'old'), pathAs: 'path', maxBytes: 1 },
      });
      const snapshot = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      // Nothing is exempt from the budget, the first symbol included: a bound
      // one symbol can blow by an arbitrary amount is not a bound, and the
      // total in `omitted` still describes the surface.
      expect(snapshot.entrypoints['.']).toBeUndefined();
      expect(snapshot.omitted).toMatchObject({ count: 2, total: 2 });
      expect(snapshot.omitted.note).toContain('too small for even one');
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

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { npmCommand } from '../src/resolve/npm-command.js';

const platform = process.platform;
const execpath = process.env['npm_execpath'];
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  if (execpath === undefined) delete process.env['npm_execpath'];
  else process.env['npm_execpath'] = execpath;
});

describe('npmCommand', () => {
  it('runs npm as it is outside Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(npmCommand(['pack', 'a@1'])).toEqual(['npm', ['pack', 'a@1']]);
  });

  // A spec such as "a@>=1 <2" goes through as one argument, never through a shell.
  it('runs npm-cli.js with this Node on Windows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-command-'));
    const cli = path.join(dir, 'npm-cli.js');
    fs.writeFileSync(cli, '');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env['npm_execpath'] = cli;
      expect(npmCommand(['pack', 'a@>=1 <2'])).toEqual([process.execPath, [cli, 'pack', 'a@>=1 <2']]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores an npm_execpath that is not npm-cli.js', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env['npm_execpath'] = path.join(os.tmpdir(), 'pnpm.cjs');
    const [cmd, args] = npmCommand(['pack']);
    expect(args.at(-1)).toBe('pack');
    if (cmd === process.execPath) expect(path.basename(args[0])).toBe('npm-cli.js');
    else expect(cmd).toBe('npm');
  });
});

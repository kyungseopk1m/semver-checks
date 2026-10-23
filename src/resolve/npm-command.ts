import fs from 'fs';
import path from 'path';

// On Windows `npm` is npm.cmd, which execFile cannot start without a shell, and a
// shell would read the `|`, `<` and `>` a version range may contain as operators.
// So npm's own JS entry is run with this Node instead, which keeps every call
// shell-free. Elsewhere `npm` is an executable and is run as it is.
export function npmCommand(args: string[]): [string, string[]] {
  if (process.platform !== 'win32') return ['npm', args];
  const cli = [
    process.env['npm_execpath'],
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p): p is string => !!p && path.basename(p) === 'npm-cli.js' && fs.existsSync(p));
  // Not found: keep the plain name, so the failure is the usual ENOENT that
  // explainNpmError already turns into "npm was not found on your PATH".
  return cli ? [process.execPath, [cli, ...args]] : ['npm', args];
}

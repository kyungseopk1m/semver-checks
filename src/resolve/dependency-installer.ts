import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { npmCommand } from './npm-command.js';

function warn(message: string): void {
  if (process.env['SEMVER_CHECKS_VERBOSE']) {
    process.stderr.write(`[semver-checks] warning: ${message}\n`);
  }
}

// A stalled registry would otherwise hang the run, and a CI job with it.
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export async function ensureProjectDeps(projectPath: string): Promise<void> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    warn(`skipping dependency install for '${projectPath}' because package.json was not found`);
    return;
  }

  const nodeModules = path.join(projectPath, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    execFileSync(...npmCommand(['install', '--ignore-scripts']), { cwd: projectPath, stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS });
  }

  const atTypesNode = path.join(nodeModules, '@types', 'node');
  if (!fs.existsSync(atTypesNode)) {
    try {
      execFileSync(...npmCommand(['install', '--no-save', '--ignore-scripts', '@types/node']), { cwd: projectPath, stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS });
    } catch {
      warn('could not install @types/node');
    }
  }
}

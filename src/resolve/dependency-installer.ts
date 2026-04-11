import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function warn(message: string): void {
  if (process.env['SEMVER_CHECKS_VERBOSE']) {
    process.stderr.write(`[semver-checks] warning: ${message}\n`);
  }
}

export async function ensureProjectDeps(projectPath: string): Promise<void> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    warn(`skipping dependency install for '${projectPath}' because package.json was not found`);
    return;
  }

  const nodeModules = path.join(projectPath, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    execFileSync('npm', ['install', '--ignore-scripts'], { cwd: projectPath, stdio: 'pipe' });
  }

  const atTypesNode = path.join(nodeModules, '@types', 'node');
  if (!fs.existsSync(atTypesNode)) {
    try {
      execFileSync('npm', ['install', '--no-save', '--ignore-scripts', '@types/node'], { cwd: projectPath, stdio: 'pipe' });
    } catch {
      warn('could not install @types/node');
    }
  }
}

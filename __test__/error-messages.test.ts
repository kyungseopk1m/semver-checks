import { describe, it, expect } from 'vitest';
import { explainNpmError } from '../src/resolve/npm-resolver.js';
import { explainGitError } from '../src/resolve/git-resolver.js';

// These helpers turn opaque `npm pack` / `git archive` failures into one
// actionable line. Drive them with synthesized error objects so the assertions
// don't depend on a real (and slow/networked) child process.

describe('explainNpmError', () => {
  it('detects a missing npm binary', () => {
    expect(explainNpmError('pkg@1.0.0', { code: 'ENOENT' })).toMatch(/npm was not found.*PATH/i);
  });

  it('detects a 404 / unpublished version', () => {
    const err = { stderr: Buffer.from('npm error code E404\nnpm error 404 Not Found - GET .../pkg') };
    expect(explainNpmError('pkg@9.9.9', err)).toMatch(/not found in the npm registry/i);
  });

  it('detects a network failure', () => {
    const err = { stderr: Buffer.from('npm error code ENOTFOUND') };
    expect(explainNpmError('pkg@1.0.0', err)).toMatch(/registry|network/i);
  });

  it('falls back to the npm output tail when unrecognized', () => {
    const err = { stderr: Buffer.from('some other npm failure line') };
    expect(explainNpmError('pkg@1.0.0', err)).toContain('some other npm failure line');
  });
});

describe('explainGitError', () => {
  it('detects a missing git binary', () => {
    expect(explainGitError('v1.0.0', { code: 'ENOENT' })).toMatch(/git was not found.*PATH/i);
  });

  it('detects running outside a git repository', () => {
    const err = { stderr: Buffer.from('fatal: not a git repository (or any of the parent directories)') };
    expect(explainGitError('v1.0.0', err)).toMatch(/git repository/i);
  });

  it('detects a ref that does not exist', () => {
    const err = { stderr: Buffer.from('fatal: not a valid object name: v9.9.9') };
    expect(explainGitError('v9.9.9', err)).toMatch(/was not found|check it exists/i);
  });
});

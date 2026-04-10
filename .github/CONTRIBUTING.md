# Contributing to semver-checks

Thanks for your interest in contributing to semver-checks!

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Development Setup

**Requirements:** Node.js >= 18

```bash
git clone https://github.com/kyungseopk1m/semver-checks.git
cd semver-checks
npm install

npm test          # run tests
npm run build     # compile TypeScript
npm run check     # attw + publint quality checks
```

## Project Structure

```
src/
  extract/    # ts-morph API surface extraction
  classify/   # change classification rules (23 rules)
  compare/    # diff engine
  resolve/    # git ref / path resolution
  report/     # text and JSON output formatters
  cli.ts      # CLI entry point
  index.ts    # programmatic API entry point
  types.ts    # shared TypeScript types

__test__/
  classify.test.ts       # unit tests for classification rules
  fixtures/              # TypeScript fixture pairs for each rule
  e2e/compare.e2e.ts     # end-to-end compare tests
```

## How to Contribute

### Bug Reports

Open an issue using the [Bug Report](.github/ISSUE_TEMPLATE/bug.yml) template.

### Feature Requests

Open an issue using the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) template.

### Code Contributions

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-change`
3. Make your changes (see guidelines below)
4. Ensure tests pass: `npm test`
5. Ensure build is clean: `npm run build && npm run check`
6. Submit a pull request

## Pull Request Guidelines

- Keep each PR focused on a single logical change
- All tests must pass (`npm test`)
- Build and quality checks must pass (`npm run build && npm run check`)
- Add or update tests for any new functionality
- Update `CHANGELOG.md` under the `[Unreleased]` section
- Update `README.md` if you add a new detection rule or CLI option

## Adding a New Detection Rule

New detection rules are the most common type of contribution. Here's how:

**1. Add the change kind to `src/types.ts`**

```typescript
export type ChangeKind =
  | 'existing-kind'
  | 'your-new-kind'   // add here
  | ...
```

**2. Implement detection in `src/classify/`**

Add a classifier function that detects the new kind by comparing old and new AST nodes using ts-morph.

**3. Create fixture files in `__test__/fixtures/your-new-rule/`**

```
__test__/fixtures/your-new-rule/
  old.ts    # TypeScript source before the change
  new.ts    # TypeScript source after the change
```

**4. Add a test case in `__test__/classify.test.ts`**

```typescript
it('detects your-new-rule', async () => {
  const result = await classifyFromFixture('your-new-rule');
  expect(result).toContain({ kind: 'your-new-rule', level: 'major' });
});
```

**5. Update the rule table in `README.md`**

Add a row to the appropriate table (Major Changes or Minor Changes).

## Code Style

Follow existing patterns in the codebase. TypeScript strict mode is enabled — all code must type-check without errors.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).

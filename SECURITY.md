# Security Policy

## Supported Versions

As a pre-1.0 project, only the latest release is actively supported with security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in private reporting:
1. Go to the [Security tab](https://github.com/kyungseopk1m/semver-checks/security)
2. Click **"Report a vulnerability"**
3. Fill in the details

This creates a private advisory and allows us to collaborate on a fix before public disclosure.

### Alternative: Email

Send a report to **kks0919@kakao.com** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Your contact information (optional)

## Response Timeline

- **Acknowledgment**: within 72 hours
- **Fix or mitigation**: target within 14 days, depending on complexity
- You will be notified when the issue is resolved and may optionally be credited in the release notes

## Security Scope

semver-checks analyzes TypeScript source files using ts-morph and resolves git references to extract API snapshots. It does **not** execute user code.

The primary security surface is the git reference resolution path (`src/resolve/`), which uses `git archive` with validated ref inputs. If you identify a way to bypass ref validation or cause unexpected code execution, please report it.

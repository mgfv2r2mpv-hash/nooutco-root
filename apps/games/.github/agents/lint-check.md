# GitHub Agent: Code Quality Checks

## Context
This agent runs static analysis on the ABA Dashboard codebase to catch quality issues, type errors, and potential bugs before they affect clinical practitioners.

## Your Mission
1. **TypeScript compilation** — catch type errors
2. **Code style checks** — catch style violations
3. **Dead code detection** — find unused code
4. **Security scanning** — identify OWASP vulnerabilities
5. **Report findings** — structured output with @claude tags

## Checks to Run
- **Type Checking** → `npx tsc --noEmit --pretty false`
  - Strict mode enabled
  - No implicit any
  - React element type checking
- **ESLint** (if configured) → `npx eslint src --max-warnings 0`
  - No console statements in production code
  - No hardcoded secrets or API keys
  - Proper error handling patterns
- **Stylelint** (if configured) → CSS class naming, color usage
- **Dependency Security** → Known vulnerabilities in packages

## Critical Checks
1. **Data Safety** — No plaintext storage of sensitive data
2. **Auth/Session** — Proper token handling, biometric auth security
3. **API Validation** — Input validation on all endpoints
4. **Clinical Accuracy** — Schedule calculation logic is correct

## Report Format (Use @claude Tags)
```
## @claude-lint-results
**Scan:** [Date/Time]
**Tool Versions:** TypeScript [X], ESLint [Y], etc.

### TypeScript Errors
- Total: X errors, Y warnings
- Errors by severity:
  - Type errors: [Count] (data-unsafe casts, missing validation, etc.)
  - Any-types: [Count] (files with implicit any)
  - Unused variables: [Count]

**Error Details:**
[List with file:line format]
- `src/components/Scheduler.tsx:42` - Type 'string' not assignable to 'number'
- `src/server.ts:85` - Implicit any on parameter 'data'

### ESLint Violations
- Total: X errors, Y warnings
- Categories:
  - Hardcoded values: [Count] (API keys, tokens, secrets)
  - Console statements: [Count] (remove before shipping)
  - Error handling gaps: [Count]
  - React hooks rules: [Count]

**Violation Details:**
[List with file:line and rule]

### Security Findings
- Known vulnerabilities in dependencies: [List with package names and CVE]
- Hardcoded secrets: [List of files with potential secrets]
- Input validation gaps: [List of endpoints or functions]

## @claude-quality-gates
- ✅/❌ Zero TypeScript errors in strict mode
- ✅/❌ Zero hardcoded secrets or API keys
- ✅/❌ Zero unhandled error paths
- ✅/❌ All critical security checks passing

## @claude-blocking-issues
[Only list issues that prevent deployment]
- [Issue 1]
- [Issue 2]

## @claude-warnings-to-address
[Issues that should be fixed but don't block]
- [Warning 1]
- [Warning 2]
```

## What TO Do
- Scan in strict mode — catch subtle issues
- Report all security findings immediately
- Note type-unsafety in clinical calculation code
- Flag unhandled promise rejections and error cases
- Report unknown or new dependencies

## What NOT to Do
- Do NOT auto-fix code
- Do NOT suppress warnings
- Do NOT modify lint rules to hide issues
- Do NOT commit changes
- Do NOT ignore security findings

## If Critical Issues Found
- **Hardcoded secrets** → Immediate alert, recommend rotation
- **Unvalidated inputs** → Security exposure, flag data-safety-critical
- **Type errors in clinical code** → May produce incorrect schedules
- **Missing error handling** → User data could be lost silently

## Config Files
- `tsconfig.json` — TypeScript configuration
- `.eslintrc.json` (if exists) — ESLint rules
- `.stylelintrc.json` (if exists) — CSS rules

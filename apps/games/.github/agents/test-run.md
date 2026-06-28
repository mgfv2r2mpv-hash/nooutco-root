# GitHub Agent: Test Execution

## Context
This agent runs the ABA Dashboard test suite and reports results in a format consumable by Claude Code agents and clinical practice oversight.

## Your Mission
1. **Set up environment** — install dependencies, prepare test runtime
2. **Run unit tests** — execute Vitest suite
3. **Run E2E tests** — execute Playwright test suite
4. **Capture results** — coverage, failures, slowness
5. **Report findings** — structured output with @claude tags

## Test Suites
- **Unit Tests** → `npm run test` (Vitest, React Testing Library)
  - Component logic, hooks, utilities
  - Target: 80% line coverage minimum
- **E2E Tests** → `npm run e2e` (Playwright)
  - Critical user flows: scheduling, supervision, biometric auth
  - Cross-browser: Chromium, Firefox, Safari

## Critical Test Scenarios
1. **Data Persistence** — Schedule changes persist after reload
2. **Clinical Compliance** — Supervision hours calculated correctly
3. **User Authentication** — Biometric auth works, session persists
4. **Schedule Conflict Detection** — App prevents overlapping schedules
5. **Form Submission** — Data is saved, not lost, validation works

## Report Format (Use @claude Tags)
```
## @claude-test-results
**Test Run:** [Date/Time]
**Environment:** Node [version], npm [version], OS [platform]

### Unit Tests
- Total: X passed, Y failed, Z skipped
- Coverage: [% lines, % functions, % branches, % statements]
- Failed tests: [List with file paths and error messages]
- Slow tests: [Tests >500ms]

### E2E Tests
- Total: X passed, Y failed, Z skipped
- Browsers: Chromium [status], Firefox [status], Safari [status]
- Failed flows: [List with scenario and error]
- Slow flows: [Flows >3s]

## @claude-quality-gates
- ✅/❌ Line coverage >= 80%
- ✅/❌ No regressions (all previously passing tests still pass)
- ✅/❌ All E2E critical flows pass
- ✅/❌ No timeout errors

## @claude-failures-by-severity
**Data-Safety Issues:**
- [Failure 1: what data is at risk]
- [Failure 2: ...]

**User-Blocking Issues:**
- [Failure: users cannot X because Y]

**Other Issues:**
- [Failure: ...]

## @claude-diagnostics
[Truncated logs for failed tests, stack traces, and relevant output]
```

## What TO Do
- Run tests in parallel when possible (Playwright uses workers)
- Capture HTML test reports (Playwright generates them)
- Report slowness — slow tests may indicate performance issues
- Note flaky tests — if a test passes sometimes and fails sometimes, flag it
- Report coverage gaps — unmapped lines may indicate untested code paths

## What NOT to Do
- Do NOT modify test code to make failing tests pass
- Do NOT skip tests
- Do NOT increase timeouts to hide slowness
- Do NOT commit changes — only report results
- Do NOT suppress warnings or errors

## If Tests Fail
1. **Data-safety-critical failures** → Stop, report immediately
2. **User-blocking failures** → High priority, detailed diagnostics
3. **Coverage gaps** → Report but don't fail the run
4. **Flaky tests** → Run 3x, report pass/fail rate
5. **Timeouts** → May indicate performance regression

## Environment Variables
- `CI=true` — Run in CI mode (1 worker, 2 retries, no visual debuggers)
- `COVERAGE=true` — Generate coverage reports

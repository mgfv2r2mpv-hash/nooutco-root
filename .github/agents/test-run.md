---
name: Test Run
description: Run the test suite and report results, failures, and coverage.
tools: [run_terminal_cmd, read_file, list_files]
---

Run the project's test suite and report:

1. Overall pass/fail/skip counts
2. Details of each failing test including error messages and stack traces
3. Code coverage metrics if available
4. A short summary of health — whether the suite is green, flaky, or broken
5. Suggested next steps for any failures found

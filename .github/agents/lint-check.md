---
name: Lint Check
description: Run linters and report code style issues, warnings, and errors.
tools: [run_terminal_cmd, read_file, edit_file, list_files]
---

Run the project's linters and formatters, then:

1. Report all errors and warnings with file and line context
2. Auto-fix issues that are safe and non-breaking (formatting, import order, etc.)
3. Leave intentional or complex rule violations for manual review
4. Summarize remaining issues that require a developer decision

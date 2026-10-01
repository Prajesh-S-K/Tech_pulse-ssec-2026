# Development workflow

Use VS Code with the project folder or included workspace. Read docs/PROJECT.md and docs/HANDOFF.md before starting.

For each small, testable change:

1. Identify the requirement and explain important decisions in plain language.
2. Implement the smallest useful step with synthetic demo data.
3. Run checks appropriate to the change; record actual results and unresolved failures.
4. Update PROJECT.md for architecture, contracts, setup, or requirements changes.
5. Append DEVLOG.md for meaningful progress, tests, failures, fixes, and decisions.
6. Refresh HANDOFF.md for changes to current state, blockers, or the next task.
7. Update README.md and DEMO.md when user-visible behavior or run instructions change; update CHANGELOG.md for milestones.
8. Review the diff and keep commits focused. Do not claim tests passed unless run.

Keep public docs portable: use repository-relative links and no machine-specific paths except the local handoff. Keep credentials, real student records, photos, generated outputs, and local environment files out of Git. Commit a sanitized .env.example only when real configuration keys are known.

Before public release choose a license and review staged files. The source PDF is excluded pending a redistribution decision. GitHub upload is a later milestone; this scaffold does not publish anything.

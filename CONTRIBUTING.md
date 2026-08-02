# Contributing to impex-lsp

Thanks for your interest! This project is an early scaffold — issues, ideas and PRs are all welcome.

## Development setup

```bash
npm install
npm run dev
npm test
npm run typecheck
```

## Ground rules

- **Types/interfaces first.** Model new concepts on the core abstraction (`ImpexValidator`) so implementations stay interchangeable.
- **Every change needs a test.**
- **Conventional commits.** e.g. `feat: ...`, `fix: ...`, `docs: ...`.

## Pull requests

1. Fork & branch from `main`.
2. Ensure the build and tests pass.
3. Explain the *why*, not just the *what*.

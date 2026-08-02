# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this project is

**impex-lsp** — An ImpEx language server, validator and test harness for SAP Commerce — autocomplete, static validation and CI linting for a runtime-only DSL.

ImpEx errors surface only at runtime; there is no autocomplete, no type checking against the live model, no diff/merge help and no CI validation. Essential-data drift between environments is a recurring outage source.

**Solution:** A **Language Server Protocol** implementation for ImpEx with schema-aware autocomplete and static validation against a type-model snapshot, a **CLI linter for CI** ('this ImpEx references a removed attribute'), and a fixture/test harness that runs ImpEx against an in-memory type model.

> Status: early scaffold. The core abstraction, a starter implementation and tests are real; most capabilities are documented intent, not yet built. Do not claim features exist that aren't in the code.

## Stack

Node 20 + TypeScript (strict), Vitest, ESLint.

## Project layout

- `src/**` — production code (core abstraction: `ImpexValidator` in `src/index.ts`).
- `test/**` — Vitest tests.
- `package.json`, `tsconfig.json` — build config.
- `docs/` — GitHub Pages site (`index.html`, `.nojekyll`). Served at https://alextsvetkov.github.io/impex-lsp/.
- `.github/workflows/ci.yml` — CI (build + test on push/PR).

## Common commands

```bash
npm install
npm run build
npm test
npm run typecheck
```

## Conventions

- Strict TypeScript; no `any` without justification.
- Model new concepts as types/interfaces first; keep `ImpexValidator` swappable.
- ESM modules; `.js` extensions in relative imports (NodeNext).
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- Generated code (if any) stays out of version control.
- Keep `README.md`, `docs/index.html` and this file in sync when the scope changes.

## Working agreements for agents

- This is part of a **suite of SAP Commerce backend tools**; keep terminology consistent with the sibling repos (e.g. `commerce-mcp`, `flow-context`).
- When adding real behaviour, update the Roadmap in `README.md` and add tests in the same PR.
- Don't introduce a live-backend dependency into the default build — keep the scaffold green on a clean checkout.
- If you change the public contract, reflect it in the docs site and the README capability table.

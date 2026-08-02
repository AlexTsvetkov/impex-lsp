# impex-lsp

**An ImpEx language server, validator and test harness for SAP Commerce — autocomplete, static validation and CI linting for a runtime-only DSL.**

**🌐 Live site: https://alextsvetkov.github.io/impex-lsp/**

> ⚠️ **Status:** early scaffold. The core abstraction, a starter implementation and tests are real; this is a foundation to build on, not a finished product. See [Roadmap](#roadmap).

**Stack:** Node 20 + TypeScript.

---

## The problem

ImpEx errors surface only at runtime; there is no autocomplete, no type checking against the live model, no diff/merge help and no CI validation. Essential-data drift between environments is a recurring outage source.

## The solution

A **Language Server Protocol** implementation for ImpEx with schema-aware autocomplete and static validation against a type-model snapshot, a **CLI linter for CI** ('this ImpEx references a removed attribute'), and a fixture/test harness that runs ImpEx against an in-memory type model.

See the [project site](https://alextsvetkov.github.io/impex-lsp/) for the full benefits narrative.

## Design principles

1. **Fail before deploy** — Validate ImpEx in the editor and in CI, never for the first time at runtime.
2. **Schema-aware** — Autocomplete and checks are driven by a snapshot of the live type system.
3. **Editor-native** — Standard LSP — works in VS Code and IntelliJ.
4. **Testable data scripts** — A harness makes ImpEx a testable artifact.

## Core abstraction

`ImpexValidator` — Statically validates an ImpEx document against a type-model snapshot and returns line-anchored diagnostics.

## Features

| Capability | Description |
|------------|-------------|
| `LSP server` | Autocomplete, hover, diagnostics for ImpEx. |
| ``impex-lint`` | CI-friendly static validator. |
| `Type-model snapshot` | Validate against the real model. |
| `Test harness` | Run ImpEx against an in-memory model. |

## Quick start

```bash
npm install
npm run build
npm test
```

## Roadmap

- [ ] Flesh out the core beyond the starter implementation.
- [ ] Wire against a live SAP Commerce / BTP environment.
- [ ] Publish artifacts and usage docs.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Conventional commits; generated code stays out of version control.

## License

[MIT](./LICENSE) © 2026 Aliaksandr Tsviatkou

---

*Part of a backend tooling suite for SAP Commerce Cloud. See [`commerce-mcp`](https://github.com/AlexTsvetkov/commerce-mcp) for the AI-native flagship.*

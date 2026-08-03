# impex-lsp

**An ImpEx language server, validator and test harness for SAP Commerce — autocomplete, static validation and CI linting for a runtime-only DSL.**

**🌐 Live site: https://alextsvetkov.github.io/impex-lsp/**

> ✅ **Status:** working core. A real, tested implementation of the core capability runs offline (no live SAP Commerce instance needed); unit tests pass in CI. Not yet a production product — see [Roadmap](#roadmap) for what would make it one.

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

## Usage

These snippets are distilled from the runnable examples below; the `Output:` blocks are the real captured stdout.

### Validate a script — clean vs. broken

```ts
import { validate } from "impex-lsp";

// A structurally valid script → no diagnostics.
const clean = [
  "INSERT_UPDATE Product;code[unique=true];name[lang=en]",
  ";PROD-001;Sample Product",
].join("\n");
console.log("clean:", validate(clean));

// A value line with more cells than the header declares → one error.
const broken = [
  "INSERT_UPDATE Product;code[unique=true];name",
  ";PROD-1;Widget;EXTRA-COLUMN",
].join("\n");
for (const d of validate(broken)) {
  console.log(`[${d.severity}] line ${d.line} ${d.code}: ${d.message}`);
}
```

Output:

```text
clean: []
[error] line 2 IMPEX_COLUMN_COUNT_MISMATCH: Value line has 3 field(s) but the header (line 1) declares 2 column(s).
```

### Validate against a `TypeModel` — catch unknown attributes

```ts
import { validate, type TypeModel } from "impex-lsp";

const model: TypeModel = {
  Product: new Set(["code", "name", "catalogVersion"]),
};

// `colour` and `weight` aren't defined on Product → warnings.
const script = [
  "INSERT_UPDATE Product;code[unique=true];name;colour;weight",
  ";PROD-1;Widget;red;3kg",
].join("\n");
for (const d of validate(script, model)) {
  console.log(`[${d.severity}] line ${d.line} ${d.code}: ${d.message}`);
}
```

Output:

```text
[warning] line 1 IMPEX_UNKNOWN_ATTRIBUTE: Attribute "colour" is not defined on type "Product".
[warning] line 1 IMPEX_UNKNOWN_ATTRIBUTE: Attribute "weight" is not defined on type "Product".
```

## Examples

Runnable, heavily-commented tutorials live in [`examples/`](./examples/). Each is a
self-contained mini-lesson you run with `tsx` (already a dev dependency) — no build step:

| Example | Run it | Teaches |
|---------|--------|---------|
| `examples/01-validate-impex.ts` | `npx tsx examples/01-validate-impex.ts` | Static validation with no type model: a clean script plus one broken script per structural diagnostic (unknown mode, header-no-type, value-before-header, column-count mismatch, unknown macro). |
| `examples/02-with-type-model.ts` | `npx tsx examples/02-with-type-model.ts` | Passing a `TypeModel` to unlock `IMPEX_UNKNOWN_TYPE` (error) and `IMPEX_UNKNOWN_ATTRIBUTE` (warning) checks, plus the `ImpexValidator` facade. |
| `examples/03-live-model.ts` | `npx tsx examples/03-live-model.ts` | Building the `TypeModel` live from a running instance via `HybrisTypeModelSource`, and the pure transforms behind it. Runs offline (prints setup guidance); set the env vars below to validate against a live instance. |

Run example 03 against a local SAP Commerce / HAC instance:

```bash
COMMERCE_BASE_URL=https://localhost:9002 \
COMMERCE_USER=admin COMMERCE_PASSWORD=nimda COMMERCE_INSECURE_TLS=true \
npx tsx examples/03-live-model.ts
```

## Roadmap

- [x] Implement the core capability with real logic + unit tests.
- [ ] Broaden coverage (more rules/edge cases) beyond the first working version.
- [ ] Wire against a live SAP Commerce / BTP environment.
- [ ] Publish artifacts and usage docs.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Conventional commits; generated code stays out of version control.

## License

[MIT](./LICENSE) © 2026 Aliaksandr Tsviatkou

## Honest assessment

> From the v2 self-critical analysis. Scores use **Gap · Value · Moat · Time-to-revenue · Risk** (for Risk, **higher = safer**). Prior art is named deliberately — "no competitor" is almost never true.

**Scores:** Gap 4 · Value 3 · Moat 2 · TTR 4 · Risk 4

- **Prior art / competition.** Primitive IDE plugins exist; none do schema-aware validation against a live model or CI linting.
- **True differentiator.** The type-model-aware validator + CI linter. The LSP itself is table stakes.
- **Kill criterion.** If teams won't run it in CI (the only sticky part), it's a nice free tool, not a business.
- **Verdict.** **Ship as an OSS funnel**, not a standalone product.

See the full landscape, go-to-market and the **IP / conflict-of-interest** discussion in [sap-commerce-general-ideas-for-startup.md](https://github.com/AlexTsvetkov/sap-commerce-ideas-for-projects/blob/main/ideas-for-startup/sap-commerce-general-ideas-for-startup.md).

---

*Part of a backend tooling suite for SAP Commerce Cloud. See [`commerce-mcp`](https://github.com/AlexTsvetkov/commerce-mcp) for the AI-native flagship.*

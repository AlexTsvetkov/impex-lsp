/**
 * Example 01 — Static validation of ImpEx scripts (no type model).
 * ================================================================
 *
 * Run it:
 *   npx tsx examples/01-validate-impex.ts
 *
 * WHAT THIS TEACHES
 * -----------------
 * ImpEx is SAP Commerce's data-import DSL. It has no compile step, so mistakes
 * only surface when the platform actually runs the script — often in a deploy
 * pipeline, long after they were written. `validate()` performs a purely
 * structural, offline analysis of an ImpEx document and returns line-anchored
 * `ImpexDiagnostic` objects so those mistakes can be caught in an editor or CI.
 *
 * This first example uses NO type model, so it only exercises the structural
 * rules that need no knowledge of the SAP type system:
 *   - IMPEX_UNKNOWN_MODE        line isn't a mode/value/macro/comment
 *   - IMPEX_HEADER_NO_TYPE      a mode keyword with no type code after it
 *   - IMPEX_VALUE_BEFORE_HEADER a `;`-led value line with no header above it
 *   - IMPEX_COLUMN_COUNT_MISMATCH value line has a different cell count
 *   - IMPEX_UNKNOWN_MACRO       `$ref` used but never defined with `$ref=...`
 *
 * (Type/attribute checks require a TypeModel — see 02-with-type-model.ts.)
 */

// Note the `.js` extension on the relative import: this project is ESM, and
// TypeScript's NodeNext resolution wants the *emitted* file name here even
// though the source is `.ts`. tsx understands this at runtime.
import { validate, DiagnosticCode, type ImpexDiagnostic } from "../src/index.js";

/** Pretty-print a batch of diagnostics under a labelled heading. */
function printDiagnostics(label: string, script: string, diags: ImpexDiagnostic[]): void {
  console.log(`\n=== ${label} ===`);
  console.log("--- script ---");
  // Number the lines so the reader can line up diagnostics with source.
  script.split("\n").forEach((line, i) => console.log(`${String(i + 1).padStart(2)} | ${line}`));
  console.log("--- diagnostics ---");
  if (diags.length === 0) {
    console.log("(none — script is structurally valid)");
    return;
  }
  for (const d of diags) {
    const col = d.column !== undefined ? `:${d.column}` : "";
    console.log(`[${d.severity}] line ${d.line}${col} ${d.code}: ${d.message}`);
  }
}

function main(): void {
  console.log("impex-lsp :: example 01 :: static validation (no type model)");

  // ---------------------------------------------------------------------------
  // Scenario A: a clean, well-formed script. Expect ZERO diagnostics.
  // A `$macro=` definition, a header with a mode + type + columns, then a
  // matching value line. Everything lines up.
  // ---------------------------------------------------------------------------
  const clean = [
    "$catalogVersion=catalogVersion(catalog(id),version)[unique=true,default=myCatalog:Staged]",
    "INSERT_UPDATE Product;code[unique=true];name[lang=en];$catalogVersion",
    ";PROD-001;Sample Product;",
  ].join("\n");
  printDiagnostics("A. clean script (expect no diagnostics)", clean, validate(clean));

  // ---------------------------------------------------------------------------
  // Scenario B: IMPEX_UNKNOWN_MODE — first token isn't a valid mode keyword.
  // The valid modes are INSERT, UPDATE, INSERT_UPDATE, REMOVE. "UPSERT" is not
  // one of them, and the line is neither a value, macro nor comment.
  // ---------------------------------------------------------------------------
  const unknownMode = ["UPSERT Product;code[unique=true];name", ";PROD-1;Widget"].join("\n");
  printDiagnostics("B. unknown mode (IMPEX_UNKNOWN_MODE)", unknownMode, validate(unknownMode));

  // ---------------------------------------------------------------------------
  // Scenario C: IMPEX_HEADER_NO_TYPE — a mode keyword with no type code after
  // it. `INSERT_UPDATE ;...` has the mode but the type-code slot is empty.
  // ---------------------------------------------------------------------------
  const headerNoType = ["INSERT_UPDATE ;code[unique=true];name"].join("\n");
  printDiagnostics("C. header with no type (IMPEX_HEADER_NO_TYPE)", headerNoType, validate(headerNoType));

  // ---------------------------------------------------------------------------
  // Scenario D: IMPEX_VALUE_BEFORE_HEADER — a value line (starts with `;`)
  // before any header has been declared, so there is no column contract to
  // interpret it against.
  // ---------------------------------------------------------------------------
  const valueBeforeHeader = [";PROD-1;Orphan value with no header above it"].join("\n");
  printDiagnostics("D. value before header (IMPEX_VALUE_BEFORE_HEADER)", valueBeforeHeader, validate(valueBeforeHeader));

  // ---------------------------------------------------------------------------
  // Scenario E: IMPEX_COLUMN_COUNT_MISMATCH — the header declares 3 cells
  // (mode+type, code, name) but the value line supplies 4. Note the validator
  // counts cells respecting quotes, so `"a;b"` is a single cell.
  // ---------------------------------------------------------------------------
  const columnMismatch = [
    "INSERT_UPDATE Product;code[unique=true];name",
    ";PROD-1;Widget;EXTRA-COLUMN",
  ].join("\n");
  printDiagnostics("E. column count mismatch (IMPEX_COLUMN_COUNT_MISMATCH)", columnMismatch, validate(columnMismatch));

  // ---------------------------------------------------------------------------
  // Scenario F: IMPEX_UNKNOWN_MACRO — `$missingMacro` is referenced but never
  // defined with a `$missingMacro=...` line. Macros are resolved across the
  // whole document (order-independent) in a first pass, so forward references
  // are fine — only genuinely-undefined ones are flagged.
  // ---------------------------------------------------------------------------
  const unknownMacro = [
    "INSERT_UPDATE Product;code[unique=true];$missingMacro",
    ";PROD-1;whatever",
  ].join("\n");
  printDiagnostics("F. unknown macro (IMPEX_UNKNOWN_MACRO)", unknownMacro, validate(unknownMacro));

  // ---------------------------------------------------------------------------
  // Bonus: the stable DiagnosticCode map lets consumers match findings without
  // hard-coding magic strings. Here we count error-severity diagnostics of a
  // specific code across scenario E.
  // ---------------------------------------------------------------------------
  const mismatchErrors = validate(columnMismatch).filter(
    (d) => d.code === DiagnosticCode.COLUMN_COUNT_MISMATCH,
  );
  console.log(`\nDiagnosticCode.COLUMN_COUNT_MISMATCH matched ${mismatchErrors.length} finding(s) in scenario E.`);
}

main();

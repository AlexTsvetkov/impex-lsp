/**
 * Example 02 — Validating against a TypeModel.
 * ============================================
 *
 * Run it:
 *   npx tsx examples/02-with-type-model.ts
 *
 * WHAT THIS TEACHES
 * -----------------
 * Structural checks (example 01) catch malformed ImpEx. But the most valuable
 * checks need to know the SAP Commerce *type system*: does the type this header
 * targets actually exist, and are the attributes it lists really defined on
 * that type? Those checks are driven by a `TypeModel` — a plain snapshot mapping
 * each type code to the set of attribute qualifiers allowed on it.
 *
 *   type TypeModel = Record<string, ReadonlySet<string> | readonly string[]>;
 *
 * When you pass a model to `validate(script, model)` two extra rules fire:
 *   - IMPEX_UNKNOWN_TYPE       (error)   header targets a type not in the model
 *   - IMPEX_UNKNOWN_ATTRIBUTE  (warning) a column qualifier isn't on that type
 *
 * The model can be hand-authored (as here) or fetched live from a running
 * instance (see 03-live-model.ts). Values may be a Set or a plain string[] —
 * both are accepted, so build the model however is convenient.
 */

import {
  validate,
  DiagnosticCode,
  ImpexValidator,
  type TypeModel,
  type ImpexDiagnostic,
} from "../src/index.js";

function printDiagnostics(label: string, script: string, diags: ImpexDiagnostic[]): void {
  console.log(`\n=== ${label} ===`);
  console.log("--- script ---");
  script.split("\n").forEach((line, i) => console.log(`${String(i + 1).padStart(2)} | ${line}`));
  console.log("--- diagnostics ---");
  if (diags.length === 0) {
    console.log("(none)");
    return;
  }
  for (const d of diags) {
    console.log(`[${d.severity}] line ${d.line} ${d.code}: ${d.message}`);
  }
}

function main(): void {
  console.log("impex-lsp :: example 02 :: validating against a TypeModel");

  // ---------------------------------------------------------------------------
  // A hand-authored snapshot of the (subset of the) type system this script
  // touches. `Product` allows `code`/`name`/`catalogVersion`; `Category`
  // allows `code`/`name`. Note we mix a Set and an array purely to show both
  // representations are accepted.
  // ---------------------------------------------------------------------------
  const model: TypeModel = {
    Product: new Set(["code", "name", "catalogVersion"]),
    Category: ["code", "name"], // plain array — also fine
  };
  console.log("\nTypeModel used:");
  console.log(
    Object.fromEntries(
      Object.entries(model).map(([k, v]) => [k, [...(v as Iterable<string>)]]),
    ),
  );

  // ---------------------------------------------------------------------------
  // Scenario A: every type and attribute is known -> no model-driven findings.
  // ---------------------------------------------------------------------------
  const good = [
    "INSERT_UPDATE Product;code[unique=true];name[lang=en];catalogVersion",
    ";PROD-1;Widget;",
  ].join("\n");
  printDiagnostics("A. all types/attributes known (expect none)", good, validate(good, model));

  // ---------------------------------------------------------------------------
  // Scenario B: IMPEX_UNKNOWN_TYPE — `Widget` is not present in the model, so
  // the whole header is flagged (error). Because the type is unknown, its
  // columns are NOT further checked for unknown attributes.
  // ---------------------------------------------------------------------------
  const unknownType = ["INSERT_UPDATE Widget;code[unique=true];name", ";W-1;Gadget"].join("\n");
  printDiagnostics("B. unknown type (IMPEX_UNKNOWN_TYPE)", unknownType, validate(unknownType, model));

  // ---------------------------------------------------------------------------
  // Scenario C: IMPEX_UNKNOWN_ATTRIBUTE — `Product` is known, but `colour` and
  // `weight` are not defined on it, so each produces a WARNING (advisory, not a
  // hard error). The bracket modifiers (`[unique=true]`) are stripped before
  // the qualifier is looked up, and macro columns (`$...`) are skipped.
  // ---------------------------------------------------------------------------
  const unknownAttrs = [
    "INSERT_UPDATE Product;code[unique=true];name;colour;weight",
    ";PROD-1;Widget;red;3kg",
  ].join("\n");
  printDiagnostics("C. unknown attributes (IMPEX_UNKNOWN_ATTRIBUTE)", unknownAttrs, validate(unknownAttrs, model));

  // ---------------------------------------------------------------------------
  // The ImpexValidator facade: a stateful wrapper preconfigured with a default
  // model. Handy when you validate many scripts against the same snapshot.
  //   .validate() -> diagnostics    .isValid() -> no error-severity findings
  // Note `isValid` is TRUE for scenario C because unknown attributes are only
  // warnings — they don't block validity.
  // ---------------------------------------------------------------------------
  const validator = new ImpexValidator(model);
  console.log(`\n${validator.describe()}`);
  console.log(`\nImpexValidator.isValid(scenario A) = ${validator.isValid(good)}`);
  console.log(`ImpexValidator.isValid(scenario B, unknown type) = ${validator.isValid(unknownType)}`);
  console.log(`ImpexValidator.isValid(scenario C, unknown attrs) = ${validator.isValid(unknownAttrs)} (warnings don't fail validity)`);

  const warnCount = validator
    .validate(unknownAttrs)
    .filter((d) => d.code === DiagnosticCode.UNKNOWN_ATTRIBUTE).length;
  console.log(`\nScenario C produced ${warnCount} UNKNOWN_ATTRIBUTE warning(s).`);
}

main();

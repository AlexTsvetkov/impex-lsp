/**
 * Example 03 — Validating against a LIVE type model.
 * ==================================================
 *
 * Run it OFFLINE (no instance needed — prints setup guidance and exits):
 *   npx tsx examples/03-live-model.ts
 *
 * Run it LIVE (against a local SAP Commerce / HAC instance):
 *   COMMERCE_BASE_URL=https://localhost:9002 \
 *   COMMERCE_USER=admin COMMERCE_PASSWORD=nimda COMMERCE_INSECURE_TLS=true \
 *   npx tsx examples/03-live-model.ts
 *
 * WHAT THIS TEACHES
 * -----------------
 * Examples 01/02 use a hand-authored TypeModel. In reality the model drifts:
 * an attribute gets removed in one environment but the ImpEx that references it
 * lingers. `HybrisTypeModelSource` builds the TypeModel *live* from a running
 * instance by driving the HAC (Hybris Admin Console) FlexibleSearch endpoint,
 * so validation runs against the schema that is actually deployed.
 *
 * The flow is:
 *   1. hacConfigFromEnv()  -> HacConfig | undefined  (undefined => run offline)
 *   2. new HybrisTypeModelSource(cfg).fetchTypeModel([...typeCodes])
 *   3. validate(script, liveModel)
 * or, as a one-liner: validateAgainstLive(script, cfg).
 *
 * This example is written so it ALWAYS runs: with no COMMERCE_BASE_URL it prints
 * how to set the env vars and returns. It never requires a live instance.
 *
 * It also demonstrates the PURE, network-free transforms the live path is built
 * from (buildTypeModel / qualifiersFromFlexResult / extractReferencedTypeCodes),
 * which run identically with or without an instance.
 */

import {
  validate,
  hacConfigFromEnv,
  HybrisTypeModelSource,
  buildTypeModel,
  qualifiersFromFlexResult,
  extractReferencedTypeCodes,
  type FlexResult,
  type ImpexDiagnostic,
} from "../src/index.js";

/** A small ImpEx script we'll validate against the live schema. */
const SCRIPT = [
  "INSERT_UPDATE Product;code[unique=true];name[lang=en];catalogVersion",
  ";PROD-1;Widget;",
  "INSERT_UPDATE Currency;isocode[unique=true];name[lang=en]",
  ";EUR;Euro",
].join("\n");

function printDiagnostics(diags: ImpexDiagnostic[]): void {
  if (diags.length === 0) {
    console.log("(none — script matches the live type model)");
    return;
  }
  for (const d of diags) {
    console.log(`[${d.severity}] line ${d.line} ${d.code}: ${d.message}`);
  }
}

/**
 * Part 1 — the pure transforms. These are the building blocks of the live path
 * but need no network, so they demonstrate the data shapes deterministically.
 */
function demonstratePureTransforms(): void {
  console.log("\n=== Pure, network-free transforms ===");

  // extractReferencedTypeCodes: scan a script for the type codes it targets, so
  // the live fetch can be narrowed to just those types (not the whole system).
  const referenced = extractReferencedTypeCodes(SCRIPT);
  console.log("extractReferencedTypeCodes(SCRIPT) =", referenced);

  // qualifiersFromFlexResult: a single-column FlexibleSearch result (attribute
  // qualifiers) -> a de-duplicated Set. This is exactly what a live attribute
  // query returns, here canned so we can show the shape.
  const cannedAttrResult: FlexResult = {
    headers: ["qualifier"],
    resultList: [["code"], ["name"], ["catalogVersion"], ["name"] /* dup dropped */],
    resultCount: 4,
    exception: null,
  };
  console.log("qualifiersFromFlexResult(canned) =", [...qualifiersFromFlexResult(cannedAttrResult)]);

  // buildTypeModel: assemble a full TypeModel from per-type attribute results.
  const model = buildTypeModel([
    { typeCode: "Product", attributes: cannedAttrResult },
    {
      typeCode: "Currency",
      attributes: { headers: ["qualifier"], resultList: [["isocode"], ["name"]], resultCount: 2, exception: null },
    },
  ]);
  console.log(
    "buildTypeModel(...) =",
    Object.fromEntries(Object.entries(model).map(([k, v]) => [k, [...(v as Iterable<string>)]])),
  );

  // That model is a normal TypeModel — feed it straight into validate().
  console.log("\nValidate SCRIPT against the canned model:");
  printDiagnostics(validate(SCRIPT, model));
}

async function main(): Promise<void> {
  console.log("impex-lsp :: example 03 :: live type model");

  // These transforms always run — no instance required.
  demonstratePureTransforms();

  // Part 2 — the actual live fetch, only if configured.
  const cfg = hacConfigFromEnv();
  if (!cfg) {
    console.log("\n=== Live validation: SKIPPED ===");
    console.log("COMMERCE_BASE_URL is not set, so no live instance is contacted.");
    console.log("To validate against a running SAP Commerce instance, re-run with:");
    console.log(
      "\n  COMMERCE_BASE_URL=https://localhost:9002 \\\n" +
        "  COMMERCE_USER=admin COMMERCE_PASSWORD=nimda COMMERCE_INSECURE_TLS=true \\\n" +
        "  npx tsx examples/03-live-model.ts\n",
    );
    console.log("(admin/nimda + insecure TLS are the cloud-commerce-sample-setup local defaults.)");
    return;
  }

  console.log(`\n=== Live validation against ${cfg.baseUrl} ===`);
  console.log(`user=${cfg.user} insecureTls=${cfg.insecureTls}`);

  try {
    const source = new HybrisTypeModelSource(cfg);
    // Narrow the fetch to just the types the script references.
    const typeCodes = extractReferencedTypeCodes(SCRIPT);
    console.log("Fetching live type model for:", typeCodes);
    const liveModel = await source.fetchTypeModel(typeCodes);

    for (const [code, attrs] of Object.entries(liveModel)) {
      const list = [...(attrs as Iterable<string>)];
      console.log(`  ${code}: ${list.length} attributes (e.g. ${list.slice(0, 8).join(", ")}...)`);
    }

    console.log("\nDiagnostics for SCRIPT against the LIVE model:");
    printDiagnostics(validate(SCRIPT, liveModel));
  } catch (err) {
    // A live instance may be down or reject auth — never let that crash the
    // example. Report and exit cleanly.
    console.log("\nLive fetch failed (this is fine if no instance is running):");
    console.log(`  ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

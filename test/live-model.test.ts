import { describe, it, expect } from "vitest";
import {
  buildTypeModel,
  qualifiersFromFlexResult,
  extractInputCsrf,
  extractMetaCsrf,
  extractReferencedTypeCodes,
  hacConfigFromEnv,
  HybrisTypeModelSource,
  validateAgainstLive,
  type FlexResult,
  type HacConfig,
} from "../src/live-model.js";
import { validate, DiagnosticCode } from "../src/impex.js";

// ---------------------------------------------------------------------------
// CI-SAFE unit tests (no network). These run everywhere.
// ---------------------------------------------------------------------------

describe("live-model: pure helpers (no network)", () => {
  // Canned flexsearch JSON shaped exactly like the live contract examples.
  const productAttrs: FlexResult = {
    query: "…",
    headers: ["QualifierInternal"],
    resultCount: 6,
    exception: null,
    resultList: [["code"], ["name"], ["unit"], ["description"], [""], ["code"]],
  } as unknown as FlexResult;

  const currencyAttrs: FlexResult = {
    headers: ["QualifierInternal"],
    resultCount: 2,
    exception: null,
    resultList: [["isocode"], ["symbol"]],
  };

  it("qualifiersFromFlexResult dedups and drops blanks", () => {
    const set = qualifiersFromFlexResult(productAttrs);
    expect(set.has("code")).toBe(true);
    expect(set.has("name")).toBe(true);
    expect(set.has("")).toBe(false);
    // "code" appears twice in the canned rows but must collapse to one entry.
    expect(set.size).toBe(4);
  });

  it("buildTypeModel assembles the validator-shaped TypeModel from rows+headers", () => {
    const model = buildTypeModel([
      { typeCode: "Product", attributes: productAttrs },
      { typeCode: "Currency", attributes: currencyAttrs },
      { typeCode: "  ", attributes: currencyAttrs }, // blank code skipped
    ]);

    expect(Object.keys(model).sort()).toEqual(["Currency", "Product"]);

    const product = model["Product"] as ReadonlySet<string>;
    expect(product.has("code")).toBe(true);
    expect(product.has("name")).toBe(true);

    // The built model must be consumable by the existing validator: an unknown
    // attribute on a known type yields IMPEX_UNKNOWN_ATTRIBUTE.
    const diags = validate("INSERT_UPDATE Product;code;bogusAttr", model);
    expect(diags.map((d) => d.code)).toContain(DiagnosticCode.UNKNOWN_ATTRIBUTE);
    // A known type + known attributes produce none of those.
    expect(validate("INSERT_UPDATE Currency;isocode", model).map((d) => d.code)).not.toContain(
      DiagnosticCode.UNKNOWN_ATTRIBUTE,
    );
  });

  it("extractInputCsrf handles both attribute orderings", () => {
    expect(extractInputCsrf('<input type="hidden" name="_csrf" value="ABC123"/>')).toBe("ABC123");
    expect(extractInputCsrf('<input value="XYZ789" name="_csrf" type="hidden"/>')).toBe("XYZ789");
    expect(extractInputCsrf("<div>no token here</div>")).toBeUndefined();
  });

  it("extractMetaCsrf reads the meta content token", () => {
    expect(
      extractMetaCsrf('<meta name="_csrf" content="TOKEN-42" />'),
    ).toBe("TOKEN-42");
    expect(extractMetaCsrf('<meta name="_csrf_header" content="X-CSRF-TOKEN" />')).toBeUndefined();
  });

  it("extractReferencedTypeCodes finds header types and dedups", () => {
    const script = [
      "INSERT_UPDATE Product;code[unique=true];name",
      ";PROD-1;A",
      "INSERT Currency;isocode",
      "UPDATE Product;code",
      "# comment",
      ";orphan",
    ].join("\n");
    expect(extractReferencedTypeCodes(script).sort()).toEqual(["Currency", "Product"]);
  });

  it("hacConfigFromEnv returns undefined without COMMERCE_BASE_URL", () => {
    expect(hacConfigFromEnv({})).toBeUndefined();
    const cfg = hacConfigFromEnv({
      COMMERCE_BASE_URL: "https://localhost:9002/",
      COMMERCE_INSECURE_TLS: "true",
    });
    expect(cfg).toEqual<HacConfig>({
      baseUrl: "https://localhost:9002",
      user: "admin",
      password: "nimda",
      insecureTls: true,
    });
  });

  it("flex() throws before login (no CSRF token)", async () => {
    const src = new HybrisTypeModelSource({
      baseUrl: "https://localhost:9002",
      user: "admin",
      password: "nimda",
      insecureTls: true,
    });
    await expect(src.flex("SELECT {pk} FROM {Product}")).rejects.toThrow(/login/i);
  });

  it("validateAgainstLive throws when no config and no env", async () => {
    // Deterministic regardless of the ambient env (the live run sets these):
    // clear COMMERCE_BASE_URL for the duration of this assertion, then restore.
    const saved = process.env.COMMERCE_BASE_URL;
    delete process.env.COMMERCE_BASE_URL;
    try {
      await expect(validateAgainstLive("INSERT_UPDATE Product;code")).rejects.toThrow(
        /COMMERCE_BASE_URL/,
      );
    } finally {
      if (saved !== undefined) process.env.COMMERCE_BASE_URL = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// GATED live integration test — skipped unless COMMERCE_BASE_URL is set.
// ---------------------------------------------------------------------------

const RUN = !!process.env.COMMERCE_BASE_URL;

describe.skipIf(!RUN)("live-model: against a running SAP Commerce instance", () => {
  const cfg = hacConfigFromEnv()!;

  it("logs in and fetches a real TypeModel for Currency + Product", async () => {
    const source = new HybrisTypeModelSource(cfg);
    await source.login();
    const model = await source.fetchTypeModel(["Currency", "Product"]);

    const product = model["Product"] as ReadonlySet<string> | undefined;
    expect(product, "Product must be present in the live model").toBeDefined();
    expect(product!.size).toBeGreaterThan(0);
    expect(product!.has("code")).toBe(true);

    // Log the real attribute count as live proof.
    // eslint-disable-next-line no-console
    console.log(`[live] Product attribute count = ${product!.size}`);
  }, 60_000);

  it("validateAgainstLive flags a bogus attribute on a real type", async () => {
    const script = "INSERT_UPDATE Product;code[unique=true];definitelyNotARealAttribute";
    const diags = await validateAgainstLive(script, cfg);
    const codes = diags.map((d) => d.code);
    expect(
      codes.includes(DiagnosticCode.UNKNOWN_ATTRIBUTE) ||
        codes.includes(DiagnosticCode.UNKNOWN_TYPE),
    ).toBe(true);
  }, 60_000);
});

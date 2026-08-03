import { describe, it, expect } from "vitest";
import { ImpexValidator } from "../src/index.js";
import {
  validate,
  splitRespectingQuotes,
  DiagnosticCode,
  type TypeModel,
} from "../src/impex.js";

/** Convenience: collect the set of diagnostic codes produced for a script. */
function codes(script: string, model?: TypeModel): string[] {
  return validate(script, model).map((d) => d.code);
}

describe("ImpexValidator facade", () => {
  const subject = new ImpexValidator();

  it("describes itself", () => {
    expect(subject.describe().startsWith("impex-lsp")).toBe(true);
  });

  it("accepts a valid non-blank script and rejects blanks", () => {
    expect(subject.accepts("INSERT_UPDATE Product;code[unique=true]\n;PROD-1")).toBe(true);
    expect(subject.accepts(" ")).toBe(false);
    expect(subject.accepts(null)).toBe(false);
  });

  it("isValid tracks error-severity diagnostics only", () => {
    // warning-only script (undefined macro) is still valid
    expect(subject.isValid("INSERT_UPDATE Product;code\n;$missing")).toBe(true);
    // structural error makes it invalid
    expect(subject.isValid(";orphan value")).toBe(false);
  });
});

describe("splitRespectingQuotes", () => {
  it("splits on unquoted separators", () => {
    expect(splitRespectingQuotes(";a;b;c")).toEqual(["", "a", "b", "c"]);
  });

  it("ignores separators inside double quotes", () => {
    expect(splitRespectingQuotes(';"a;b";c')).toEqual(["", '"a;b"', "c"]);
  });

  it("treats doubled quotes as an escaped quote", () => {
    expect(splitRespectingQuotes('"he said ""hi"";still one"')).toEqual([
      '"he said ""hi"";still one"',
    ]);
  });
});

describe("clean script", () => {
  it("produces zero diagnostics", () => {
    const script = [
      "# a comment",
      "",
      "$catalogVersion=catalogversion(catalog(id[default=Default]),version[default=Staged])",
      "INSERT_UPDATE Product;code[unique=true];name[lang=en];$catalogVersion",
      ';PROD-1;"A product";',
      ';PROD-2;"Another; product";',
    ].join("\n");
    expect(validate(script)).toEqual([]);
  });
});

describe("structural diagnostics", () => {
  it("IMPEX_UNKNOWN_MODE for an unrecognized leading token", () => {
    expect(codes("FOOBAR Product;code")).toContain(DiagnosticCode.UNKNOWN_MODE);
  });

  it("IMPEX_HEADER_NO_TYPE for a mode with no type code", () => {
    expect(codes("INSERT_UPDATE ;code;name")).toContain(DiagnosticCode.HEADER_NO_TYPE);
  });

  it("IMPEX_HEADER_NO_COLUMNS for a header with a type but no columns", () => {
    expect(codes("INSERT_UPDATE Product")).toContain(DiagnosticCode.HEADER_NO_COLUMNS);
    expect(codes("INSERT_UPDATE Product;;")).toContain(DiagnosticCode.HEADER_NO_COLUMNS);
  });

  it("IMPEX_VALUE_BEFORE_HEADER for a value line before any header", () => {
    const diags = validate(";PROD-1;name");
    expect(diags[0].code).toBe(DiagnosticCode.VALUE_BEFORE_HEADER);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].line).toBe(1);
  });

  it("IMPEX_COLUMN_COUNT_MISMATCH when value fields differ from header columns", () => {
    const script = [
      "INSERT_UPDATE Product;code;name",
      ";PROD-1;too;many;fields",
    ].join("\n");
    const mismatch = validate(script).filter(
      (d) => d.code === DiagnosticCode.COLUMN_COUNT_MISMATCH,
    );
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].line).toBe(2);
  });

  it("does NOT flag a value line whose count matches (incl. leading empty field)", () => {
    const script = ["INSERT_UPDATE Product;code;name", ";PROD-1;A product"].join("\n");
    expect(codes(script)).not.toContain(DiagnosticCode.COLUMN_COUNT_MISMATCH);
  });

  it("does not miscount when a quoted value contains a semicolon", () => {
    const script = [
      "INSERT_UPDATE Product;code;name",
      ';PROD-1;"has;semicolon"',
    ].join("\n");
    expect(codes(script)).not.toContain(DiagnosticCode.COLUMN_COUNT_MISMATCH);
  });
});

describe("macro diagnostics", () => {
  it("IMPEX_UNKNOWN_MACRO warning for an undefined macro reference", () => {
    const diags = validate("INSERT_UPDATE Product;code;$undefinedMacro");
    const macro = diags.filter((d) => d.code === DiagnosticCode.UNKNOWN_MACRO);
    expect(macro).toHaveLength(1);
    expect(macro[0].severity).toBe("warning");
  });

  it("does not warn when the macro is defined anywhere in the script", () => {
    const script = [
      "INSERT_UPDATE Product;code;$catalogVersion",
      "$catalogVersion=catalogversion(...)",
    ].join("\n");
    expect(codes(script)).not.toContain(DiagnosticCode.UNKNOWN_MACRO);
  });
});

describe("TypeModel-driven diagnostics", () => {
  const model: TypeModel = {
    Product: new Set(["code", "name", "catalogVersion"]),
    Category: ["code", "name"],
  };

  it("IMPEX_UNKNOWN_TYPE (error) when the header type is absent from the model", () => {
    const diags = validate("INSERT_UPDATE Widget;code", model);
    const unknown = diags.filter((d) => d.code === DiagnosticCode.UNKNOWN_TYPE);
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe("error");
  });

  it("IMPEX_UNKNOWN_ATTRIBUTE (warning) for a column not on the type", () => {
    const diags = validate(
      "INSERT_UPDATE Product;code[unique=true];bogusAttr[lang=en]",
      model,
    );
    const attr = diags.filter((d) => d.code === DiagnosticCode.UNKNOWN_ATTRIBUTE);
    expect(attr).toHaveLength(1);
    expect(attr[0].severity).toBe("warning");
    expect(attr[0].message).toContain("bogusAttr");
  });

  it("accepts known attributes (modifiers stripped) and ignores macro columns", () => {
    const script = "INSERT_UPDATE Product;code[unique=true];name[lang=en];$catalogVersion";
    expect(codes(script, model)).not.toContain(DiagnosticCode.UNKNOWN_ATTRIBUTE);
    expect(codes(script, model)).not.toContain(DiagnosticCode.UNKNOWN_TYPE);
  });

  it("emits no type/attribute diagnostics when no model is supplied", () => {
    const script = "INSERT_UPDATE Widget;anything;goes";
    expect(codes(script)).not.toContain(DiagnosticCode.UNKNOWN_TYPE);
    expect(codes(script)).not.toContain(DiagnosticCode.UNKNOWN_ATTRIBUTE);
  });

  it("ImpexValidator can carry a default model", () => {
    const v = new ImpexValidator(model);
    expect(v.isValid("INSERT_UPDATE Widget;code")).toBe(false); // unknown type = error
    expect(v.isValid("INSERT_UPDATE Product;code;name")).toBe(true);
  });
});

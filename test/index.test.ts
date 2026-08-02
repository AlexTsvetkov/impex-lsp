import { describe, it, expect } from "vitest";
import { ImpexValidator } from "../src/index.js";

describe("ImpexValidator", () => {
  const subject = new ImpexValidator();

  it("describes itself", () => {
    expect(subject.describe().startsWith("impex-lsp")).toBe(true);
  });

  it("accepts non-blank input", () => {
    expect(subject.accepts("cart-123")).toBe(true);
    expect(subject.accepts(" ")).toBe(false);
    expect(subject.accepts(null)).toBe(false);
  });
});

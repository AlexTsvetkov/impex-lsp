/**
 * Statically validates an ImpEx document against a type-model snapshot and returns line-anchored diagnostics.
 *
 * This is the core abstraction of impex-lsp. The starter implementation is
 * intentionally minimal — a documented foundation that tests can exercise.
 */
export class ImpexValidator {
  /** Human-readable description of what this component does. */
  describe(): string {
    return "impex-lsp: An ImpEx language server, validator and test harness for SAP Commerce — autocomplete, static validation and CI linting for a runtime-only DSL.";
  }

  /** Placeholder primary operation — total and trivial so the scaffold is green. */
  accepts(input: string | null | undefined): boolean {
    return typeof input === "string" && input.trim().length > 0;
  }
}

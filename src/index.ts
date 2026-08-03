/**
 * impex-lsp public entry point.
 *
 * Re-exports the core static-analysis engine and exposes {@link ImpexValidator},
 * a small object-oriented facade over {@link validate} for callers who prefer a
 * stateful validator (e.g. one preconfigured with a {@link TypeModel}).
 */
import {
  validate,
  DiagnosticCode,
  splitRespectingQuotes,
  type ImpexDiagnostic,
  type ImpexSeverity,
  type TypeModel,
} from "./impex.js";

export {
  validate,
  DiagnosticCode,
  splitRespectingQuotes,
  type ImpexDiagnostic,
  type ImpexSeverity,
  type TypeModel,
};

/**
 * Statically validates an ImpEx document against a type-model snapshot and
 * returns line-anchored diagnostics.
 */
export class ImpexValidator {
  /** Optional default type model applied when none is passed to a method. */
  private readonly defaultModel?: TypeModel;

  constructor(defaultModel?: TypeModel) {
    this.defaultModel = defaultModel;
  }

  /** Human-readable description of what this component does. */
  describe(): string {
    return "impex-lsp: An ImpEx language server, validator and test harness for SAP Commerce — autocomplete, static validation and CI linting for a runtime-only DSL.";
  }

  /**
   * Statically validates an ImpEx script and returns all diagnostics.
   * Falls back to the model supplied to the constructor when none is given.
   */
  validate(script: string, model?: TypeModel): ImpexDiagnostic[] {
    return validate(script, model ?? this.defaultModel);
  }

  /** `true` iff the script produces no `error`-severity diagnostics. */
  isValid(script: string, model?: TypeModel): boolean {
    return !this.validate(script, model).some((d) => d.severity === "error");
  }

  /**
   * Cheap acceptance check: is the input a non-blank string that parses without
   * an error-severity diagnostic? Retained for backwards compatibility with the
   * original scaffold contract.
   */
  accepts(input: string | null | undefined): boolean {
    return typeof input === "string" && input.trim().length > 0 && this.isValid(input);
  }
}

/**
 * Core ImpEx static-analysis engine for impex-lsp.
 *
 * ImpEx is SAP Commerce's data-import DSL. It has no compile step — mistakes
 * only surface when the platform runs the script. This module parses an ImpEx
 * script line-by-line and reports structured, line-anchored diagnostics so that
 * problems can be caught in an editor or in CI before deploy.
 */

/**
 * A snapshot of the (subset of the) SAP Commerce type system relevant to a
 * script: a map of type code -> the attribute qualifiers allowed on that type.
 *
 * Values may be a `Set` or a plain array of qualifier strings; both are
 * accepted so callers can build a model however is convenient.
 */
export type TypeModel = Record<string, ReadonlySet<string> | readonly string[]>;

/** Diagnostic severity levels emitted by the validator. */
export type ImpexSeverity = "error" | "warning";

/** A single line-anchored finding produced by {@link validate}. */
export interface ImpexDiagnostic {
  /** 1-based line number the diagnostic refers to. */
  line: number;
  /** Optional 1-based column, where a meaningful position is known. */
  column?: number;
  /** `"error"` blocks validity; `"warning"` is advisory. */
  severity: ImpexSeverity;
  /** Stable machine-readable code, e.g. `"IMPEX_UNKNOWN_MODE"`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
}

/** Stable diagnostic codes. Exported so consumers can match without magic strings. */
export const DiagnosticCode = {
  UNKNOWN_MODE: "IMPEX_UNKNOWN_MODE",
  HEADER_NO_TYPE: "IMPEX_HEADER_NO_TYPE",
  HEADER_NO_COLUMNS: "IMPEX_HEADER_NO_COLUMNS",
  VALUE_BEFORE_HEADER: "IMPEX_VALUE_BEFORE_HEADER",
  COLUMN_COUNT_MISMATCH: "IMPEX_COLUMN_COUNT_MISMATCH",
  UNKNOWN_TYPE: "IMPEX_UNKNOWN_TYPE",
  UNKNOWN_ATTRIBUTE: "IMPEX_UNKNOWN_ATTRIBUTE",
  UNKNOWN_MACRO: "IMPEX_UNKNOWN_MACRO",
} as const;

/** The four ImpEx header mode keywords. */
const MODES: ReadonlySet<string> = new Set(["INSERT", "UPDATE", "INSERT_UPDATE", "REMOVE"]);

/** Matches a macro-definition line such as `$catalogVersion=catalogversion(...)`. */
const MACRO_DEF_RE = /^\s*(\$[A-Za-z_][\w.]*)\s*=/;

/** Matches a macro reference token such as `$catalogVersion`. */
const MACRO_REF_RE = /\$[A-Za-z_][\w]*/g;

/**
 * Splits a line on a separator while ignoring separators that appear inside a
 * double-quoted string. A doubled quote (`""`) is treated as an escaped quote
 * and does not toggle the quoting state — matching ImpEx's own escaping.
 */
export function splitRespectingQuotes(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Normalizes a TypeModel entry to a Set for membership checks. */
function asSet(value: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  return value instanceof Set ? value : new Set(value as readonly string[]);
}

/**
 * Extracts the bare attribute qualifier from a header column declaration by
 * stripping any `[...]` modifiers and surrounding whitespace.
 * `name[lang=en]` -> `name`.
 */
function columnQualifier(declaration: string): string {
  const bracket = declaration.indexOf("[");
  const base = bracket === -1 ? declaration : declaration.slice(0, bracket);
  return base.trim();
}

/** Tracks the active header while scanning value lines. */
interface HeaderContext {
  /** Number of `;`-separated cells in the header (mode+type cell included). */
  cellCount: number;
  /** 1-based line the header was declared on. */
  line: number;
}

/**
 * Statically validates an ImpEx script and returns diagnostics sorted by line.
 *
 * @param script The full ImpEx document.
 * @param model  Optional type-model snapshot enabling type/attribute checks.
 */
export function validate(script: string, model?: TypeModel): ImpexDiagnostic[] {
  const diagnostics: ImpexDiagnostic[] = [];
  const rawLines = script.split("\n");

  // --- Pass 1: collect every defined macro name so references can be resolved
  // regardless of definition order. -------------------------------------------
  const definedMacros = new Set<string>();
  for (const raw of rawLines) {
    const def = MACRO_DEF_RE.exec(raw.replace(/\r$/, ""));
    if (def) definedMacros.add(def[1]);
  }

  // --- Pass 2: line-by-line structural validation. ----------------------------
  let header: HeaderContext | undefined;

  rawLines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    // Blank lines and comments carry no structure.
    if (trimmed === "" || trimmed.startsWith("#")) {
      collectMacroRefs(line, lineNo, null, definedMacros, diagnostics);
      return;
    }

    // Macro definition line: record only, scan the RHS for references.
    const macroDef = MACRO_DEF_RE.exec(line);
    if (macroDef) {
      const eq = line.indexOf("=");
      collectMacroRefs(line, lineNo, eq + 1, definedMacros, diagnostics);
      return;
    }

    // Value line: starts (after leading whitespace) with the field separator.
    if (trimmed.startsWith(";")) {
      collectMacroRefs(line, lineNo, null, definedMacros, diagnostics);
      if (!header) {
        diagnostics.push({
          line: lineNo,
          column: 1,
          severity: "error",
          code: DiagnosticCode.VALUE_BEFORE_HEADER,
          message: "Value line appears before any header line.",
        });
        return;
      }
      const cells = splitRespectingQuotes(line);
      if (cells.length !== header.cellCount) {
        diagnostics.push({
          line: lineNo,
          severity: "error",
          code: DiagnosticCode.COLUMN_COUNT_MISMATCH,
          message: `Value line has ${cells.length - 1} field(s) but the header (line ${header.line}) declares ${header.cellCount - 1} column(s).`,
        });
      }
      return;
    }

    // Header candidate: first whitespace-delimited token should be a mode.
    const firstToken = trimmed.split(/\s+/, 1)[0];
    if (!MODES.has(firstToken)) {
      // Not a mode, not a value, not a macro, not a comment -> unknown.
      collectMacroRefs(line, lineNo, null, definedMacros, diagnostics);
      diagnostics.push({
        line: lineNo,
        column: 1,
        severity: "error",
        code: DiagnosticCode.UNKNOWN_MODE,
        message: `Line does not start with a valid ImpEx mode (INSERT, UPDATE, INSERT_UPDATE, REMOVE) or a value/macro/comment. Found "${firstToken}".`,
      });
      return;
    }

    // It is a header line. Parse it.
    collectMacroRefs(line, lineNo, null, definedMacros, diagnostics);
    const segments = splitRespectingQuotes(line);
    const headSegment = segments[0].trim();
    const headTokens = headSegment.split(/\s+/);
    const typeCode = headTokens.length > 1 ? columnQualifier(headTokens.slice(1).join(" ")) : "";

    // Establish header context regardless of the errors below so that value
    // lines can still be checked against the intended column count.
    header = { cellCount: segments.length, line: lineNo };

    if (typeCode === "") {
      diagnostics.push({
        line: lineNo,
        column: 1,
        severity: "error",
        code: DiagnosticCode.HEADER_NO_TYPE,
        message: `Header mode "${firstToken}" is missing a type code.`,
      });
    }

    const columnDecls = segments.slice(1);
    const hasColumns = columnDecls.some((c) => c.trim() !== "");
    if (!hasColumns) {
      diagnostics.push({
        line: lineNo,
        column: 1,
        severity: "error",
        code: DiagnosticCode.HEADER_NO_COLUMNS,
        message: `Header for type "${typeCode || firstToken}" declares no columns.`,
      });
    }

    // Type-model-driven checks (only when a model is supplied).
    if (model && typeCode !== "") {
      const allowed = asSet(model[typeCode]);
      if (allowed === undefined) {
        diagnostics.push({
          line: lineNo,
          column: 1,
          severity: "error",
          code: DiagnosticCode.UNKNOWN_TYPE,
          message: `Type "${typeCode}" is not present in the supplied type model.`,
        });
      } else {
        for (const decl of columnDecls) {
          const qualifier = columnQualifier(decl);
          if (qualifier === "" || qualifier.startsWith("$")) continue; // empty or macro column
          if (!allowed.has(qualifier)) {
            diagnostics.push({
              line: lineNo,
              severity: "warning",
              code: DiagnosticCode.UNKNOWN_ATTRIBUTE,
              message: `Attribute "${qualifier}" is not defined on type "${typeCode}".`,
            });
          }
        }
      }
    }
  });

  diagnostics.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
  return diagnostics;
}

/**
 * Scans a line (optionally only from `fromIndex` onward) for macro references
 * and emits a warning for any not present in `defined`. De-duplicated per
 * (line, macro name) to avoid noise.
 */
function collectMacroRefs(
  line: string,
  lineNo: number,
  fromIndex: number | null,
  defined: ReadonlySet<string>,
  out: ImpexDiagnostic[],
): void {
  const start = fromIndex ?? 0;
  const haystack = line.slice(start);
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  MACRO_REF_RE.lastIndex = 0;
  while ((match = MACRO_REF_RE.exec(haystack)) !== null) {
    const name = match[0];
    if (defined.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      line: lineNo,
      column: start + match.index + 1,
      severity: "warning",
      code: DiagnosticCode.UNKNOWN_MACRO,
      message: `Macro "${name}" is referenced but never defined.`,
    });
  }
}

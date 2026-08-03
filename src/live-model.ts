/**
 * Live Hybris type-model source for impex-lsp.
 *
 * The static validator ({@link validate}) checks an ImpEx script against a
 * {@link TypeModel} — a snapshot of `typeCode -> allowed attribute qualifiers`.
 * Normally that snapshot is hand-authored. This module builds it *live* from a
 * running SAP Commerce instance by driving the HAC (hybris administration
 * console) FlexibleSearch endpoint, so validation can run against the schema
 * that is actually deployed.
 *
 * Zero runtime dependencies: it uses Node's built-in global `fetch` plus a
 * `node:https` Agent (only to relax TLS verification for local self-signed
 * certificates when explicitly configured).
 *
 * Auth flow (HAC / Spring Security form login), verified against the
 * cloud-commerce-sample-setup:
 *   1. GET  /login                    -> scrape hidden `_csrf` input.
 *   2. POST /j_spring_security_check  -> form login, capturing JSESSIONID.
 *   3. GET  /                         -> read `<meta name="_csrf">` for the
 *                                        AJAX `X-CSRF-TOKEN` header.
 *   4. POST /console/flexsearch/execute with that header -> JSON results.
 */

import { Agent, request as httpsRequest } from "node:https";
import { validate, type ImpexDiagnostic, type TypeModel } from "./impex.js";

/**
 * A minimal response abstraction shared by both transports (global `fetch` and
 * the `node:https` fallback), exposing just what this module needs.
 */
interface HttpResponse {
  status: number;
  ok: boolean;
  /** Every `set-cookie` line from the response. */
  setCookies: string[];
  /** Case-insensitive single-header lookup (used for `location`). */
  header(name: string): string | null;
  text(): Promise<string>;
}

/** Connection settings for a live SAP Commerce / HAC instance. */
export interface HacConfig {
  /** Base URL of the running instance, e.g. `https://localhost:9002`. */
  baseUrl: string;
  /** HAC username (e.g. `admin`). */
  user: string;
  /** HAC password (e.g. `nimda`). */
  password: string;
  /** When `true`, TLS certificate verification is disabled (local self-signed). */
  insecureTls: boolean;
}

/**
 * Builds a {@link HacConfig} from environment variables:
 *   - `COMMERCE_BASE_URL`   (required to talk to a live instance)
 *   - `COMMERCE_USER`       (default `admin`)
 *   - `COMMERCE_PASSWORD`   (default `nimda`)
 *   - `COMMERCE_INSECURE_TLS` (`true`/`1`/`yes` enable insecure TLS)
 *
 * Returns `undefined` when `COMMERCE_BASE_URL` is not set, so callers can fall
 * back to offline behavior and keep CI green without a live instance.
 */
export function hacConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HacConfig | undefined {
  const baseUrl = env.COMMERCE_BASE_URL?.trim();
  if (!baseUrl) return undefined;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    user: env.COMMERCE_USER?.trim() || "admin",
    password: env.COMMERCE_PASSWORD ?? "nimda",
    insecureTls: /^(1|true|yes)$/i.test(env.COMMERCE_INSECURE_TLS?.trim() ?? ""),
  };
}

/** Shape of the JSON returned by `/console/flexsearch/execute`. */
export interface FlexResult {
  /** Column names, in result order (e.g. `["InternalCode"]`). */
  headers: string[];
  /** Row-major result cells; each row aligns with {@link headers}. */
  resultList: string[][];
  /** Number of rows the platform reports. */
  resultCount: number;
  /** Non-null when the query failed; the message should be surfaced. */
  exception: string | null;
}

/**
 * Minimal cookie jar: fetch does not persist cookies across calls, so we parse
 * `set-cookie` response headers ourselves and replay them on later requests.
 * Only the name=value pair is retained (attributes such as Path/HttpOnly are
 * irrelevant for replaying to the same origin).
 */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Records any cookies from a response's `set-cookie` header(s). */
  storeFromResponse(res: HttpResponse): void {
    for (const line of res.setCookies) {
      const pair = line.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /** Serializes stored cookies for a `Cookie` request header. */
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** `true` once at least one cookie has been captured. */
  get hasAny(): boolean {
    return this.cookies.size > 0;
  }
}

/** Escapes a single-quoted FlexibleSearch string literal. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Pure, network-free transform: turn a FlexibleSearch attribute-qualifier
 * result (a single column of qualifier strings) into the set of qualifiers.
 * Blank/duplicate entries are dropped. Factored out so it can be unit-tested
 * against canned JSON with no live instance.
 */
export function qualifiersFromFlexResult(result: FlexResult): Set<string> {
  const set = new Set<string>();
  for (const row of result.resultList) {
    const q = (row?.[0] ?? "").trim();
    if (q) set.add(q);
  }
  return set;
}

/**
 * Pure, network-free transform: assemble a {@link TypeModel} from a list of
 * `{ typeCode, attributes }` pairs (each `attributes` being one flexsearch
 * result of qualifiers). This is the "rows+headers -> TypeModel" logic and is
 * unit-tested directly against the canned JSON from the live contract.
 */
export function buildTypeModel(
  entries: ReadonlyArray<{ typeCode: string; attributes: FlexResult }>,
): TypeModel {
  const model: Record<string, ReadonlySet<string>> = {};
  for (const { typeCode, attributes } of entries) {
    const code = typeCode.trim();
    if (!code) continue;
    model[code] = qualifiersFromFlexResult(attributes);
  }
  return model;
}

/**
 * Drives a live HAC instance to read the SAP Commerce type system and produce a
 * {@link TypeModel} the validator can consume.
 */
export class HybrisTypeModelSource {
  private readonly jar = new CookieJar();
  private readonly agent?: Agent;
  private ajaxCsrf?: string;
  private loggedIn = false;

  constructor(private readonly cfg: HacConfig) {
    this.agent = cfg.insecureTls ? new Agent({ rejectUnauthorized: false }) : undefined;
  }

  /** Absolute URL for a root-relative path. */
  private url(path: string): string {
    return `${this.cfg.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  /**
   * Issues a single HTTP request, replaying stored cookies and never following
   * redirects (we handle those manually to preserve cookies on each hop).
   *
   * Transport selection: global `fetch` (undici) does not accept a `node:https`
   * Agent, so when insecure TLS is requested we route through `node:https`
   * with a `rejectUnauthorized:false` Agent — both are Node built-ins, zero
   * dependencies. Otherwise we use the built-in global `fetch`.
   */
  private async httpRequest(
    url: string,
    opts: { method: string; body?: string; headers?: Record<string, string> },
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.jar.hasAny) headers["cookie"] = this.jar.header();

    if (this.agent) {
      return this.requestViaHttps(url, { ...opts, headers });
    }
    return this.requestViaFetch(url, { ...opts, headers });
  }

  /** Global-fetch transport (used when TLS verification is on). */
  private async requestViaFetch(
    url: string,
    opts: { method: string; body?: string; headers: Record<string, string> },
  ): Promise<HttpResponse> {
    const res = await fetch(url, {
      method: opts.method,
      body: opts.body,
      headers: opts.headers,
      redirect: "manual",
    });
    const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies =
      typeof getSetCookie === "function"
        ? getSetCookie.call(res.headers)
        : (() => {
            const s = res.headers.get("set-cookie");
            return s ? [s] : [];
          })();
    return {
      status: res.status,
      ok: res.ok,
      setCookies,
      header: (n) => res.headers.get(n),
      text: () => res.text(),
    };
  }

  /** node:https transport (used for the insecure-TLS local-dev case). */
  private requestViaHttps(
    url: string,
    opts: { method: string; body?: string; headers: Record<string, string> },
  ): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const u = new URL(url);
      const headers = { ...opts.headers };
      if (opts.body !== undefined) {
        headers["content-length"] = String(Buffer.byteLength(opts.body));
      }
      const req = httpsRequest(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: `${u.pathname}${u.search}`,
          method: opts.method,
          headers,
          agent: this.agent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const bodyText = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            const rawCookies = res.headers["set-cookie"];
            resolve({
              status,
              ok: status >= 200 && status < 300,
              setCookies: Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [],
              header: (name) => {
                const v = res.headers[name.toLowerCase()];
                return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
              },
              text: async () => bodyText,
            });
          });
        },
      );
      req.on("error", reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  }

  /**
   * Performs the full form-login handshake and captures the AJAX CSRF token.
   * Safe to call more than once; subsequent calls are no-ops once logged in.
   */
  async login(): Promise<void> {
    if (this.loggedIn) return;

    // 1. GET /login and scrape the hidden `_csrf` input value.
    const loginRes = await this.httpRequest(this.url("/login"), { method: "GET" });
    this.jar.storeFromResponse(loginRes);
    const loginHtml = await loginRes.text();
    const formCsrf = extractInputCsrf(loginHtml);
    if (!formCsrf) {
      throw new Error(`Could not find _csrf token on /login (status ${loginRes.status}).`);
    }

    // 2. POST credentials to Spring Security. Follow the redirect chain
    //    manually so cookies set on each hop are preserved.
    const body = new URLSearchParams({
      j_username: this.cfg.user,
      j_password: this.cfg.password,
      _csrf: formCsrf,
    }).toString();
    await this.followManualRedirects(this.url("/j_spring_security_check"), {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    // 3. GET / and read the AJAX CSRF token from the meta tag.
    const rootRes = await this.httpRequest(this.url("/"), { method: "GET" });
    this.jar.storeFromResponse(rootRes);
    const rootHtml = await rootRes.text();
    const metaCsrf = extractMetaCsrf(rootHtml);
    if (!metaCsrf) {
      throw new Error("Login appears to have failed: no <meta name=\"_csrf\"> on '/'.");
    }
    this.ajaxCsrf = metaCsrf;
    this.loggedIn = true;
  }

  /** Follows up to a handful of manual redirects, storing cookies on each hop. */
  private async followManualRedirects(
    url: string,
    opts: { method: string; body?: string; headers?: Record<string, string> },
    max = 5,
  ): Promise<HttpResponse> {
    let current = url;
    let res = await this.httpRequest(current, opts);
    this.jar.storeFromResponse(res);
    let hops = 0;
    while (res.status >= 300 && res.status < 400 && hops < max) {
      const loc = res.header("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      res = await this.httpRequest(current, { method: "GET" });
      this.jar.storeFromResponse(res);
      hops++;
    }
    return res;
  }

  /**
   * Executes a FlexibleSearch query and returns the parsed JSON. Requires a
   * prior {@link login}. Surfaces platform-side errors via {@link FlexResult.exception}.
   */
  async flex(query: string, maxCount = 1000): Promise<FlexResult> {
    if (!this.ajaxCsrf) {
      throw new Error("flex() called before login(); no CSRF token available.");
    }
    const body = new URLSearchParams({
      flexibleSearchQuery: query,
      maxCount: String(maxCount),
      user: this.cfg.user,
      locale: "en",
      dataSource: "master",
      commit: "false",
    }).toString();
    const res = await this.httpRequest(this.url("/console/flexsearch/execute"), {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "X-CSRF-TOKEN": this.ajaxCsrf,
        accept: "application/json",
      },
    });
    this.jar.storeFromResponse(res);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`FlexibleSearch HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let json: Partial<FlexResult>;
    try {
      json = JSON.parse(text) as Partial<FlexResult>;
    } catch {
      throw new Error(`FlexibleSearch returned non-JSON: ${text.slice(0, 200)}`);
    }
    return {
      headers: json.headers ?? [],
      resultList: json.resultList ?? [],
      resultCount: json.resultCount ?? 0,
      exception: json.exception ?? null,
    };
  }

  /**
   * Reads attribute qualifiers for a single ComposedType via a joined
   * FlexibleSearch query (verified against the live instance).
   */
  async fetchTypeAttributes(typeCode: string, maxCount = 5000): Promise<Set<string>> {
    const query =
      "SELECT {ad:qualifier} FROM {AttributeDescriptor AS ad " +
      "JOIN ComposedType AS ct ON {ad:enclosingType}={ct:pk}} " +
      `WHERE {ct:code}=${sqlLiteral(typeCode)}`;
    const result = await this.flex(query, maxCount);
    if (result.exception) {
      throw new Error(`FlexibleSearch error for type "${typeCode}": ${result.exception}`);
    }
    return qualifiersFromFlexResult(result);
  }

  /**
   * Lists ComposedType codes. When `only` is provided the query is narrowed to
   * that set (so we don't scan the whole type system unnecessarily).
   */
  async fetchTypeCodes(only?: readonly string[], maxCount = 20000): Promise<string[]> {
    let query = "SELECT {code} FROM {ComposedType}";
    if (only && only.length > 0) {
      const inList = only.map(sqlLiteral).join(",");
      query += ` WHERE {code} IN (${inList})`;
    }
    const result = await this.flex(query, maxCount);
    if (result.exception) {
      throw new Error(`FlexibleSearch error listing ComposedType codes: ${result.exception}`);
    }
    return result.resultList.map((r) => (r?.[0] ?? "").trim()).filter((c) => c !== "");
  }

  /**
   * Builds a {@link TypeModel} from the live instance.
   *
   * @param typeCodes Optional whitelist of type codes to include. When omitted,
   *   every ComposedType is fetched (which can be large — prefer passing the
   *   handful of types your script actually references).
   */
  async fetchTypeModel(typeCodes?: readonly string[]): Promise<TypeModel> {
    await this.login();
    const codes = await this.fetchTypeCodes(typeCodes);
    const entries: Array<{ typeCode: string; attributes: FlexResult }> = [];
    for (const code of codes) {
      const attributes = await this.fetchAttributeResult(code);
      entries.push({ typeCode: code, attributes });
    }
    return buildTypeModel(entries);
  }

  /** Internal: run the attribute query and return the raw FlexResult. */
  private async fetchAttributeResult(typeCode: string, maxCount = 5000): Promise<FlexResult> {
    const query =
      "SELECT {ad:qualifier} FROM {AttributeDescriptor AS ad " +
      "JOIN ComposedType AS ct ON {ad:enclosingType}={ct:pk}} " +
      `WHERE {ct:code}=${sqlLiteral(typeCode)}`;
    const result = await this.flex(query, maxCount);
    if (result.exception) {
      throw new Error(`FlexibleSearch error for type "${typeCode}": ${result.exception}`);
    }
    return result;
  }
}

/** Extracts the hidden `_csrf` input value from the /login HTML. */
export function extractInputCsrf(html: string): string | undefined {
  // Handles both attribute orderings: name-then-value and value-then-name.
  const nameFirst = /name="_csrf"[^>]*\bvalue="([^"]*)"/i.exec(html);
  if (nameFirst) return nameFirst[1];
  const valueFirst = /\bvalue="([^"]*)"[^>]*name="_csrf"/i.exec(html);
  return valueFirst?.[1];
}

/** Extracts the `<meta name="_csrf" content="...">` token from authed HTML. */
export function extractMetaCsrf(html: string): string | undefined {
  const m = /<meta\s+name="_csrf"\s+content="([^"]*)"/i.exec(html);
  return m?.[1];
}

/**
 * Convenience: fetch a live {@link TypeModel} and validate a script against it
 * in one call. Configuration falls back to {@link hacConfigFromEnv} when `cfg`
 * is omitted; throws if neither a config nor `COMMERCE_BASE_URL` is available.
 */
export async function validateAgainstLive(
  script: string,
  cfg?: HacConfig,
): Promise<ImpexDiagnostic[]> {
  const resolved = cfg ?? hacConfigFromEnv();
  if (!resolved) {
    throw new Error(
      "validateAgainstLive: no HacConfig provided and COMMERCE_BASE_URL is not set.",
    );
  }
  const source = new HybrisTypeModelSource(resolved);
  const typeCodes = extractReferencedTypeCodes(script);
  const model = await source.fetchTypeModel(typeCodes.length > 0 ? typeCodes : undefined);
  return validate(script, model);
}

/**
 * Best-effort scan of an ImpEx script for the ComposedType codes it references
 * (the token following each header mode). Used to narrow the live fetch to just
 * the relevant types. Returns a de-duplicated list.
 */
export function extractReferencedTypeCodes(script: string): string[] {
  const modes = /^(INSERT_UPDATE|INSERT|UPDATE|REMOVE)\b/;
  const found = new Set<string>();
  for (const raw of script.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    const m = modes.exec(line);
    if (!m) continue;
    const rest = line.slice(m[0].length).trim();
    // Type code is the first token before ';' or whitespace; strip [modifiers].
    const cell = rest.split(";", 1)[0].trim();
    const code = cell.split(/\s+/, 1)[0].split("[", 1)[0].trim();
    if (code) found.add(code);
  }
  return [...found];
}

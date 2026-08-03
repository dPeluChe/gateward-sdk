import { GatewardError } from "./errors.js";
import type { FetchLike } from "./types.js";

/** Observability callbacks fired around each request. All optional; a throw
 *  inside a hook is swallowed so instrumentation can't break requests. */
export interface RequestHooks {
  onRequest?: (info: { method: string; path: string }) => void;
  onResponse?: (info: { method: string; path: string; status: number }) => void;
  onError?: (info: {
    method: string;
    path: string;
    error: GatewardError;
  }) => void;
  onRetry?: (info: {
    method: string;
    path: string;
    /** 1-based attempt number about to be made. */
    attempt: number;
    delayMs: number;
    /** Status that triggered the retry (0 = network error). */
    status: number;
  }) => void;
}

/** Automatic retry policy. Retries are idempotency-aware: a 429 is retried
 *  for any method (the server rejected it before processing), but network
 *  failures and 502/503/504 are retried ONLY for idempotent methods
 *  (GET/HEAD/OPTIONS/DELETE/PUT) — never POST/PATCH, which could double-run. */
export interface RetryOptions {
  /** Max retries after the first attempt (default 2). */
  maxRetries?: number;
  /** Base backoff in ms; grows exponentially with jitter (default 200). */
  baseDelayMs?: number;
  /** Upper bound per wait, also caps `Retry-After` (default 2000). */
  maxDelayMs?: number;
}

interface ResolvedRetry {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface HttpClientOptions {
  /** Base URL of the Core, e.g. `https://gateward.fondor.space`. */
  baseUrl: string;
  /** App id sent as `X-Gateward-App-Id` on every request when set. */
  appId?: string;
  /** Stable device id sent as `X-Gateward-Device-Id` when set. */
  deviceId?: string;
  /** IANA timezone sent as `X-Gateward-Timezone` when set. */
  timezone?: string;
  /** Observability hooks (onRequest/onResponse/onError/onRetry). */
  hooks?: RequestHooks;
  /** Automatic retry. `false`/omitted = no retries; `true` = defaults. */
  retry?: RetryOptions | boolean;
  /** Custom fetch (tests, non-global-fetch runtimes). Defaults to `fetch`. */
  fetch?: FetchLike;
}

export interface RequestOptions {
  /** JSON body; serialized and sent with `Content-Type: application/json`. */
  body?: unknown;
  /** `Authorization: Bearer <token>`. */
  bearer?: string;
  /** `X-API-Key` for service-to-service calls. */
  apiKey?: string;
  /** Query params; `undefined`/`null` values are dropped, others stringified. */
  query?: Record<string, unknown>;
  /** Extra headers, merged last. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Thin, reusable fetch wrapper shared by every Gateward client: builds
 *  URLs + headers, serializes/parses JSON, and maps non-2xx to
 *  {@link GatewardError}. Holds no auth state of its own. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly appId: string | undefined;
  private readonly deviceId: string | undefined;
  private readonly timezone: string | undefined;
  private readonly hooks: RequestHooks | undefined;
  private readonly retry: ResolvedRetry;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.appId = opts.appId;
    this.deviceId = opts.deviceId;
    this.timezone = opts.timezone;
    this.hooks = opts.hooks;
    this.retry = resolveRetry(opts.retry);
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        "No fetch available — pass `fetch` in the client options.",
      );
    }
  }

  async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    return (await this.requestWithMeta<T>(method, path, opts)).data;
  }

  /** Like {@link request} but also surfaces `X-Total-Count`, which the Core
   *  sets on every paginated list. */
  async requestWithMeta<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<{ data: T; totalCount: number | undefined }> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.appId) headers["X-Gateward-App-Id"] = this.appId;
    if (this.deviceId) headers["X-Gateward-Device-Id"] = this.deviceId;
    if (this.timezone) headers["X-Gateward-Timezone"] = this.timezone;
    if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
    if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, opts.headers);

    const init: RequestInit = {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    const idempotent = IDEMPOTENT_METHODS.has(method.toUpperCase());

    for (let attempt = 0; ; attempt++) {
      this.fire(this.hooks?.onRequest, { method, path });

      let res: Response | undefined;
      let cause: unknown;
      try {
        res = await this.fetchImpl(url.toString(), init);
      } catch (e) {
        cause = e;
      }

      // Network failure (status 0): retry only idempotent methods.
      if (!res) {
        if (this.canRetry(0, idempotent, attempt)) {
          await this.waitBeforeRetry(method, path, attempt, 0, null, opts.signal);
          continue;
        }
        const error = new GatewardError(
          `network error calling ${method} ${path}: ${String(cause)}`,
          0,
        );
        this.fire(this.hooks?.onError, { method, path, error });
        throw error;
      }

      const parsed = await parseBody(res);
      if (!res.ok) {
        if (this.canRetry(res.status, idempotent, attempt)) {
          await this.waitBeforeRetry(
            method,
            path,
            attempt,
            res.status,
            res.headers.get("retry-after"),
            opts.signal,
          );
          continue;
        }
        const error = new GatewardError(
          errorMessage(res.status, parsed),
          res.status,
          parsed,
        );
        this.fire(this.hooks?.onError, { method, path, error });
        throw error;
      }
      this.fire(this.hooks?.onResponse, { method, path, status: res.status });
      return { data: parsed as T, totalCount: totalCountOf(res) };
    }
  }

  /** Idempotency-aware: 429 retries for any method (not processed); network
   *  errors and 502/503/504 retry only for idempotent methods. */
  private canRetry(status: number, idempotent: boolean, attempt: number): boolean {
    if (attempt >= this.retry.maxRetries) return false;
    if (status === 429) return true;
    return idempotent && (status === 0 || GATEWAY_STATUS.has(status));
  }

  private async waitBeforeRetry(
    method: string,
    path: string,
    attempt: number,
    status: number,
    retryAfter: string | null,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const delayMs = this.retryDelay(attempt, retryAfter);
    this.fire(this.hooks?.onRetry, {
      method,
      path,
      attempt: attempt + 1,
      delayMs,
      status,
    });
    await sleep(delayMs, signal);
  }

  private retryDelay(attempt: number, retryAfter: string | null): number {
    const ra = parseRetryAfter(retryAfter);
    if (ra !== undefined) return Math.min(ra, this.retry.maxDelayMs);
    const exp = Math.min(
      this.retry.maxDelayMs,
      this.retry.baseDelayMs * 2 ** attempt,
    );
    return exp + Math.random() * this.retry.baseDelayMs;
  }

  /** Run a hook, swallowing any error so instrumentation can't break I/O. */
  private fire<A>(hook: ((arg: A) => void) | undefined, arg: A): void {
    if (!hook) return;
    try {
      hook(arg);
    } catch {
      /* observability must never affect the request */
    }
  }
}

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "DELETE", "PUT"]);
const GATEWAY_STATUS = new Set([502, 503, 504]);

function resolveRetry(retry: RetryOptions | boolean | undefined): ResolvedRetry {
  const on = retry === true || (typeof retry === "object" && retry !== null);
  const o = typeof retry === "object" && retry !== null ? retry : {};
  return {
    maxRetries: on ? (o.maxRetries ?? 2) : 0,
    baseDelayMs: o.baseDelayMs ?? 200,
    maxDelayMs: o.maxDelayMs ?? 2000,
  };
}

/** Retry-After in seconds → ms. HTTP-date form is ignored (fall to backoff). */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  const e = new Error("request aborted");
  e.name = "AbortError";
  return e;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function totalCountOf(res: Response): number | undefined {
  const raw = res.headers.get("x-total-count");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    return `Gateward ${status}: ${String((body as { error: unknown }).error)}`;
  }
  if (typeof body === "string" && body) return `Gateward ${status}: ${body}`;
  return `Gateward request failed with status ${status}`;
}

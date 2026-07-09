import { GatewardError } from "./errors.js";
import type { FetchLike } from "./types.js";

export interface HttpClientOptions {
  /** Base URL of the Core, e.g. `https://gateward.fondor.space`. */
  baseUrl: string;
  /** App id sent as `X-Gateward-App-Id` on every request when set. */
  appId?: string;
  /** Stable device id sent as `X-Gateward-Device-Id` when set. */
  deviceId?: string;
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
  /** Query params; `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | undefined | null>;
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
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.appId = opts.appId;
    this.deviceId = opts.deviceId;
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
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.appId) headers["X-Gateward-App-Id"] = this.appId;
    if (this.deviceId) headers["X-Gateward-Device-Id"] = this.deviceId;
    if (opts.bearer) headers["Authorization"] = `Bearer ${opts.bearer}`;
    if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, opts.headers);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        ...(opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (cause) {
      throw new GatewardError(
        `network error calling ${method} ${path}: ${String(cause)}`,
        0,
      );
    }

    const parsed = await parseBody(res);
    if (!res.ok) {
      throw new GatewardError(
        errorMessage(res.status, parsed),
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }
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

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    return `Gateward ${status}: ${String((body as { error: unknown }).error)}`;
  }
  if (typeof body === "string" && body) return `Gateward ${status}: ${body}`;
  return `Gateward request failed with status ${status}`;
}

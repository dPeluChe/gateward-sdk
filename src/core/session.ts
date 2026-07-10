import { HttpClient } from "./http.js";
import { GatewardError } from "./errors.js";
import { MemoryStorage, type TokenStorage, type TokenSet } from "./storage.js";
import { decodeClaims } from "../jwt/verify.js";
import type { TokenResponse } from "./types.js";

export interface SessionOptions {
  /** Token persistence (default {@link MemoryStorage}). */
  storage?: TokenStorage;
  /** Refresh this many seconds before the access token expires (default 30). */
  refreshSkewSec?: number;
}

/** Shared token lifecycle for every authenticated client: persistence,
 *  single-flight automatic refresh (`/v1/auth/refresh` is app-agnostic),
 *  logout, and a 401-retrying authed request. Subclasses add their own
 *  login method (app login vs platform login) and any scoped helpers. */
export abstract class AuthSession {
  protected readonly http: HttpClient;
  private readonly storage: TokenStorage;
  private readonly refreshSkewSec: number;
  /** Single-flight guard so concurrent calls trigger at most one refresh. */
  private refreshInFlight: Promise<TokenSet> | null = null;

  protected constructor(http: HttpClient, opts: SessionOptions = {}) {
    this.http = http;
    this.storage = opts.storage ?? new MemoryStorage();
    this.refreshSkewSec = opts.refreshSkewSec ?? 30;
  }

  /** Revoke the current session server-side and clear stored tokens. Clears
   *  locally even if the server call fails (best-effort logout). */
  async logout(): Promise<void> {
    const current = await this.storage.get();
    try {
      if (current) {
        await this.http.request<void>("POST", "/v1/auth/logout", {
          bearer: current.accessToken,
        });
      }
    } catch {
      // Best-effort: a failed server call still clears the local session.
    } finally {
      await this.storage.clear();
    }
  }

  /** Force a refresh using the stored refresh token, rotating both tokens. */
  refresh(): Promise<TokenSet> {
    return this.runRefresh();
  }

  /** A valid access token, refreshing first if it is missing/near expiry.
   *  Throws {@link GatewardError} (401) when there is no session. */
  async getAccessToken(): Promise<string> {
    const current = await this.storage.get();
    if (!current) {
      throw new GatewardError("not authenticated — log in first", 401);
    }
    if (this.isExpiring(current)) {
      return (await this.runRefresh()).accessToken;
    }
    return current.accessToken;
  }

  /** Fetch against the Core with the current bearer token, auto-refreshing
   *  once on a 401. Reusable for any endpoint the session is scoped to. */
  async authedRequest<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    try {
      return await this.http.request<T>(method, path, { ...opts, bearer: token });
    } catch (err) {
      if (err instanceof GatewardError && err.status === 401) {
        const refreshed = await this.runRefresh();
        return this.http.request<T>(method, path, {
          ...opts,
          bearer: refreshed.accessToken,
        });
      }
      throw err;
    }
  }

  /** Persist a fresh token pair (called by subclass login methods). */
  protected async persist(tokens: TokenResponse): Promise<TokenSet> {
    const set: TokenSet = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiryOf(tokens),
    };
    await this.storage.set(set);
    return set;
  }

  private isExpiring(tokens: TokenSet): boolean {
    const now = Math.floor(Date.now() / 1000);
    return tokens.expiresAt - now <= this.refreshSkewSec;
  }

  private runRefresh(): Promise<TokenSet> {
    // Coalesce concurrent refreshes onto one in-flight request.
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<TokenSet> {
    const current = await this.storage.get();
    if (!current) {
      throw new GatewardError("not authenticated — log in first", 401);
    }
    let tokens: TokenResponse;
    try {
      tokens = await this.http.request<TokenResponse>("POST", "/v1/auth/refresh", {
        body: { refresh_token: current.refreshToken },
      });
    } catch (err) {
      // A dead/rotated refresh token means the session is gone — drop it so
      // the app can re-auth instead of looping on a doomed token.
      if (err instanceof GatewardError && err.status === 401) {
        await this.storage.clear();
      }
      throw err;
    }
    return this.persist(tokens);
  }
}

/** Prefer the token's own `exp`; fall back to `expires_in` from the body. */
function expiryOf(tokens: TokenResponse): number {
  try {
    const { exp } = decodeClaims(tokens.access_token);
    if (typeof exp === "number") return exp;
  } catch {
    /* not a decodable JWT — fall through */
  }
  return Math.floor(Date.now() / 1000) + tokens.expires_in;
}

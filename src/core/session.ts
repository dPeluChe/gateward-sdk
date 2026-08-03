import { HttpClient } from "./http.js";
import { createAuthedFetch, type AuthedFetchOptions } from "./authed-fetch.js";
import { GatewardError } from "./errors.js";
import {
  AuthStateEmitter,
  type AuthEvent,
  type AuthStateListener,
} from "./events.js";
import { MemoryStorage, type TokenStorage, type TokenSet } from "./storage.js";
import { decodeClaims } from "../jwt/verify.js";
import type {
  FetchLike,
  GatewardClaims,
  GatewardUser,
  TokenResponse,
} from "./types.js";

export interface SessionOptions {
  /** Token persistence (default {@link MemoryStorage}). */
  storage?: TokenStorage;
  /** Refresh this many seconds before the access token expires (default 30). */
  refreshSkewSec?: number;
  /** Follow sign-in/out from other tabs when the storage supports it
   *  (default `true`). */
  syncTabs?: boolean;
}

/** Shared token lifecycle for every authenticated client: persistence,
 *  single-flight refresh, logout, and a 401-retrying authed request.
 *  Design notes in docs/ARCHITECTURE/SESSION.md. */
export abstract class AuthSession {
  protected readonly http: HttpClient;
  private readonly storage: TokenStorage;
  private readonly refreshSkewSec: number;
  /** Single-flight guard so concurrent calls trigger at most one refresh. */
  private refreshInFlight: Promise<TokenSet> | null = null;
  private readonly emitter = new AuthStateEmitter();
  private cachedUser: GatewardUser | null = null;
  private userInFlight: Promise<GatewardUser> | null = null;

  private unsubscribeStorage: (() => void) | null = null;

  protected constructor(http: HttpClient, opts: SessionOptions = {}) {
    this.http = http;
    this.storage = opts.storage ?? new MemoryStorage();
    this.refreshSkewSec = opts.refreshSkewSec ?? 30;
    if (opts.syncTabs !== false) this.watchOtherTabs();
  }

  /** Stop following other tabs. Only needed if the client outlives its use. */
  dispose(): void {
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = null;
  }

  private watchOtherTabs(): void {
    this.unsubscribeStorage =
      this.storage.subscribe?.((tokens, previous) => {
        this.cachedUser = null;
        if (!tokens) {
          this.emitter.emit({ event: "signed_out", tokens: null });
        } else if (!previous) {
          this.emitter.emit({ event: "signed_in", tokens });
        } else if (tokens.refreshToken !== previous.refreshToken) {
          this.emitter.emit({ event: "token_refreshed", tokens });
        }
      }) ?? null;
  }

  /** Subscribe to session transitions; returns an unsubscribe. Bind forced
   *  logout to `session_expired`. */
  onAuthStateChange(listener: AuthStateListener): () => void {
    return this.emitter.subscribe(listener);
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
      this.forget("signed_out");
    }
  }

  /** The caller's identity (`GET /v1/auth/me`). Cached for the session;
   *  `{ force: true }` refetches. Concurrent calls share one request. */
  async getUser(opts: { force?: boolean } = {}): Promise<GatewardUser> {
    if (!opts.force && this.cachedUser) return this.cachedUser;
    if (!opts.force && this.userInFlight) return this.userInFlight;

    this.userInFlight = this.authedRequest<GatewardUser>("GET", "/v1/auth/me")
      .then((user) => {
        this.cachedUser = user;
        return user;
      })
      .finally(() => {
        this.userInFlight = null;
      });
    return this.userInFlight;
  }

  /** A `fetch` bound to this session, for calling your own API. Scope it with
   *  `{ origins }` unless it only ever reaches your backend. */
  createFetch(opts: AuthedFetchOptions = {}): FetchLike {
    return createAuthedFetch(this, opts);
  }

  /** Shallow-merge into the caller's own profile metadata (`PATCH
   *  /v1/auth/me`, scope `users:write_own`). Refreshes the cached user. */
  async updateProfile(
    metadata: Record<string, unknown>,
  ): Promise<GatewardUser> {
    const user = await this.authedRequest<GatewardUser>(
      "PATCH",
      "/v1/auth/me",
      { body: { metadata } },
    );
    this.cachedUser = user;
    return user;
  }

  /** Drop the local session as if the server had ended it. */
  protected async forgetLocalSession(): Promise<void> {
    await this.storage.clear();
    this.forget("signed_out");
  }

  /** Claims of the current access token, decoded locally. NOT verified — UI
   *  hints only; a backend uses `GatewardServer.verifyToken`. */
  async getClaims(): Promise<GatewardClaims> {
    return decodeClaims(await this.getAccessToken());
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
  protected async persist(
    tokens: TokenResponse,
    event: AuthEvent = "signed_in",
  ): Promise<TokenSet> {
    const set: TokenSet = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiryOf(tokens),
    };
    await this.storage.set(set);
    // A login can be a different user; a refresh never is.
    if (event !== "token_refreshed") this.cachedUser = null;
    this.emitter.emit({ event, tokens: set });
    return set;
  }

  private forget(event: Extract<AuthEvent, "signed_out" | "session_expired">) {
    this.cachedUser = null;
    this.emitter.emit({ event, tokens: null });
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
      // Dead refresh token: drop the session and say so, or the UI keeps
      // rendering an authenticated shell over nothing.
      if (err instanceof GatewardError && err.status === 401) {
        await this.storage.clear();
        this.forget("session_expired");
      }
      throw err;
    }
    return this.persist(tokens, "token_refreshed");
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

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
  private readonly emitter = new AuthStateEmitter();
  /** Identity is stable for the life of a session, so `/v1/auth/me` is worth
   *  caching — cleared whenever the session itself changes. */
  private cachedUser: GatewardUser | null = null;
  private userInFlight: Promise<GatewardUser> | null = null;

  protected constructor(http: HttpClient, opts: SessionOptions = {}) {
    this.http = http;
    this.storage = opts.storage ?? new MemoryStorage();
    this.refreshSkewSec = opts.refreshSkewSec ?? 30;
  }

  /** Subscribe to session transitions (`signed_in`, `token_refreshed`,
   *  `signed_out`, `session_expired`). Returns an unsubscribe function.
   *
   *  `session_expired` is what an app binds its forced-logout path to: the
   *  refresh token died server-side, so the local session is already gone by
   *  the time the listener runs. */
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

  /** The caller's identity (`GET /v1/auth/me`) — `{id, email, role, metadata}`.
   *  Cached for the session; pass `{ force: true }` after writing metadata.
   *  Concurrent calls share one request. */
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

  /** A `fetch` bound to this session for calling **your own** API: attaches
   *  the bearer, refreshes when the token is near expiry, retries once on a
   *  401. Pass it to any client that takes a `fetch`.
   *
   *  Scope it with `{ origins: [...] }` if the same fetch also reaches third
   *  parties — otherwise you'd send them your access token. */
  createFetch(opts: AuthedFetchOptions = {}): FetchLike {
    return createAuthedFetch(this, opts);
  }

  /** Claims of the current access token, decoded locally (no round-trip).
   *  Refreshes first if the token is near expiry.
   *
   *  These are NOT verified — the token came from this client's own storage,
   *  so they are only safe as UI hints. A backend must verify a token it
   *  received with `GatewardServer.verifyToken`. */
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
    // A refresh rotates tokens for the same identity; a login can be a
    // different user entirely, so only that invalidates the cached user.
    if (event !== "token_refreshed") this.cachedUser = null;
    this.emitter.emit({ event, tokens: set });
    return set;
  }

  /** Drop every trace of the session locally and announce it. */
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
      // A dead/rotated refresh token means the session is gone — drop it so
      // the app can re-auth instead of looping on a doomed token, and tell
      // subscribers, or the UI keeps rendering an authenticated shell over a
      // session that no longer exists.
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

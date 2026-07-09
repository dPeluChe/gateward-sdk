/** Persisted access + refresh token pair. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token expires (from its `exp` claim). */
  expiresAt: number;
}

/** Pluggable persistence for the auth token pair. Sync or async. */
export interface TokenStorage {
  get(): TokenSet | null | Promise<TokenSet | null>;
  set(tokens: TokenSet): void | Promise<void>;
  clear(): void | Promise<void>;
}

/** Default in-memory storage — fine for servers and tests; a browser app
 *  that must survive reloads should pass {@link createWebStorage}. */
export class MemoryStorage implements TokenStorage {
  private tokens: TokenSet | null = null;
  get(): TokenSet | null {
    return this.tokens;
  }
  set(tokens: TokenSet): void {
    this.tokens = tokens;
  }
  clear(): void {
    this.tokens = null;
  }
}

/** Backs the token set with a Web Storage area (localStorage by default).
 *  Throws if no Web Storage is available in the current runtime. */
export function createWebStorage(
  key = "gateward.tokens",
  area?: Storage,
): TokenStorage {
  const store = area ?? globalThis.localStorage;
  if (!store) throw new Error("no Web Storage available in this runtime");
  return {
    get(): TokenSet | null {
      const raw = store.getItem(key);
      return raw ? (JSON.parse(raw) as TokenSet) : null;
    },
    set(tokens: TokenSet): void {
      store.setItem(key, JSON.stringify(tokens));
    },
    clear(): void {
      store.removeItem(key);
    },
  };
}

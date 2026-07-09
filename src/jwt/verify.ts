import {
  createLocalJWKSet,
  jwtVerify,
  decodeJwt,
  type JSONWebKeySet,
} from "jose";
import type { FetchLike, GatewardClaims } from "../core/types.js";

export interface VerifyOptions {
  /** Base URL of the Core; the JWKS is fetched from
   *  `${baseUrl}/.well-known/jwks.json`. Either this or `jwksUrl` is required. */
  baseUrl?: string;
  /** Explicit JWKS URL (overrides `baseUrl`). */
  jwksUrl?: string;
  /** Expected `iss`. Recommended. */
  issuer?: string;
  /** Expected `aud` — the app id, or `gateward:platform` for admin tokens. */
  audience?: string;
  /** Clock skew tolerance in seconds (default 5). */
  clockToleranceSec?: number;
  /** Cache the fetched JWKS this long, in seconds (default 3600 — matches the
   *  Core's `Cache-Control`). A key rotation is picked up before this via a
   *  one-shot refetch on an unknown `kid`. */
  cacheMaxAgeSec?: number;
  /** Custom fetch for the JWKS request (tests, non-global-fetch runtimes). */
  fetch?: FetchLike;
}

type LocalJWKS = ReturnType<typeof createLocalJWKSet>;

/** Reusable local ES256 verifier. Fetches the JWKS itself (so any
 *  {@link FetchLike} works), caches it with a TTL, and refetches once when a
 *  token's `kid` isn't in the cached set — covering key rotation without a
 *  round-trip per verify. */
export class JwtVerifier {
  private readonly jwksUrl: string;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;
  private readonly clockToleranceSec: number;
  private readonly cacheMaxAgeMs: number;
  private readonly fetchImpl: FetchLike;
  private cached: { keySet: LocalJWKS; fetchedAt: number } | null = null;

  constructor(opts: VerifyOptions) {
    this.jwksUrl = opts.jwksUrl ?? jwksUrlFor(opts.baseUrl);
    this.issuer = opts.issuer;
    this.audience = opts.audience;
    this.clockToleranceSec = opts.clockToleranceSec ?? 5;
    this.cacheMaxAgeMs = (opts.cacheMaxAgeSec ?? 3600) * 1000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("no fetch available — pass `fetch` in VerifyOptions");
    }
  }

  /** Verifies signature + expiry (and issuer/audience when configured) with
   *  no call to the Core beyond fetching the (cached) JWKS. Throws (jose
   *  error) on any failure. `audience` overrides the constructor default. */
  async verify(token: string, audience?: string): Promise<GatewardClaims> {
    const keySet = await this.getKeySet(false);
    try {
      return await this.verifyWith(token, audience, keySet);
    } catch (err) {
      if (isUnknownKey(err)) {
        // Likely a rotated key not yet in our cached JWKS — refetch once.
        return this.verifyWith(token, audience, await this.getKeySet(true));
      }
      throw err;
    }
  }

  private async verifyWith(
    token: string,
    audience: string | undefined,
    keySet: LocalJWKS,
  ): Promise<GatewardClaims> {
    const aud = audience ?? this.audience;
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ["ES256"],
      clockTolerance: this.clockToleranceSec,
      ...(this.issuer ? { issuer: this.issuer } : {}),
      ...(aud ? { audience: aud } : {}),
    });
    return payload as unknown as GatewardClaims;
  }

  private async getKeySet(force: boolean): Promise<LocalJWKS> {
    const now = Date.now();
    if (
      !force &&
      this.cached &&
      now - this.cached.fetchedAt < this.cacheMaxAgeMs
    ) {
      return this.cached.keySet;
    }
    const res = await this.fetchImpl(this.jwksUrl);
    if (!res.ok) {
      throw new Error(`failed to fetch JWKS (${res.status}) from ${this.jwksUrl}`);
    }
    const jwks = (await res.json()) as JSONWebKeySet;
    const keySet = createLocalJWKSet(jwks);
    this.cached = { keySet, fetchedAt: now };
    return keySet;
  }
}

/** Decode claims WITHOUT verifying — never trust these for authorization.
 *  Used internally to read `exp` for refresh scheduling. */
export function decodeClaims(token: string): GatewardClaims {
  return decodeJwt(token) as unknown as GatewardClaims;
}

function isUnknownKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ERR_JWKS_NO_MATCHING_KEY"
  );
}

function jwksUrlFor(baseUrl: string | undefined): string {
  if (!baseUrl) throw new Error("verify requires `baseUrl` or `jwksUrl`");
  return baseUrl.replace(/\/+$/, "") + "/.well-known/jwks.json";
}

import { describe, it, expect } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { JwtVerifier, decodeClaims, type FetchLike } from "../src/index.js";

const BASE = "https://core.test";
const ISSUER = "https://core.test";

/** Mint an ES256 keypair, expose its public JWK through an injected fetch
 *  (no global patching), and return a signer for tokens against it. */
async function withKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = "test-key";
  jwk.alg = "ES256";

  const fetch = (async (input: string | URL) => {
    if (String(input).endsWith("/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as unknown as FetchLike;

  const sign = (claims: Record<string, unknown>, opts?: { exp?: string }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setExpirationTime(opts?.exp ?? "5m")
      .sign(privateKey);

  return { sign, fetch };
}

describe("JwtVerifier", () => {
  it("verifies a valid ES256 token and returns claims", async () => {
    const { sign, fetch } = await withKeys();
    const token = await sign({
      sub: "user-1",
      aud: "app-123",
      scopes: ["session:read_own"],
    });

    const verifier = new JwtVerifier({ baseUrl: BASE, issuer: ISSUER, fetch });
    const claims = await verifier.verify(token, "app-123");

    expect(claims.sub).toBe("user-1");
    expect(claims.scopes).toContain("session:read_own");
  });

  it("rejects a token with the wrong audience", async () => {
    const { sign, fetch } = await withKeys();
    const token = await sign({ sub: "user-1", aud: "app-123" });

    const verifier = new JwtVerifier({ baseUrl: BASE, issuer: ISSUER, fetch });
    await expect(verifier.verify(token, "other-app")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { sign, fetch } = await withKeys();
    const token = await sign({ sub: "user-1", aud: "app-123" }, { exp: "-1m" });

    const verifier = new JwtVerifier({ baseUrl: BASE, issuer: ISSUER, fetch });
    await expect(verifier.verify(token, "app-123")).rejects.toThrow();
  });

  it("decodeClaims reads claims without verifying", async () => {
    const { sign } = await withKeys();
    const token = await sign({ sub: "user-9", aud: "app-123" });

    expect(decodeClaims(token).sub).toBe("user-9");
  });
});

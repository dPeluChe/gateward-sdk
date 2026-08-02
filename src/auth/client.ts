import {
  HttpClient,
  type RequestHooks,
  type RetryOptions,
} from "../core/http.js";
import { resolveDeviceId } from "../core/device.js";
import { resolveTimezone } from "../core/timezone.js";
import { AuthSession, type SessionOptions } from "../core/session.js";
import type { TokenSet } from "../core/storage.js";
import type {
  FetchLike,
  ForgotPasswordResponse,
  RegisterResponse,
  ResendVerificationEmailResponse,
  SessionSummary,
  TokenResponse,
} from "../core/types.js";

export interface GatewardAuthOptions extends SessionOptions {
  baseUrl: string;
  /** App id — sent as `X-Gateward-App-Id`, required for auth endpoints. */
  appId: string;
  /** Stable device id (`X-Gateward-Device-Id`). Defaults to a persisted,
   *  auto-generated id in the browser; pass one to control it. Set to `false`
   *  to disable sending it. */
  deviceId?: string | false;
  /** IANA timezone (`X-Gateward-Timezone`). Defaults to the runtime's detected
   *  zone; pass one to control it, or `false` to disable sending it. */
  timezone?: string | false;
  /** Observability hooks (onRequest/onResponse/onError/onRetry). */
  hooks?: RequestHooks;
  /** Automatic retry (idempotency-aware). `true` for defaults. */
  retry?: RetryOptions | boolean;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
}

/** Browser/user-facing auth client: register, login, automatic refresh,
 *  logout, and the caller's own sessions. App-scoped — every request carries
 *  `X-Gateward-App-Id`. Token lifecycle comes from {@link AuthSession}. */
export class GatewardAuth extends AuthSession {
  constructor(opts: GatewardAuthOptions) {
    const deviceId =
      opts.deviceId === false ? undefined : resolveDeviceId(opts.deviceId);
    const timezone =
      opts.timezone === false ? undefined : resolveTimezone(opts.timezone);
    super(
      new HttpClient({
        baseUrl: opts.baseUrl,
        appId: opts.appId,
        ...(deviceId ? { deviceId } : {}),
        ...(timezone ? { timezone } : {}),
        ...(opts.hooks ? { hooks: opts.hooks } : {}),
        ...(opts.retry !== undefined ? { retry: opts.retry } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      }),
      opts,
    );
  }

  /** Register a user into this app. Does not log in (no tokens issued) — the
   *  Core requires email verification first.
   *
   *  `metadata` is the signup profile (display name, locale, …), stored on the
   *  membership and returned by {@link getUser}. It is user-supplied, so the
   *  Core never derives authorization from it and neither should you. */
  register(
    email: string,
    password: string,
    opts: { metadata?: Record<string, unknown> } = {},
  ): Promise<RegisterResponse> {
    return this.http.request<RegisterResponse>("POST", "/v1/auth/register", {
      body: {
        email,
        password,
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
      },
    });
  }

  /** Log in and persist the returned token pair. */
  async login(email: string, password: string): Promise<TokenSet> {
    const tokens = await this.http.request<TokenResponse>("POST", "/v1/auth/login", {
      body: { email, password },
    });
    return this.persist(tokens);
  }

  /** List the caller's own active sessions. */
  listSessions(): Promise<SessionSummary[]> {
    return this.authedRequest<SessionSummary[]>("GET", "/v1/sessions");
  }

  /** Revoke one of the caller's sessions by id. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.authedRequest<void>("DELETE", `/v1/sessions/${sessionId}`);
  }

  /** Start password recovery — the Core emails a reset token (always 202,
   *  regardless of whether the email exists, to avoid enumeration). */
  forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    return this.http.request<ForgotPasswordResponse>(
      "POST",
      "/v1/auth/forgot-password",
      { body: { email } },
    );
  }

  /** Complete password recovery with the emailed token. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.http.request<void>("POST", "/v1/auth/reset-password", {
      body: { token, new_password: newPassword },
    });
  }

  /** Verify an email address with the emailed token. */
  async verifyEmail(token: string): Promise<void> {
    await this.http.request<void>("POST", "/v1/auth/verify-email", {
      body: { token },
    });
  }

  /** Resend the verification email (always 202, anti-enumeration). */
  resendVerificationEmail(
    email: string,
  ): Promise<ResendVerificationEmailResponse> {
    return this.http.request<ResendVerificationEmailResponse>(
      "POST",
      "/v1/auth/resend-verification-email",
      { body: { email } },
    );
  }
}

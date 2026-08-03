import {
  HttpClient,
  type RequestHooks,
  type RetryOptions,
} from "../core/http.js";
import { resolveDeviceId } from "../core/device.js";
import { resolveTimezone } from "../core/timezone.js";
import {
  getMember,
  listMembers,
  setMemberRole,
  type ListMembersQuery,
  type MemberPage,
} from "../core/members.js";
import { AuthSession, type SessionOptions } from "../core/session.js";
import type { TokenSet } from "../core/storage.js";
import type {
  FetchLike,
  ForgotPasswordResponse,
  MembershipResponse,
  MembershipRole,
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
  private readonly appId: string;

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
    this.appId = opts.appId;
  }

  /** Members of this app. Requires `app:user_manage`, which only an
   *  `app_admin` token carries. */
  async listMembers(query: ListMembersQuery = {}): Promise<MemberPage> {
    return listMembers(
      this.http,
      { bearer: await this.getAccessToken() },
      this.appId,
      query,
    );
  }

  /** One membership in this app. */
  async getMember(userId: string): Promise<MembershipResponse> {
    return getMember(
      this.http,
      { bearer: await this.getAccessToken() },
      this.appId,
      userId,
    );
  }

  /** Promote or demote a member of this app. The Core refuses (409) to demote
   *  the last `app_admin`.
   *
   *  Scopes are re-derived at refresh, so changing your OWN role forces one —
   *  otherwise the token keeps its old scopes for up to its 15-minute TTL and
   *  the UI would gate on stale permissions. */
  async setMemberRole(
    userId: string,
    role: MembershipRole,
  ): Promise<MembershipResponse> {
    const updated = await setMemberRole(
      this.http,
      { bearer: await this.getAccessToken() },
      this.appId,
      userId,
      role,
    );
    const me = await this.getUser();
    if (me.user_id === userId) {
      await this.refresh();
      await this.getUser({ force: true });
    }
    return updated;
  }

  /** Register a user into this app. `metadata` is the signup profile (name,
   *  phone, preferences) and lands in the membership, so no second call.
   *
   *  Logs in only when the app runs with `require_email_verification: false`
   *  — then the Core returns tokens, this persists them and emits `signed_in`.
   *  Check `isAuthenticated` rather than assuming either way. */
  async register(
    email: string,
    password: string,
    opts: { metadata?: Record<string, unknown> } = {},
  ): Promise<RegisterResponse> {
    const res = await this.http.request<RegisterResponse>(
      "POST",
      "/v1/auth/register",
      {
        body: {
          email,
          password,
          ...(opts.metadata ? { metadata: opts.metadata } : {}),
        },
      },
    );
    const tokens = tokensOf(res);
    if (tokens) await this.persist(tokens);
    return res;
  }

  /** Log in and persist the returned token pair. */
  async login(email: string, password: string): Promise<TokenSet> {
    const tokens = await this.http.request<TokenResponse>("POST", "/v1/auth/login", {
      body: { email, password },
    });
    return this.persist(tokens);
  }

  /** Change the password, proving the current one. The Core revokes the
   *  caller's other sessions and keeps this one alive. */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.authedRequest<void>("POST", "/v1/auth/change-password", {
      retryOn401: false,
      body: { current_password: currentPassword, new_password: newPassword },
    });
  }

  /** Start an email change. The Core mails a confirmation token to the NEW
   *  address; nothing changes until {@link verifyEmailChange}.
   *
   *  Anti-enumeration: a taken address answers exactly like a free one, so a
   *  typo landing in someone else's inbox looks like success here. Tell the
   *  user the change only lands once they confirm from that inbox. */
  async changeEmail(newEmail: string, password?: string): Promise<void> {
    await this.authedRequest<void>("POST", "/v1/auth/change-email", {
      retryOn401: false,
      body: {
        new_email: newEmail,
        ...(password !== undefined ? { password } : {}),
      },
    });
  }

  /** Confirm the change with the emailed token.
   *
   *  The Core revokes every session in the pool, so this IS a logout: the
   *  stored tokens are dead and the local session is cleared. Send the user
   *  back to login with the new address. */
  async verifyEmailChange(token: string): Promise<void> {
    await this.http.request<void>("POST", "/v1/auth/verify-email-change", {
      body: { token },
    });
    await this.forgetLocalSession();
  }

  /** Delete the caller's account. Scoped to THIS app — the user keeps any
   *  membership in other apps, and the identity is only anonymized once none
   *  are left. Irreversible, so the Core wants the password too. */
  async deleteAccount(password?: string): Promise<void> {
    await this.authedRequest<void>("POST", "/v1/auth/delete-account", {
      retryOn401: false,
      body: password !== undefined ? { password } : {},
    });
    await this.forgetLocalSession();
  }

  /** List the caller's own active sessions. */
  listSessions(): Promise<SessionSummary[]> {
    return this.authedRequest<SessionSummary[]>("GET", "/v1/sessions");
  }

  /** Revoke one of the caller's sessions by id. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.authedRequest<void>("DELETE", `/v1/sessions/${sessionId}`);
  }

  /** Sign out everywhere. Keeps the current session unless
   *  `includeCurrent`. Returns how many were revoked. */
  async revokeAllSessions(
    opts: { includeCurrent?: boolean } = {},
  ): Promise<number> {
    const res = await this.authedRequest<{ revoked: number }>(
      "DELETE",
      "/v1/sessions",
      opts.includeCurrent ? { query: { include_current: true } } : {},
    );
    // Revoking our own session leaves the stored tokens dead.
    if (opts.includeCurrent) await this.forgetLocalSession();
    return res.revoked;
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

/** The token pair a register response carries, or `null` when the app still
 *  requires email verification. */
function tokensOf(res: RegisterResponse): TokenResponse | null {
  if (!res.access_token || !res.refresh_token || res.expires_in == null) {
    return null;
  }
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    token_type: res.token_type ?? "Bearer",
    expires_in: res.expires_in,
  };
}

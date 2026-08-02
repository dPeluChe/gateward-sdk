import type { TokenSet } from "./storage.js";

/** What happened to the session.
 *
 *  `session_expired` is deliberately distinct from `signed_out`: the first is
 *  the server dropping the session under the app's feet (dead/rotated refresh
 *  token), the second is the user asking to leave. Apps react differently —
 *  a forced logout usually means "redirect to /login now", an explicit one
 *  means "go home". Without the distinction the SDK clears storage silently
 *  and the UI keeps rendering an authenticated shell for a session that no
 *  longer exists. */
export type AuthEvent =
  | "signed_in"
  | "token_refreshed"
  | "signed_out"
  | "session_expired";

export interface AuthStateChange {
  event: AuthEvent;
  /** The live token pair, or `null` once the session is gone. */
  tokens: TokenSet | null;
}

export type AuthStateListener = (change: AuthStateChange) => void;

/** Fan-out for auth state transitions. A listener that throws is isolated —
 *  one bad subscriber must not break the token pipeline that emitted. */
export class AuthStateEmitter {
  private readonly listeners = new Set<AuthStateListener>();

  subscribe(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(change: AuthStateChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        /* a subscriber's error must never affect the session */
      }
    }
  }
}

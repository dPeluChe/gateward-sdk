import type { TokenSet } from "./storage.js";

/** `session_expired` (server dropped it) is distinct from `signed_out` (user
 *  left) because apps react differently. See docs/ARCHITECTURE/SESSION.md. */
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

/** Fan-out for auth state transitions. */
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
        // A subscriber's error must never break the token pipeline.
      }
    }
  }
}

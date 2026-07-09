const STORAGE_KEY = "gateward.device_id";

/** Resolve a stable device id sent as `X-Gateward-Device-Id` so the Core can
 *  recognize the same device across sessions.
 *
 *  - An explicit id always wins.
 *  - In a browser it is generated once and persisted in `localStorage`, so it
 *    survives reloads and logouts.
 *  - Elsewhere (Node, no Web Storage) a per-process id is generated — pass an
 *    explicit `deviceId` if you need server-side persistence. */
export function resolveDeviceId(explicit?: string): string | undefined {
  if (explicit) return explicit;

  const store = safeLocalStorage();
  if (store) {
    const existing = store.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = randomId();
    if (!fresh) return undefined;
    try {
      store.setItem(STORAGE_KEY, fresh);
    } catch {
      /* storage full / disabled — still return the id for this session */
    }
    return fresh;
  }
  return randomId();
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Accessing localStorage can throw (sandboxed iframes, disabled storage).
    return undefined;
  }
}

function randomId(): string | undefined {
  return globalThis.crypto?.randomUUID?.();
}

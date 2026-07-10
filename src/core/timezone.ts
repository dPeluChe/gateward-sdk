/** Resolve the caller's IANA timezone (e.g. `America/Argentina/Buenos_Aires`)
 *  to send as `X-Gateward-Timezone`. An explicit value wins; otherwise it is
 *  detected via `Intl` (works in browsers and Node). Returns `undefined` when
 *  it can't be determined. */
export function resolveTimezone(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

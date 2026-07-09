/** Any non-2xx response from the Core, or a transport failure. */
export class GatewardError extends Error {
  /** HTTP status, or 0 for a transport/network failure. */
  readonly status: number;
  /** Parsed response body, when the Core returned one. */
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "GatewardError";
    this.status = status;
    this.body = body;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

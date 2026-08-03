import type { AppConfig, PasswordPolicy } from "./types.js";

/** Only `production` counts as production, so an app that is mislabelled fails
 *  the environment guard loudly instead of passing as test. */
export type AppEnvironment =
  | "production"
  | "test"
  | "staging"
  | "development";

/** Human-readable reasons a password fails the app's policy, empty when it
 *  passes. A UX pre-check only — the Core is authoritative and applies the
 *  same rules on register / reset-password / change-password. */
export function checkPassword(
  password: string,
  policy: PasswordPolicy | undefined,
): string[] {
  if (!policy) return [];
  const errors: string[] = [];
  const { min_length, max_length, numeric_only } = policy;

  if (min_length != null && password.length < min_length) {
    errors.push(`must be at least ${min_length} characters`);
  }
  if (max_length != null && password.length > max_length) {
    errors.push(`must be at most ${max_length} characters`);
  }
  if (numeric_only && !/^\d*$/.test(password)) {
    errors.push("must contain digits only");
  }
  // numeric_only excludes these by construction; the Core rejects the
  // combination, so checking them anyway would produce impossible advice.
  if (!numeric_only) {
    if (policy.require_digit && !/\d/.test(password)) {
      errors.push("must contain at least one digit");
    }
    if (policy.require_upper && !/[A-Z]/.test(password)) {
      errors.push("must contain at least one uppercase letter");
    }
    if (policy.require_symbol && !/[^A-Za-z0-9]/.test(password)) {
      errors.push("must contain at least one symbol");
    }
  }
  return errors;
}

export class EnvironmentMismatchError extends Error {
  constructor(
    readonly expected: AppEnvironment | AppEnvironment[],
    readonly actual: string,
    readonly appName: string,
  ) {
    super(
      `Gateward app "${appName}" runs in "${actual}", but this build expects ` +
        `${[expected].flat().map((e) => `"${e}"`).join(" or ")}. ` +
        `Check the app id — pointing a test build at production creates real users.`,
    );
    this.name = "EnvironmentMismatchError";
  }
}

export function assertEnvironment(
  config: AppConfig,
  expected: AppEnvironment | AppEnvironment[],
): void {
  const allowed = [expected].flat();
  if (!allowed.includes(config.environment as AppEnvironment)) {
    throw new EnvironmentMismatchError(expected, config.environment, config.name);
  }
}

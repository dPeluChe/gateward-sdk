// React bindings. `react` is a peer dependency — importing this subpath from
// a non-React runtime is a mistake, so it stays out of the main entry.
export {
  GatewardProvider,
  type GatewardProviderProps,
} from "./react/provider.js";
export {
  useAuth,
  useUser,
  type AuthStatus,
  type GatewardContextValue,
} from "./react/context.js";

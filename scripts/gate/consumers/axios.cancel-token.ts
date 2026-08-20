// Probe for axios 1.18.0 -> 1.18.1. `CancelToken` gained `subscribe`,
// `unsubscribe`, and `toAbortSignal`, so a hand-built token stops satisfying the
// interface. The main consumer uses the axios-made token and never builds one.
import type { CancelToken, Cancel } from 'axios';

const token: CancelToken = {
  promise: Promise.resolve({} as Cancel),
  throwIfRequested(): void {},
};

export { token };

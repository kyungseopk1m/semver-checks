// Probe for ky 1.11.0 -> 1.12.0. The hooks gained a required trailing `state`
// parameter. Handing ky a shorter function still works, because a function with
// fewer parameters is assignable; *calling* a hook value, which is what a decorator
// or a composer does, is now an arity error.
import type { BeforeErrorHook } from 'ky';

export const withLogging = (hook: BeforeErrorHook): BeforeErrorHook => async (error) => {
  const result = await hook(error);
  void result.message;
  return result;
};

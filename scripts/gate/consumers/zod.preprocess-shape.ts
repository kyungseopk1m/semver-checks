// Probe for zod 4.4.1 -> 4.4.2. `z.preprocess` changed its return type from a
// pipe over a transform to a dedicated `ZodPreprocess`, which a consumer that
// wrote the old type out no longer receives.
import { z } from 'zod';

const trimmed: z.ZodPipe<z.ZodTransform<string, unknown>, z.ZodString> = z.preprocess(
  (value) => String(value).trim(),
  z.string(),
);

export { trimmed };

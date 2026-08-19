// Transcribed from zod's documented quickstart: define a schema, infer its type,
// parse safely, and compose. No symbol hunting -- this is what the README shows.
import { z } from 'zod';

const User = z.object({
  name: z.string().min(2),
  age: z.number().int().positive().optional(),
  email: z.email(),
  tags: z.array(z.string()).default([]),
  role: z.enum(['admin', 'user']),
});

type User = z.infer<typeof User>;

const parsed: User = User.parse({ name: 'ab', email: 'a@b.co', role: 'user' });

const result = User.safeParse({});
if (!result.success) {
  const issues: z.core.$ZodIssue[] = result.error.issues;
  void issues;
} else {
  void result.data.name;
}

const Partial = User.partial();
const Picked = User.pick({ name: true });
const Extended = User.extend({ active: z.boolean() });
const Union = z.union([z.string(), z.number()]);
const Record = z.record(z.string(), z.number());
const Transformed = z.string().transform((s) => s.length);

export { parsed, Partial, Picked, Extended, Union, Record, Transformed };
export type { User };

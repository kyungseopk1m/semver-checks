// Transcribed from valibot's documented quickstart: build a schema from small
// composable functions, infer its type, and validate with parse / safeParse.
import * as v from 'valibot';

const UserSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2)),
  email: v.pipe(v.string(), v.email()),
  age: v.optional(v.pipe(v.number(), v.integer())),
  tags: v.array(v.string()),
  role: v.picklist(['admin', 'user']),
});

type User = v.InferOutput<typeof UserSchema>;

const parsed: User = v.parse(UserSchema, {
  name: 'ab',
  email: 'a@b.co',
  tags: [],
  role: 'user',
});

const result = v.safeParse(UserSchema, {});
if (!result.success) {
  const issues = result.issues;
  void issues[0].message;
} else {
  void result.output.name;
}

const Partial = v.partial(UserSchema);
const Picked = v.pick(UserSchema, ['name']);
const Union = v.union([v.string(), v.number()]);
const Transformed = v.pipe(v.string(), v.transform((s) => s.length));

export { parsed, Partial, Picked, Union, Transformed };
export type { User };

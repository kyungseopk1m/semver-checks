// Transcribed from TypeBox's documented quickstart: compose a schema from the
// Type builders, infer the static type, and read the resulting JSON Schema.
import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';

const User = Type.Object({
  id: Type.Number(),
  name: Type.String({ minLength: 2 }),
  email: Type.Optional(Type.String({ format: 'email' })),
  tags: Type.Array(Type.String()),
  role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
});

type User = Static<typeof User>;

const user: User = { id: 1, name: 'ab', tags: [], role: 'user' };

const Partial = Type.Partial(User);
const Picked = Type.Pick(User, ['name']);
const Omitted = Type.Omit(User, ['email']);
const Intersected = Type.Intersect([User, Type.Object({ active: Type.Boolean() })]);
const Rec = Type.Record(Type.String(), Type.Number());

function describe(schema: TSchema): string {
  return JSON.stringify(schema);
}

export { user, Partial, Picked, Omitted, Intersected, Rec, describe };
export type { User };

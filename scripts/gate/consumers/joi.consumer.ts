import Joi from 'joi';

const schema = Joi.object({
  name: Joi.string().required(),
  age: Joi.number(),
});

// exercises ArraySchema.items / AlternativesSchema.try / Root.alternatives / Root.alt
// rest-param usage, the exact flagged symbols
const arr = Joi.array().items(Joi.string(), Joi.number());
const alt1 = Joi.alternatives().try(Joi.string(), Joi.number());
const alt2 = Joi.alternatives(Joi.string(), Joi.number());
const alt3 = Joi.alt(Joi.string(), Joi.number());

// AnySchema is never hand-implemented by consumers — they get it back from
// Joi.string()/Joi.object()/etc, so this checks the realistic "receive, don't
// implement" pattern for the "~standard" required-property-added finding.
const anySchema: Joi.AnySchema = Joi.string();

const { error, value } = schema.validate({ name: 'x', age: 1 });

export { schema, arr, alt1, alt2, alt3, anySchema, error, value };

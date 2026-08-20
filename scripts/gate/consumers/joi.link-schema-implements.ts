// Probe for joi 18.1.2 -> 18.2.0. `LinkSchema` gained a required `maxRecursion`
// method. The stand-in reproduces the 18.1.2 surface by hand rather than deriving
// it from a real `Joi.link()`, which would inherit the new member and hide this.
import Joi from 'joi';

interface MyLinkSchema extends Joi.AnySchema<any> {
  concat(schema: Joi.Schema): this;
  ref(ref: string): this;
}

declare const myLink: MyLinkSchema;

export const stored: Joi.LinkSchema = myLink;

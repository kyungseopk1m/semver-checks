// Probe for axios 1.16.1 -> 1.17.0. `AxiosHeaders#toJSON` narrowed its return from
// `RawAxiosHeaders`, whose values include numbers and booleans, to
// `Record<string, string | string[]>`. Reading the result is fine; writing a number
// back into it, which the old type explicitly permitted, is not, and neither is a
// subclass that keeps the documented old return type.
import { AxiosHeaders } from 'axios';
import type { RawAxiosHeaders } from 'axios';

const h = new AxiosHeaders({ 'x-a': 'a' });
const json = h.toJSON();
json['x-count'] = 5;

export class MyHeaders extends AxiosHeaders {
  override toJSON(): RawAxiosHeaders {
    return { 'x-a': 1 };
  }
}

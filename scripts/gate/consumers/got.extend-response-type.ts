// Probe for got 14.6.4 -> 14.6.5. Two call signatures were inserted ahead of the
// ones they shadow, so a one-argument call on an extended instance now resolves to
// them and its body type follows the instance's `responseType`: `string` becomes
// `unknown` under `responseType: 'json'`. A bare `got` is unaffected, which is why
// the main consumer sees nothing.
import got from 'got';

const client = got.extend({ responseType: 'json' });

export async function body(): Promise<string> {
  const response = await client('https://example.com');
  return response.body;
}

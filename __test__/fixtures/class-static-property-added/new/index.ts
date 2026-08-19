export class HttpError extends Error {
  status: number = 500;
  // Added on the constructor object, not on instances: nothing a consumer can
  // be obliged to supply, so this must not read as a required member.
  static readonly DEFAULT_CODE: string = 'E_HTTP';
}

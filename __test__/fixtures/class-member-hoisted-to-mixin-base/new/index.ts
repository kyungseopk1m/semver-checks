export interface Producer {
  setIssuer(issuer: string): this;
  setSubject(subject: string): this;
}

// What TypeScript emits for `class Signer extends Mixin(Base)`.
declare const Signer_base: new () => Producer;

export declare class Signer extends Signer_base {
  sign(): string;
}

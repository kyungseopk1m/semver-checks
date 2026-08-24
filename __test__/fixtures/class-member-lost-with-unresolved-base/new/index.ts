declare const Signer_base: new () => { setIssuer(issuer: string): this };

export declare class Signer extends Signer_base {
  sign(): string;
}

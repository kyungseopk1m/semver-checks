export interface Producer {
  setIssuer(issuer: string): this;
  setSubject(subject: string): this;
}

export declare class Signer implements Producer {
  setIssuer(issuer: string): this;
  setSubject(subject: string): this;
  sign(): string;
}

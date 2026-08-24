export interface Producer {
  setIssuer(issuer: string): this;
  setSubject(subject: string): this;
}

export declare class Producible implements Producer {
  setIssuer(issuer: string): this;
  setSubject(subject: string): this;
}

export declare class Signer extends Producible {
  sign(): string;
}

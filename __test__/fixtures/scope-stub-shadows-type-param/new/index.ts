interface Hidden {
  h: string;
}

export interface Holder {
  slot: Hidden;
}

export declare function widen<Hidden>(x: Hidden | string | number): void;

// `Hidden` is not exported, so rendering `Holder` puts an opaque stand-in of
// that name at file scope — the same scope the probe's synthesized type
// parameters go into.
interface Hidden {
  h: string;
}

export interface Holder {
  slot: Hidden;
}

export declare function widen<Hidden>(x: Hidden | string): void;

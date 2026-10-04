namespace p {
  type Spec = 'd' | 's' | 'j' | 'o' | 'O';
  type Parse<T, Acc extends unknown[] = []> = T extends `${infer _}%${infer S}${infer R}`
    ? S extends Spec ? Parse<R, [...Acc, S]> : Parse<R, Acc> : Acc;
  export const make = <T extends string>(m: T) => (...a: Parse<T>) => {};
}
export const log = p.make;
export const log2 = p.make;
export interface Base<X> { x: X }
export interface I<T extends string> extends Base<ReturnType<typeof log<T>>> {}
export interface J<T extends string> extends Base<ReturnType<typeof log<T>>> {}

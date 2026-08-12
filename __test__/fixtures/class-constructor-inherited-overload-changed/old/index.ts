export class Base {
  constructor(a: string);
  constructor(a: number);
  constructor(a: string | number) {}
}
export class Derived extends Base {}

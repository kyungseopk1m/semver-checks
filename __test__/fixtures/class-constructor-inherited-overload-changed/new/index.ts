export class Base {
  constructor(a: string);
  constructor(a: boolean);
  constructor(a: string | boolean) {}
}
export class Derived extends Base {}

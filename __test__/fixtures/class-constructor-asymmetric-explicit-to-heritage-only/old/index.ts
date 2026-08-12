export class Base {
  constructor(x: string) {}
}
export class Derived extends Base {
  constructor(x: string) {
    super(x);
  }
}

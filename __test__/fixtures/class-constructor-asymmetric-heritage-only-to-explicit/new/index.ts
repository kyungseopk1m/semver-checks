export class Base {
  constructor(x: number) {}
}
export class Derived extends Base {
  constructor(x: number) {
    super(x);
  }
}

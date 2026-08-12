export class Base {
  constructor(value: string) {}
}
export class Derived extends Base {
  constructor(value: string) {
    super(value);
  }
}

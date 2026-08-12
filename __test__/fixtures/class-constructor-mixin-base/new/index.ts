type Ctor = new (...args: any[]) => object;
function Mixin<T extends Ctor>(Base: T) {
  return class extends Base {
    tag = 'mixed';
  };
}
class Root {
  constructor(x: number) {}
}
export class Derived extends Mixin(Root) {}

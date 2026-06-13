export class C { private _x = 0; get x(): string | number { return this._x; } set x(v: string) { this._x = Number(v); } }

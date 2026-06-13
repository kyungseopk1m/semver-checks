interface Box<T> { value: T }
export declare function unwrap<S extends Box<S>>(x: S): S;

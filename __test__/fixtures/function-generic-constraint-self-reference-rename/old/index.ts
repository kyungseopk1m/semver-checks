interface Box<T> { value: T }
export declare function unwrap<T extends Box<T>>(x: T): T;

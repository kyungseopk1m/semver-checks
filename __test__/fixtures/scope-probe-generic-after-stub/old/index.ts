// `alpha` makes the probe stand `Ghost` in, and `beta`'s generic carries that
// same name. Whether `beta` is read before or after `alpha` must not change what
// it decides.
interface Ghost {
  seen: boolean;
}

export interface Config {
  retries: number;
}

export declare function alpha(target: Ghost): void;
export declare function beta<Ghost>(items: Ghost[]): Ghost;

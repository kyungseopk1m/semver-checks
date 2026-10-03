// `Ghost` is not exported, and nothing the scope renders mentions it: `Config`
// does not, and a function is not rendered at all. So the repair rounds never
// see the name and the only thing that asks for it is the probe.
interface Ghost {
  seen: boolean;
}

export interface Config {
  retries: number;
}

export declare function alpha(target: Ghost): void;

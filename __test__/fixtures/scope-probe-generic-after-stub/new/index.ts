interface Ghost {
  seen: boolean;
}

export interface Config {
  retries: number;
}

export declare function alpha(target: Ghost | string): void;
export declare function beta<Ghost>(items: unknown[]): Ghost;

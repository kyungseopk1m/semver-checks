export interface Closable { close(): void; flush(): void }
export interface Stream extends Closable { read(): string; close(): void }

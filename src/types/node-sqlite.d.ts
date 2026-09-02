declare module "node:sqlite" {
  export interface StatementSync {
    get(...anonymousParameters: unknown[]): unknown;
    run(...anonymousParameters: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

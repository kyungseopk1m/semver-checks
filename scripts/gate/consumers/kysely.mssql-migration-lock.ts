// Probe for kysely 0.29.2 -> 0.29.3. The mssql adapter's migration-lock methods
// gained a required options parameter, and `releaseMigrationLock` gained the
// database argument it never took. A dialect that drives the lock itself calls
// both, so the old arity stops compiling. The main consumer builds its dialect
// over the sqlite pieces and never reaches these.
import { MssqlAdapter } from 'kysely';
import type { Kysely } from 'kysely';

const adapter = new MssqlAdapter();

export async function withMigrationLock(db: Kysely<any>): Promise<void> {
  await adapter.acquireMigrationLock(db);
  try {
    void adapter.supportsTransactionalDdl;
  } finally {
    await adapter.releaseMigrationLock();
  }
}

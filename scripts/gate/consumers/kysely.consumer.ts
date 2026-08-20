// Transcribed from kysely's documented quickstart: a hand-written dialect over
// DummyDriver, a typed query across the builder chain, a transaction, a plugin,
// and the migration + sqlite helper subpaths.
import {
  Kysely,
  DummyDriver,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  DialectAdapterBase,
  NoResultError,
  sql,
} from 'kysely';
import type {
  Dialect,
  Driver,
  DialectAdapter,
  DatabaseIntrospector,
  QueryCompiler,
  Generated,
  ColumnType,
  Selectable,
  Insertable,
  Updateable,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  DeleteResult,
  Transaction,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  RootOperationNode,
  QueryResult,
  UnknownRow,
  RawBuilder,
  Expression,
  MigrationLockOptions,
} from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/sqlite';

interface PersonTable {
  id: Generated<number>;
  first_name: string;
  last_name: string | null;
  created_at: ColumnType<Date, string | undefined, never>;
}

interface PetTable {
  id: Generated<number>;
  owner_id: number;
  name: string;
  is_favorite: boolean;
}

interface Database {
  person: PersonTable;
  pet: PetTable;
}

type Person = Selectable<PersonTable>;
type NewPerson = Insertable<PersonTable>;
type PersonUpdate = Updateable<PersonTable>;

// Subclassing a shipped class: the adapter's getters are overridden, so the
// base class's member shapes have to keep holding.
class StrictSqliteAdapter extends SqliteAdapter {
  override get supportsReturning(): boolean {
    return true;
  }

  override async acquireMigrationLock(target: Kysely<any>, options: MigrationLockOptions): Promise<void> {
    void options.lockTable;
    await super.acquireMigrationLock(target, options);
  }
}

// Implementing an abstract base by hand rather than extending a concrete one.
class BareAdapter extends DialectAdapterBase {
  get supportsTransactionalDdl(): boolean {
    return false;
  }

  get supportsReturning(): boolean {
    return false;
  }

  async acquireMigrationLock(): Promise<void> {}

  async releaseMigrationLock(): Promise<void> {}
}

// Implementing the interface the config asks for, rather than importing a dialect.
const dialect: Dialect = {
  createDriver(): Driver {
    return new DummyDriver();
  },
  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  },
  createAdapter(): DialectAdapter {
    return new StrictSqliteAdapter();
  },
  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  },
};

class LoggingPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    void args.queryId;
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}

const db = new Kysely<Database>({
  dialect,
  plugins: [new LoggingPlugin()],
  log: ['query'],
});

// The generic arguments are written out on purpose: a builder whose parameter
// list changes shape is only caught when the arguments are supplied.
const selectQuery: SelectQueryBuilder<Database, 'person', { id: number; first_name: string }> = db
  .selectFrom('person')
  .select(['person.id', 'person.first_name'])
  .where('person.first_name', '=', 'Jennifer')
  .orderBy('person.id', 'desc')
  .limit(10);

const insertQuery: InsertQueryBuilder<Database, 'person', unknown> = db
  .insertInto('person')
  .values({ first_name: 'Jennifer', last_name: 'Aniston', created_at: undefined });

const updateQuery: UpdateQueryBuilder<Database, 'person', 'person', unknown> = db
  .updateTable('person')
  .set({ last_name: 'Aniston' })
  .where('id', '=', 1);

const deleteQuery: DeleteQueryBuilder<Database, 'pet', DeleteResult> = db
  .deleteFrom('pet')
  .where('pet.owner_id', '=', 1);

async function readRows(): Promise<void> {
  const rows: Person[] = await db.selectFrom('person').selectAll().execute();
  void rows[0]?.first_name;

  const one = await db.selectFrom('person').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
  void one.last_name;

  const joined = await db
    .selectFrom('person')
    .innerJoin('pet', 'pet.owner_id', 'person.id')
    .select(['person.first_name', 'pet.name as pet_name'])
    .execute();
  void joined[0]?.pet_name;

  const nested = await db
    .selectFrom('person')
    .select((eb) => [
      'person.id',
      jsonArrayFrom(eb.selectFrom('pet').select(['pet.id', 'pet.name']).whereRef('pet.owner_id', '=', 'person.id')).as('pets'),
      jsonObjectFrom(eb.selectFrom('pet').select(['pet.name']).where('pet.is_favorite', '=', true)).as('favorite'),
    ])
    .execute();
  void nested[0]?.pets[0]?.name;
  void nested[0]?.favorite?.name;

  const grouped = await db
    .selectFrom('pet')
    .select((eb) => ['pet.owner_id', eb.fn.count<number>('pet.id').as('pet_count')])
    .groupBy('pet.owner_id')
    .having((eb) => eb.fn.count('pet.id'), '>', 1)
    .execute();
  void grouped[0]?.pet_count;
}

async function write(person: NewPerson, patch: PersonUpdate): Promise<void> {
  await db.insertInto('person').values(person).executeTakeFirst();
  await db.updateTable('person').set(patch).where('id', '=', 1).execute();
  await db.deleteFrom('person').where('id', '=', 1).execute();
}

async function inTransaction(): Promise<void> {
  await db.transaction().execute(async (trx: Transaction<Database>): Promise<void> => {
    await trx.insertInto('pet').values({ owner_id: 1, name: 'Catto', is_favorite: false }).execute();
    await trx.selectFrom('pet').selectAll().execute();
  });
}

const rawName: RawBuilder<string> = sql<string>`lower(${sql.ref('first_name')})`;
const literal: Expression<number> = sql<number>`1`;

const provider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    const first: Migration = {
      async up(target: Kysely<any>): Promise<void> {
        await target.schema.createTable('person').addColumn('id', 'integer', (c) => c.primaryKey()).execute();
      },
      async down(target: Kysely<any>): Promise<void> {
        await target.schema.dropTable('person').execute();
      },
    };
    return { '2026_01_01_init': first };
  },
};

async function migrate(): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  void error;
  void results?.[0]?.migrationName;
}

function isNoResult(err: unknown): boolean {
  return err instanceof NoResultError;
}

const bare = new BareAdapter();
const compiled = selectQuery.compile();

export {
  db,
  selectQuery,
  insertQuery,
  updateQuery,
  deleteQuery,
  readRows,
  write,
  inTransaction,
  rawName,
  literal,
  migrate,
  isNoResult,
  bare,
  compiled,
};
export type { Database, Person, NewPerson, PersonUpdate };

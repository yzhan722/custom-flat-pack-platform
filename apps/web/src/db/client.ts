import { mkdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations";
import { DEMO_SERVICE_AREAS } from "./seed-data";

/**
 * One PostgreSQL-dialect database, two drivers: embedded PGlite for local
 * development (no install) and node-postgres when DATABASE_URL is set. Both
 * expose the same Drizzle API, so the rest of the app is driver-agnostic.
 */
export type Db = PgliteDatabase<typeof schema>;

const globalStore = globalThis as unknown as { __cfpDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalStore.__cfpDb) {
    globalStore.__cfpDb = init().catch((err) => {
      globalStore.__cfpDb = undefined;
      throw err;
    });
  }
  return globalStore.__cfpDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    db = drizzlePg(pool, { schema }) as unknown as Db;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
    // ":memory:" gives an ephemeral database (tests); anything else is a directory on disk.
    let client;
    if (dataDir === ":memory:") {
      client = await PGlite.create();
    } else {
      mkdirSync(dataDir, { recursive: true });
      client = await PGlite.create(dataDir);
    }
    db = drizzlePglite(client, { schema });
  }
  await migrate(db);
  await seedServiceAreas(db);
  return db;
}

/** Runs one statement at a time: the extended query protocol used by the drivers rejects multi-statement strings. */
async function runStatements(db: Db, script: string): Promise<void> {
  const statements = script
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await db.execute(sql.raw(statement));
}

async function migrate(db: Db): Promise<void> {
  // The first migration creates schema_migrations itself, so run it unconditionally (it is idempotent).
  await runStatements(db, MIGRATIONS[0]!.sql);
  const applied = new Set((await db.execute<{ id: string }>(sql`select id from schema_migrations`)).rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    if (m !== MIGRATIONS[0]) await runStatements(db, m.sql);
    await db.execute(sql`insert into schema_migrations (id, applied_at) values (${m.id}, now()) on conflict do nothing`);
  }
}

async function seedServiceAreas(db: Db): Promise<void> {
  const existing = await db.select({ postcode: schema.serviceAreas.postcode }).from(schema.serviceAreas).limit(1);
  if (existing.length) return;
  await db.insert(schema.serviceAreas).values(DEMO_SERVICE_AREAS).onConflictDoNothing();
}

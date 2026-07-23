import pg from "pg";

/** Shared pool for the GUI's read/moderation queries (same DB as the worker). */
const globalForPg = globalThis as unknown as { _pool?: pg.Pool };

export const pool =
  globalForPg._pool ??
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://romantic:romantic@localhost:5433/romantic_tales",
    max: 5,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForPg._pool = pool;

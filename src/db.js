import pg from "pg";

/**
 * Single shared connection pool. Points at the SAME PostgreSQL the web app
 * uses (DATABASE_URL). Locally that is the docker-compose Postgres exposed on
 * host port 5433. Set DATABASE_SSL=true for managed providers (Neon/Supabase).
 */
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://romantic:romantic@localhost:5433/romantic_tales",
  max: 10,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

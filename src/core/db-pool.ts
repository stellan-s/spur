import { Pool } from "pg";

// One pool per database URL for the whole process. Opening a pool per request
// let a flood of anonymous requests exhaust Cloud SQL connections.
const pools = new Map<string, Pool>();

export function sharedPool(databaseUrl: string): Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

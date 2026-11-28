import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const sqlHost = process.env.SQL_HOST;
    const isUnixSocket = Boolean(sqlHost && sqlHost.startsWith('/'));
    const useRemoteSsl = Boolean(sqlHost && !isUnixSocket && process.env.SQL_SSL !== 'false');

    global._postgresPool = new Pool({
      host: sqlHost,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
      ...(useRemoteSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

import postgres from 'postgres';

type Database = ReturnType<typeof postgres>;

let client: Database | undefined;

export function getDb() {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  client = postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}

export async function closeDb() {
  if (client) await client.end({ timeout: 5 });
  client = undefined;
}

import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE_NAME = process.env.MONGODB_DATABASE_NAME;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env'
  );
}

if (!MONGODB_DATABASE_NAME) {
  throw new Error(
    'Please define the MONGODB_DATABASE_NAME environment variable inside .env'
  );
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections from growing exponentially
 * during API Route usage.
 */
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(MONGODB_URI!);

  await client.connect();

  const db = client.db(MONGODB_DATABASE_NAME);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getDb(): Promise<Db> {
    const { db } = await connectToDatabase();
    return db;
}

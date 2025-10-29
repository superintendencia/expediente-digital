import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DATABASE_NAME = process.env.MONGODB_DATABASE_NAME;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env or in your deployment settings.'
  );
}

if (!MONGODB_DATABASE_NAME) {
  throw new Error(
    'Please define the MONGODB_DATABASE_NAME environment variable inside .env or in your deployment settings.'
  );
}

// Extend the global type to include our MongoDB connection cache
declare global {
  // allow global `var` declarations
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient>
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!global._mongoClientPromise) {
    const client = new MongoClient(MONGODB_URI);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  const client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export async function getDb(): Promise<Db> {
    const client = await clientPromise;
    const db = client.db(MONGODB_DATABASE_NAME);
    return db;
}

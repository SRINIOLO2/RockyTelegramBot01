import * as fs from 'fs/promises';
import * as path from 'path';

export interface UserTokens {
  telegramId: string;
  telegramName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Timestamp in milliseconds when token expires
}

interface DbSchema {
  users: Record<string, UserTokens>;
}

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'tokens.json');

// In-memory cache to eliminate disk I/O latency on reads
let memoryDb: DbSchema | null = null;

/**
 * Ensures the database directory and file exist.
 */
async function ensureDbExists(): Promise<void> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch (err) {
    // Ignore if directory already exists
  }

  try {
    await fs.access(DB_FILE);
  } catch {
    // If file doesn't exist, initialize with empty structure
    await fs.writeFile(DB_FILE, JSON.stringify({ users: {} }, null, 2), 'utf-8');
  }
}

/**
 * Reads the database file.
 */
async function readDb(): Promise<DbSchema> {
  if (memoryDb) {
    return memoryDb;
  }
  await ensureDbExists();
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    memoryDb = JSON.parse(data) as DbSchema;
    return memoryDb;
  } catch (err) {
    console.error('Error reading token database, returning empty schema:', err);
    return { users: {} };
  }
}

/**
 * Writes to the database file.
 */
async function writeDb(data: DbSchema): Promise<void> {
  memoryDb = data; // Sync in-memory cache
  await ensureDbExists();
  const tempFile = `${DB_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempFile, DB_FILE); // Atomic write
}

/**
 * Retrieves the Spotify tokens for a specific Telegram user ID.
 */
export async function getTokens(telegramId: string): Promise<UserTokens | null> {
  const db = await readDb();
  return db.users[telegramId] || null;
}

/**
 * Saves or updates Spotify tokens for a Telegram user ID.
 */
export async function saveTokens(
  telegramId: string,
  data: Omit<UserTokens, 'telegramId'>
): Promise<void> {
  const db = await readDb();
  db.users[telegramId] = {
    telegramId,
    ...data,
  };
  await writeDb(db);
}

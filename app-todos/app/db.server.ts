import { createClient } from "@libsql/client";
import { singleton } from "./singleton.server";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { mapResultSet } from "../../map-sqlite-resultset";

console.log(`getting ydoc`);

const adminDb = createClient({
  url: `file:admin.db`,
  syncUrl: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const syncedForDbs = new Set();
const dbs = new Map()
async function syncAdminDb(dbName) {
  if (!syncedForDbs.has(dbName)) {
    await adminDb.sync();
    syncedForDbs.add(dbName);
  }

  const results = await adminDb.execute(`SELECT * from dbs`)
  const dbRows = mapResultSet(results)
  dbRows.forEach(dbInfo => {
    dbs.set(dbInfo.name, dbInfo)
  })
}

syncAdminDb(`initial`);

const getDb = (dbName) =>
  singleton(`getDb${dbName}`, () => {
    console.log(`get db singleton ${dbName}`);
    const db = dbs.get(dbName)
    return createClient({ url: db.url, authToken: db.authToken });
  });

export { getDb, syncAdminDb };

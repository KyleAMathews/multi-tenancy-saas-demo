import path from "path"
import Database from "libsql"

export function getDb(baseDir, dbName) {
  const dbPath = path.join(baseDir, `${dbName}.db`)
  const db = new Database(dbPath)

  return db
}

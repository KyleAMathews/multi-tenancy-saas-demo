import path from "path"
import { createClient } from "@libsql/client"

export function getDb(baseDir, dbName) {
  const dbPath = path.join(baseDir, `${dbName}.db`)
  const db = createClient({ url: `file:${dbPath}` })

  return db
}

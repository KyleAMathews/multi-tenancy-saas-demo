import cors from "cors"
import path from "path"
import express from "express"
import { WebSocketServer } from "ws"
import { fileURLToPath } from "url"
import fs from "fs-extra"
import { setupWSConnection, getYDoc } from "situated"
import listen from "../machines/server"
import mapResultSet from "../map-sqlite-resultset"
console.log({ mapResultSet })
import Parser from "node-sql-parser"
import { serverConfig } from "./mutators"
import { createClient } from "@libsql/client"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const baseDir =
  process.env.BASE_DATA_DIR || path.resolve(process.cwd(), `.cache`)
const file = path.join(baseDir, `db.json`)
const dbsDir = path.join(baseDir, `dbs`)
console.log({ dbsDir, dir: path.dirname(dbsDir) })
fs.ensureDirSync(path.dirname(file))
fs.ensureDirSync(dbsDir)

const app = express()
app.use(express.json())
app.use(
  cors({
    origin: `http://localhost:5174`,
    credentials: true,
  })
)

// Serve static assets.
app.use(`/`, express.static(path.join(__dirname, `../dist`)))

// handle every other route with index.html, which will contain
// a script tag to your application's JavaScript file(s).
app.get(`*`, function (request, response) {
  response.sendFile(path.resolve(__dirname, `../dist/index.html`))
})

app.post(`/invalidate/:dbName`, async (req, res) => {
  const dbName = req.params.dbName

  const doc = getYDoc(`app-doc`)
  const dbs = doc.getMap(`dbs`)

  if (dbs.has(dbName)) {
    const ydocDb = dbs.get(dbName)
    // Query for total + completed and set.
    const db = createClient({ url: ydocDb.url, authToken: ydocDb.authToken })
    const totals = mapResultSet.mapResultSet(
      await db.execute(
        `select completed, count(*) as count from todo group by completed`
      )
    )
    console.log({ ydocDb, totals })
    doc.transact(() => {
      ydocDb.total = totals.map((row) => row.count).reduce((a, b) => a + b, 0)
      ydocDb.completed = totals.find((row) => row.completed === 1)?.count || 0
      ydocDb.updatedAt = new Date().toJSON()
      dbs.set(dbName, ydocDb)
    })
    console.log({ totals })
    res.send(`ok`)
  }
})

const wsServer = new WebSocketServer({ noServer: true })
wsServer.on(`connection`, setupWSConnection)

let port = 3000
if (process.env.NODE_ENV === `production`) {
  port = 4000
}

const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`)
  const doc = getYDoc(`app-doc`)
  console.log(`got doc`)
  listen.listen({ doc, serverConfig: serverConfig({ dbsDir }) })
})

server.on(`upgrade`, (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, (socket) => {
    wsServer.emit(`connection`, socket, request)
  })
})

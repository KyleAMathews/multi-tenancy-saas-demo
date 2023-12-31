import cors from "cors"
import path from "path"
import express from "express"
import { WebSocketServer } from "ws"
import { fileURLToPath } from "url"
import fs from "fs-extra"
import { setupWSConnection, getYDoc } from "situated"
import listen from "../machines/server"
import { mapResultSet } from "./map-sqlite-resultset"
import Parser from "node-sql-parser"
import { serverConfig } from "./mutators"
import { createClient } from "@libsql/client"
import { adapter } from "trpc-yjs/adapter"
import { appRouter } from "./trpc"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const baseDir =
  process.env.BASE_DATA_DIR || path.resolve(process.cwd(), `.cache`)
const file = path.join(baseDir, `db.json`)
const dbsDir = path.join(baseDir, `dbs`)
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
app.use(`/`, express.static(path.join(__dirname, `./dist`)))

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
    const totals = mapResultSet(
      await db.execute(
        `select completed, count(*) as count from todo group by completed`
      )
    )
    doc.transact(() => {
      ydocDb.total = totals.map((row) => row.count).reduce((a, b) => a + b, 0)
      ydocDb.completed = totals.find((row) => row.completed === 1)?.count || 0
      ydocDb.updatedAt = new Date().toJSON()
      dbs.set(dbName, ydocDb)
    })
    res.send(`ok`)
  }
})

const wsServer = new WebSocketServer({ noServer: true })
wsServer.on(`connection`, setupWSConnection)

const port = 3000

const server = app.listen(port, async () => {
  console.log(`API listening on port ${port}`)
  const doc = getYDoc(`app-doc`)
  console.log(`got doc`)
  // const { context, mutators } = serverConfig({
  // adminUrl: process.env.TURSO_URL,
  // adminAuthToken: process.env.TURSO_ADMIN_DB_AUTH_TOKEN,
  // })

  // console.log({ db: context.adminDb })

  const adminDb = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_ADMIN_DB_AUTH_TOKEN,
  })
  const dbsResult = mapResultSet(await adminDb.execute(`select * from dbs`))

  const dbs = doc.getMap(`dbs`)
  dbsResult.map((db) => {
    const yjsDb = dbs.has(db.name) ? dbs.get(db.name) : {}
    const combined = { ...db, ...yjsDb }
    dbs.set(combined.name, combined)
  })

  // Start adapter
  console.log(`starting the adapter`)
  adapter({
    doc,
    appRouter,
    context: { doc, adminDb },
    onError: (e) => console.log(`error`, e),
  })

  // listen.listen({
  // doc,
  // serverConfig: { context, mutators },
  // })
})

server.on(`upgrade`, (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head, (socket) => {
    wsServer.emit(`connection`, socket, request)
  })
})

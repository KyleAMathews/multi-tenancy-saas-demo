import { beforeAll, afterAll, describe, expect, test } from "vitest"
import * as Y from "yjs"
import fs from "fs"
import path from "path"
import { listen } from "../machines/server"
import { createRequest } from "../machines/client"
import { serverConfig } from "./mutators"
import * as util from "node:util"
import * as child_process from "node:child_process"

const execAsync = util.promisify(child_process.exec)

let tmpDir: string = ``
let doc
let adminDb
beforeAll(async () => {
  const dirName =
    `test-` + Date.now() + `-` + Math.random().toString(36).substring(2, 7)
  tmpDir = path.join(`/tmp`, dirName)

  try {
    // Create the directory synchronously
    fs.mkdirSync(tmpDir)
  } catch (err) {
    console.error(`Failed to create directory:`, err)
  }

  doc = new Y.Doc()

  const adminDbCredentials = {
    url: `libsql://todos-saas-admin-kyleamathews.turso.io`,
    authToken: `eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE2OTU2Nzg1MjksImlkIjoiM2JjODcxMDgtNWJlZC0xMWVlLTkwOWItNTIxZDZkZmM4M2VmIn0.ARL4cjEOTRD3J-aQET9nOILCgNr9TE6diAV-Rxv-eWWl0P1cmIuuPVxoBFH32pGJKyM03yL3H-Tnq52VXpQwDA`,
  }

  const { context, mutators } = serverConfig({
    adminUrl: adminDbCredentials.url,
    adminAuthToken: adminDbCredentials.authToken,
  })
  console.log({ mutators })

  adminDb = context.adminDb
  // await adminDb.execute(`CREATE TABLE dbs (
  // url TEXT PRIMARY KEY NOT NULL,
  // authToken TEXT NOT NULL,
  // state TEXT NOT NULL,
  // name TEXT NOT NULL,
  // updatedAt TEXT NOT NULL
  // );
  // `)
  listen({
    doc,
    serverConfig: { mutators },
  })
})

// Cleanup
afterAll(async () => {
  let hasDb = true
  try {
    await execAsync(`turso db list | grep foo`)
  } catch (e) {
    console.log(e)
    hasDb = false
  }
  if (hasDb) {
    const destroyOutput = await execAsync(`turso db destroy foo --yes`)
    console.log({ destroyOutput })
  }

  fs.rmSync(tmpDir, { recursive: true })
})

test(`update a robot name`, async () => {
  const doc = new Y.Doc()

  const robots = doc.getMap(`robots`)
  const robotId = `123`
  robots.set(robotId, { id: robotId, name: `boop` })

  // Config that gets new requests & calls right function.
  const serverConfig = {
    mutators: {
      updateRobotName: async function ({ state, doc }) {
        await new Promise((resolve) => setTimeout(resolve, 3))
        // Async work first and then return func w/ any sync changes.
        return function () {
          const robots = doc.getMap(`robots`)
          const robot = robots.get(state.request.id)
          robot.name = state.request.name
          robots.set(state.request.id, robot)
          return { ok: true }
        }
      },
    },
  }

  listen({ doc, serverConfig })

  let newName = `beep`
  const requestObject = await createRequest({
    doc,
    mutator: `updateRobotName`,
    request: { id: robotId, name: newName },
  })

  const { id, clientCreate, serverResponded, ...toSnapshot } = requestObject
  expect(toSnapshot).toMatchSnapshot()
  expect(requestObject.done).toBeTruthy()
  expect(robots.get(requestObject.request.id).name).toEqual(newName)

  newName = `boop`
  const requestObject2 = await createRequest({
    doc,
    mutator: `updateRobotName`,
    request: { id: robotId, name: newName },
  })

  expect(robots.get(requestObject2.request.id).name).toEqual(newName)
})

function makeid(length) {
  let result = ``
  const characters = `abcdefghijklmnopqrstuvwxyz0123456789`
  const charactersLength = characters.length
  let counter = 0
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
    counter += 1
  }
  return result
}
describe(`serverConfig`, () => {
  const dbName = `foo-${makeid(3)}`
  const cloneDbName = `${dbName}-clone`
  test(`createDb`, async () => {
    const requestObject = await createRequest({
      doc,
      mutator: `createDb`,
      request: { name: dbName },
    })

    console.log({ requestObject })
    expect(requestObject.response.name).toEqual(dbName)

    expect(Object.keys(requestObject.response)).toMatchSnapshot()
    expect(Object.keys(doc.getMap(`dbs`).get(dbName))).toMatchSnapshot()
    expect(doc.getMap(`dbs`).get(dbName).completed).toEqual(0)
    expect(doc.getMap(`dbs`).get(dbName).total).toEqual(1)

    const result = await adminDb.execute({
      sql: `SELECT * from dbs where name=:name`,
      args: { name: dbName },
    })
    expect(result.rows.length).toEqual(1)
    expect(result.rows[0][3]).toEqual(dbName)
  }, 10000)
  test(`clone`, async () => {
    const requestObject = await createRequest({
      doc,
      mutator: `createDb`,
      request: { name: cloneDbName, fromDb: dbName },
    })

    console.log({ requestObject })
    expect(requestObject.response.name).toEqual(cloneDbName)

    expect(Object.keys(requestObject.response)).toMatchSnapshot()
    expect(Object.keys(doc.getMap(`dbs`).get(cloneDbName))).toMatchSnapshot()

    const result = await adminDb.execute({
      sql: `SELECT * from dbs where name=:name`,
      args: { name: dbName },
    })
    expect(result.rows.length).toEqual(1)
    expect(result.rows[0][3]).toEqual(dbName)
  }, 10000)
  test(`deleteDb`, async () => {
    const requestObject = await createRequest({
      doc,
      mutator: `deleteDb`,
      request: { name: dbName },
    })
    const requestObject2 = await createRequest({
      doc,
      mutator: `deleteDb`,
      request: { name: cloneDbName },
    })
    console.log({
      requestObject: requestObject.response,
      requestObject2: requestObject2.response,
    })

    expect(requestObject.response.name).toEqual(dbName)
    expect(Object.keys(requestObject.response)).toMatchSnapshot()
    expect(fs.existsSync(requestObject.response.dbPath)).toBeFalsy()

    const result = await adminDb.execute({
      sql: `SELECT * from dbs where name=:name`,
      args: { name: dbName },
    })
    expect(result.rows.length).toEqual(0)
  })
})

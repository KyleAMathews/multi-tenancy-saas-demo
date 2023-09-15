import { expect, test } from "bun:test"
import * as Y from "yjs"
import fs from "fs"
import path from "path"
import Database from "libsql"
const { Parser } = require(`node-sql-parser`)
const parser = new Parser()

import { listen } from "./server"
import { createRequest } from "./client"

test(`update a robot name`, async () => {
  // const { machine } = require(`./ping-pong`)

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

  // Server instantiation
  // listen(doc, serverConfig)
  //
  // client instantiation
  // hmm just call createRequest({doc, mutator, request})

  // Client code
  // TODO
  // - create an id so can await it coming back — haha there's a generic
  // state machine for a client to run a client/server state machine. You pass in
  // machine and the initial state and then off it goes and you just await
  // it finishing. That handles creating a uuid and awaiting it to come back
  // updated.
  //
  // Or I guess it's a sort of abstraction for "I advanced this state machine as far as I can
  // and now I'm tossing it to the network for the next node to change". So await a change to the machine.
  //
  // Run a state machine until you hit a point that you want to serialize and it for
  // running on the server and then pick it back up again when it comes back.
  //
  // Basically a job though I guess mutation is more generic.
  //
  // I'm not sure xstate is needed here — just do what I did in the post really...
  //
  // xstate would be great for more complex stuff but probably just an object w/ some
  // validation is enough.
  //
  //
  // TODO add helper function to generate the request & await the response.
  // Server function which does the mutation on the doc.
  // switch to updateName
  let newName = `beep`
  const requestObject = await createRequest({
    doc,
    mutator: `updateRobotName`,
    request: { id: robotId, name: newName },
  })

  const { id, clientCreate, serverResponded, ...toSnapshot } = requestObject
  expect(toSnapshot).toMatchSnapshot()
  expect(requestObject.done).toBeTrue()
  expect(robots.get(requestObject.request.id).name).toEqual(newName)

  newName = `boop`
  const requestObject2 = await createRequest({
    doc,
    mutator: `updateRobotName`,
    request: { id: robotId, name: newName },
  })

  expect(robots.get(requestObject2.request.id).name).toEqual(newName)
})

test(`create/delete dbs`, async () => {
  const doc = new Y.Doc()

  const dbs = doc.getMap(`dbs`)

  // Generate a random directory name
  const dirName =
    `test-` + Date.now() + `-` + Math.random().toString(36).substring(2, 7)
  const dirPath = path.join(`/tmp`, dirName)

  try {
    // Create the directory synchronously
    fs.mkdirSync(dirPath)
  } catch (err) {
    console.error(`Failed to create directory:`, err)
  }

  async function setupDb(dbPath) {
    const db = new Database(dbPath)
    db.exec(
      `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`
    )
    db.exec(
      `INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.org')`
    )
  }

  // Config that gets new requests & calls right function.
  const serverConfig = {
    mutators: {
      createDb: async function ({ state, doc }) {
        const dbs = doc.getMap(`dbs`)
        if (dbs.has(state.request.name)) {
          return function () {
            return { error: `DB Already exists` }
          }
        }
        const dbPath = path.join(dirPath, `${state.request.name}.db`)
        if (fs.existsSync(dbPath)) {
          return function () {
            return {
              error: `DB Already exists on disk (though oddly not in the map)`,
            }
          }
        }

        await setupDb(dbPath)
        // Async work first and then return func w/ any sync changes.
        // Validate db doesn't exist in both yjs and on disk.
        // Then create db and create table.
        //
        // TODO also a test to run queries.
        return function () {
          dbs.set(state.request.name, { foo: true })
          return { dbPath }
        }
      },
      deleteDb: async function ({ state, doc }) {
        const dbPath = path.join(dirPath, `${state.request.name}.db`)
        fs.unlinkSync(dbPath)
        // Async work first and then return func w/ any sync changes.
        return function () {
          const dbs = doc.getMap(`dbs`)
          dbs.delete(state.request.name)
          return { ok: true }
        }
      },
      selectDb: async function ({ state, doc }) {
        const dbPath = path.join(dirPath, `${state.request.name}.db`)
        const db = new Database(dbPath)
        const ast = parser.astify(state.request.sql)
        if (ast.type === `select`) {
          const results = db.prepare(state.request.sql).all()
          // Async work first and then return func w/ any sync changes.
          return function () {
            return { ok: true, results }
          }
        } else {
          return function () {
            return { error: `Only select operations are allowed` }
          }
        }
      },
    },
  }

  listen({ doc, serverConfig })

  // Test creating a db.
  const requestObject = await createRequest({
    doc,
    mutator: `createDb`,
    request: { name: `foo` },
  })

  expect(dbs.get(`foo`)).toMatchSnapshot()

  // Test duplicate returns an error.
  const dupRequestObject = await createRequest({
    doc,
    mutator: `createDb`,
    request: { name: `foo` },
  })

  expect(dupRequestObject.error).toBeTrue()

  // Test running a valid and then invalid query.
  const selectReq = await createRequest({
    doc,
    mutator: `selectDb`,
    request: { name: `foo`, sql: `select * from users` },
  })

  expect(selectReq.response.results).toMatchSnapshot()

  const insertReq = await createRequest({
    doc,
    mutator: `selectDb`,
    request: {
      name: `foo`,
      sql: `INSERT INTO users (id, name, email) VALUES (2, 'Alice', 'alice@example.org')`,
    },
  })

  expect(insertReq.error).toBeTrue()

  // Test deleting a db.
  await createRequest({
    doc,
    mutator: `deleteDb`,
    request: { name: `foo` },
  })

  expect(dbs.has(`foo`)).toBeFalse()
  expect(fs.existsSync(requestObject.response.dbPath)).toBeFalse()
})

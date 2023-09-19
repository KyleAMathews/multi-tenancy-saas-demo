import { beforeAll, afterAll, describe, expect, test } from "vitest"
import * as Y from "yjs"
import fs from "fs"
import path from "path"
import Database from "libsql"
import { listen } from "../machines/server"
import { createRequest } from "../machines/client"
import { serverConfig } from "./mutators"
import * as util from "node:util"
import * as child_process from "node:child_process"

const execAsync = util.promisify(child_process.exec)

let tmpDir: string = ``
let doc
beforeAll(async () => {
  const dirName =
    `test-` + Date.now() + `-` + Math.random().toString(36).substring(2, 7)
  tmpDir = path.join(`/tmp`, dirName)

  doc = new Y.Doc()
  try {
    // Create the directory synchronously
    fs.mkdirSync(tmpDir)
  } catch (err) {
    console.error(`Failed to create directory:`, err)
  }
  listen({ doc, serverConfig: serverConfig({ dbsDir: tmpDir }) })
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

describe(`serverConfig`, () => {
  test(`createDb`, async () => {
    const requestObject = await createRequest({
      doc,
      mutator: `createDb`,
      request: { name: `foo` },
    })

    console.log({ requestObject })
    expect(requestObject.response.name).toEqual(`foo`)

    expect(Object.keys(requestObject.response)).toMatchSnapshot()
    expect(Object.keys(doc.getMap(`dbs`).get(`foo`))).toMatchSnapshot()
    expect(doc.getMap(`dbs`).get(`foo`).completed).toEqual(0)
    expect(doc.getMap(`dbs`).get(`foo`).total).toEqual(1)
  }, 10000)
  test(`deleteDb`, async () => {
    const requestObject = await createRequest({
      doc,
      mutator: `deleteDb`,
      request: { name: `foo` },
    })
    console.log({ requestObject })

    expect(requestObject.response.name).toEqual(`foo`)
    expect(Object.keys(requestObject.response)).toMatchSnapshot()
    expect(fs.existsSync(requestObject.response.dbPath)).toBeFalsy()
  })
})

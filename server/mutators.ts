import path from "path"
import Parser from "node-sql-parser"
import fs from "fs-extra"
import { createClient } from "@libsql/client"
const parser = new Parser.Parser()
import * as util from "node:util"
import * as child_process from "node:child_process"
import { mapResultSet } from "./map-sqlite-resultset"
import { ProfanityEngine } from "@coffeeandfun/google-profanity-words"
const profanity = new ProfanityEngine()

const execAsync = util.promisify(child_process.exec)

async function setupDb(db) {
  await db.execute(`CREATE TABLE Todo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL CHECK (completed IN (0, 1))
);`)
  await db.execute(
    `INSERT INTO Todo (title, completed) VALUES ('Go to Grocery Store', 0)`
  )
}

export const serverConfig = ({ adminUrl, adminAuthToken }) => {
  // Create the admin db
  const adminDb = createClient({
    url: adminUrl,
    authToken: adminAuthToken,
  })
  return {
    context: {
      adminDb,
    },
    mutators: {
      ping: async function ({ state, doc }) {
        return function () {
          return { ok: true, request: state.request }
        }
      },
      createDb: async function ({ state, doc }) {
        // Validate app/db name
        const regex = /^[a-zA-Z0-9-_]{1,27}$/
        if (!regex.test(state.request.name)) {
          console.log({
            name: state.request.name,
            test: regex.test(state.request.name),
          })
          return function () {
            return {
              error: `App names must not contain spaces or special characters and be less than 28 characters`,
            }
          }
        }

        const dbs = doc.getMap(`dbs`)
        if (dbs.has(state.request.name)) {
          return function () {
            return { error: `DB Already exists` }
          }
        }

        const isProfane = await profanity.hasCurseWords(
          state.request.name.split(`-`).join(` `).split(`_`).join(` `)
        )
        if (isProfane) {
          return function () {
            return { error: `Profane db names are not allowed.` }
          }
        }

        let createOutput
        let urlOutput
        let tokenOutput
        dbs.set(state.request.name, {
          name: state.request.name,
          state: `INITIALIZING`,
          updatedAt: new Date().toJSON(),
        })
        let command = `turso db create --group demo-multi-tenant-saas ${state.request.name}`
        if (state.request.fromDb) {
          command += ` --from-db=${state.request.fromDb}`
        }
        try {
          createOutput = await execAsync(command)
          dbs.set(state.request.name, {
            name: state.request.name,
            state: `CREATED`,
            updatedAt: new Date().toJSON(),
          })
          urlOutput = await execAsync(
            `turso db show ${state.request.name} --url`
          )
          tokenOutput = await execAsync(
            `turso db tokens create ${state.request.name}`
          )
          dbs.set(state.request.name, {
            name: state.request.name,
            state: `CREATING TABLES`,
            updatedAt: new Date().toJSON(),
          })
        } catch (e) {
          console.log(e)
          return function () {
            return { error: e }
          }
        }
        console.log({ createOutput, urlOutput, tokenOutput })

        const url = urlOutput.stdout.trim()
        const authToken = tokenOutput.stdout.trim()
        console.log({ url, authToken })

        const db = createClient({ url, authToken })

        // Don't need to do setup for cloned dbs.
        if (!state.request.fromDb) {
          await setupDb(db)
        }
        // Async work first and then return func w/ any sync changes.
        // Validate db doesn't exist in both yjs and on disk.
        // Then create db and create table.
        //
        // TODO also a test to run queries.
        const updatedAt = new Date().toJSON()
        await adminDb.execute({
          sql: `INSERT INTO dbs values (:url, :authToken, :state, :name, :updatedAt)`,
          args: {
            url,
            authToken,
            state: `READY`,
            name: state.request.name,
            updatedAt,
          },
        })

        const totals = mapResultSet(
          await db.execute(
            `select completed, count(*) as count from Todo group by completed`
          )
        )
        console.log({ totals })

        return function () {
          dbs.set(state.request.name, {
            url,
            authToken,
            state: `READY`,
            name: state.request.name,
            total: totals.map((row) => row.count).reduce((a, b) => a + b, 0),
            completed: totals.find((row) => row.completed === 1)?.count || 0,
            updatedAt,
          })
          return { url, name: state.request.name }
        }
      },
      deleteDb: async function ({ state, doc }) {
        const dbs = doc.getMap(`dbs`)
        if (!dbs.has(state.request.name)) {
          return function () {
            return {
              error: `DB with the name ${state.request.name} doesn't exists`,
            }
          }
        }

        let destroyOutput
        try {
          destroyOutput = await execAsync(
            `turso db destroy ${state.request.name} --yes`
          )
        } catch (e) {
          console.log(e)
          return function () {
            return { error: e }
          }
        }

        await adminDb.execute({
          sql: `DELETE FROM dbs WHERE name=:name`,
          args: {
            name: state.request.name,
          },
        })

        return function () {
          dbs.delete(state.request.name)
          return { name: state.request.name }
        }
      },
      selectDb: async function ({ state, doc }) {
        try {
          const dbInfo = doc.getMap(`dbs`).get(state.request.name)
          const db = createClient({
            url: dbInfo.url,
            authToken: dbInfo.authToken,
          })
          const ast = parser.astify(state.request.sql)
          if (ast.type === `select`) {
            console.log(`query`, state.request.sql)
            const results = mapResultSet(await db.execute(state.request.sql))
            // Async work first and then return func w/ any sync changes.
            return function () {
              return {
                ok: true,
                results,
              }
            }
          } else {
            return function () {
              return { error: `Only select operations are allowed` }
            }
          }
        } catch (e) {
          console.log(e)
          return function () {
            return { error: e }
          }
        }
      },
    },
  }
}

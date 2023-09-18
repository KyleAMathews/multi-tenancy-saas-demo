import path from "path"
import Parser from "node-sql-parser"
import fs from "fs-extra"
import { getDb } from "./get-db"
const parser = new Parser.Parser()

async function setupDb(db) {
  db.exec(`CREATE TABLE Todo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL CHECK (completed IN (0, 1))
);`)
  db.exec(
    `INSERT INTO Todo (title, completed) VALUES ('Go to Grocery Store', 0)`
  )
}
function deleteDb(dbPath) {
  return fs.unlinkSync(dbPath)
}

export const serverConfig = ({ dbsDir }) => {
  return {
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
        const dbPath = path.join(dbsDir, `${state.request.name}.db`)
        if (fs.existsSync(dbPath)) {
          return function () {
            return {
              error: `DB Already exists on disk (though oddly not in the map)`,
            }
          }
        }

        const db = getDb(dbsDir, state.request.name)
        await setupDb(db)
        // Async work first and then return func w/ any sync changes.
        // Validate db doesn't exist in both yjs and on disk.
        // Then create db and create table.
        //
        // TODO also a test to run queries.
        return function () {
          dbs.set(state.request.name, {
            dbPath,
            name: state.request.name,
            total: 1,
            completed: 0,
          })
          return { dbPath, name: state.request.name }
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
        const dbPath = path.join(dbsDir, `${state.request.name}.db`)
        if (!fs.existsSync(dbPath)) {
          return function () {
            return {
              error: `DB doesn't exist on disk`,
            }
          }
        }

        deleteDb(dbPath)
        return function () {
          dbs.delete(state.request.name)
          return { dbPath, name: state.request.name }
        }
      },
      selectDb: async function ({ state }) {
        try {
          const db = getDb(dbsDir, state.request.name)
          const ast = parser.astify(state.request.sql)
          if (ast.type === `select`) {
            console.log(`query`, state.request.sql)
            let results
            results = db.prepare(state.request.sql).all()
            // Async work first and then return func w/ any sync changes.
            return function () {
              return { ok: true, results }
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

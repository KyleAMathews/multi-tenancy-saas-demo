import { initTRPC, TRPCError } from "@trpc/server"
import { z } from "zod"
import Parser from "node-sql-parser"
import { createClient } from "@libsql/client"
import * as util from "node:util"
import * as child_process from "node:child_process"
import { mapResultSet } from "./map-sqlite-resultset"
import { ProfanityEngine } from "@coffeeandfun/google-profanity-words"
const profanity = new ProfanityEngine()
console.log(Parser)
const parser = new Parser.Parser()

const execAsync = util.promisify(child_process.exec)

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.create()
/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
const router = t.router
const publicProcedure = t.procedure

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

export const appRouter = router({
  ping: publicProcedure.mutation(async () => {
    return {
      transact: () => {
        true
      },
    }
  }),
  createDb: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .regex(/^[a-zA-Z0-9-_]{1,27}$/, {
            message: `App name must not contain spaces or special characters`,
          })
          .max(28, { message: `App name must be 28 characters or less` })
          .min(3),
        fromDb: z.string().min(3).optional(),
      })
    )
    .mutation(async function ({ input, ctx: { doc, adminDb, transact } }) {
      const dbs = doc.getMap(`dbs`)
      if (dbs.has(input.name)) {
        throw new TRPCError({
          code: `CONFLICT`,
          message: `A db by this name already exists`,
        })
      }

      const isProfane = await profanity.hasCurseWords(
        input.name.split(`-`).join(` `).split(`_`).join(` `)
      )
      if (isProfane) {
        throw new TRPCError({
          code: `BAD_REQUEST`,
          message: `Profane db names are now allowed.`,
        })
      }

      let createOutput
      let urlOutput
      let tokenOutput
      dbs.set(input.name, {
        name: input.name,
        state: `INITIALIZING`,
        updatedAt: new Date().toJSON(),
      })
      let command = `turso db create --group demo-multi-tenant-saas ${input.name}`
      if (input.fromDb) {
        command += ` --from-db=${input.fromDb}`
      }
      try {
        createOutput = await execAsync(command)
        dbs.set(input.name, {
          name: input.name,
          state: `CREATED`,
          updatedAt: new Date().toJSON(),
        })
        urlOutput = await execAsync(`turso db show ${input.name} --url`)
        tokenOutput = await execAsync(`turso db tokens create ${input.name}`)
        dbs.set(input.name, {
          name: input.name,
          state: `CREATING TABLES`,
          updatedAt: new Date().toJSON(),
        })
      } catch (e) {
        console.log(e)
        dbs.delete(input.name)
        throw new TRPCError({
          code: `INTERNAL_SERVER_ERROR`,
          message: `Error creating database or tables`,
          cause: e,
        })
      }
      console.log({ createOutput, urlOutput, tokenOutput })

      const url = urlOutput.stdout.trim()
      const authToken = tokenOutput.stdout.trim()
      console.log({ url, authToken })

      const db = createClient({ url, authToken })

      // Don't need to do setup for cloned dbs.
      if (!input.fromDb) {
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
          name: input.name,
          updatedAt,
        },
      })

      const totals = mapResultSet(
        await db.execute(
          `select completed, count(*) as count from Todo group by completed`
        )
      )
      console.log({ totals })

      transact(() => {
        dbs.set(input.name, {
          url,
          authToken,
          state: `READY`,
          name: input.name,
          total: totals.map((row) => row.count).reduce((a, b) => a + b, 0),
          completed: totals.find((row) => row.completed === 1)?.count || 0,
          updatedAt,
        })
      })

      return { url, name: input.name }
      // return function () {
      // dbs.set(input.name, {
      // url,
      // authToken,
      // state: `READY`,
      // name: input.name,
      // total: totals.map((row) => row.count).reduce((a, b) => a + b, 0),
      // completed: totals.find((row) => row.completed === 1)?.count || 0,
      // updatedAt,
      // })
      // return { url, name: input.name }
      // }
    }),
  deleteDb: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async function ({ input, ctx: { doc, adminDb, transact } }) {
      const dbs = doc.getMap(`dbs`)
      if (!dbs.has(input.name)) {
        return function () {
          return {
            error: `DB with the name ${input.name} doesn't exists`,
          }
        }
      }

      let destroyOutput
      try {
        destroyOutput = await execAsync(`turso db destroy ${input.name} --yes`)
      } catch (e) {
        console.log(e)
        return function () {
          return { error: e }
        }
      }

      await adminDb.execute({
        sql: `DELETE FROM dbs WHERE name=:name`,
        args: {
          name: input.name,
        },
      })

      transact(() => {
        dbs.delete(input.name)
      })

      return input.name
    }),
  selectDb: publicProcedure
    .input(z.object({ name: z.string(), sql: z.string() }))
    .query(async function ({ input, ctx: { doc } }) {
      try {
        const dbInfo = doc.getMap(`dbs`).get(input.name)
        const db = createClient({
          url: dbInfo.url,
          authToken: dbInfo.authToken,
        })
        const ast = parser.astify(input.sql)
        if (ast.type === `select`) {
          const results = mapResultSet(await db.execute(input.sql))
          // Async work first and then return func w/ any sync changes.
          return {
            ok: true,
            results,
          }
        } else {
          throw new TRPCError({
            code: `BAD_REQUEST`,
            message: `Only select operations are allowed`,
          })
        }
      } catch (e) {
        console.log(e)
        throw new TRPCError({
          code: `INTERNAL_SERVER_ERROR`,
          cause: e,
        })
      }
    }),
})
// userUpdateName: publicProcedure
// .input(z.object({ id: z.string(), name: z.string() }))
// .mutation(async (opts) => {
// const {
// input,
// ctx: { users },
// } = opts
// let user
// let id
// users.forEach((u, i) => {
// if (u.id === input.id) {
// user = u
// id = i
// }
// })
// const newUser = { ...user, name: input.name }
// return {
// mutations: () => {
// users.delete(id, 1)
// users.insert(id, [newUser])
// },
// response: newUser,
// }
// }),
// })

export type AppRouter = typeof appRouter

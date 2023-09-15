import { sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"

export const users = sqliteTable(`users`, {
  id: integer(`id`).primaryKey(),
  name: text(`name`).notNull(),
  email: text(`email`).notNull(),
  createdAt: integer(`created_at`, { mode: `timestamp` }).default(
    sql`(strftime('%s', 'now'))`
  ),
})
export const insertUserSchema = createInsertSchema(users)
export const selectUserSchema = createSelectSchema(users)

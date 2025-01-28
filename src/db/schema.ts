import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phoneNumber: text("phone_number").notNull().unique(),
  apiId: integer("api_id").notNull(),
  apiHash: text("api_hash").notNull(),
  sessionString: text("session_string"),
  apiKey: text("api_key").unique(),
  phoneCodeHash: text("phone_code_hash"),
  webhookUrl: text("webhook_url"),
  webhookSecret: text("webhook_secret"),
  updateMode: text("update_mode", { enum: ["webhook", "polling", "none"] }).default("none"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

import type { Context, Next } from "hono";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export async function authMiddleware(c: Context, next: Next) {
  // Try bearer token first
  const authHeader = c.req.header("Authorization");
  let apiKey: string | null = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  // Fall back to query param
  if (!apiKey) {
    apiKey = c.req.query("api_key") || null;
  }
  
  if (!apiKey) {
    return c.json({ 
      error: "Unauthorized", 
      message: "API key is required. Provide it as a Bearer token or api_key query parameter" 
    }, 401);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.apiKey, apiKey),
  });

  if (!user) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  // Add user to context for use in routes
  c.set("user", user);
  
  await next();
}

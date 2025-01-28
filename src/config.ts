import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_API_ID: z.string().transform(Number),
  TELEGRAM_API_HASH: z.string(),
  PORT: z.string().transform(Number).default("3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data; 
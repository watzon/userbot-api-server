import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { apiReference } from "@scalar/hono-api-reference";
import { openAPISpecs } from 'hono-openapi';
import { telegramService } from "./services/telegram";
import { auth, messages, updates, user } from "./routes";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());

// Swagger UI
app.get(
  '/docs',
  apiReference({
    theme: 'saturn',
    spec: { url: '/openapi' },
    layout: 'modern',
  })
);

app.get(
  '/openapi',
  openAPISpecs(app, {
    documentation: {
      info: { 
        title: 'Telegram Userbot API', 
        version: '1.0.0', 
        description: 'API for managing Telegram userbots' 
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local Server' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "API Key",
            description: "Enter your API key as a Bearer token",
          },
          apiKeyQuery: {
            type: "apiKey",
            name: "api_key",
            in: "query",
            description: "Enter your API key as a query parameter",
          },
        },
      },
      security: [
        { bearerAuth: [] },
        { apiKeyQuery: [] },
      ],
    },
  })
);

// Mount API routes
app.route("/", auth);
app.route("/", messages);
app.route("/", updates);
app.route("/", user);

// Error handling
app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({
    error: "Internal Server Error",
    message: err.message
  }, 500);
});

// Not found handling
app.notFound((c) => {
  return c.json({
    error: "Not Found",
    message: "The requested resource was not found"
  }, 404);
});

const port = process.env.PORT || 3000;
console.log(`Server is running on port ${port}`);

// Handle cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await telegramService.disconnectAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await telegramService.disconnectAll();
  process.exit(0);
});

export default {
  port: Number(port),
  fetch: app.fetch,
};

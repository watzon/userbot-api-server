import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { z } from "zod";
import { telegramService } from "../services/telegram";
import { SetWebhookSchema, DeleteWebhookSchema, GetUpdatesSchema } from "../types";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";

const updates = new Hono();

updates.use("*", authMiddleware);

// Set webhook
updates.post(
    "/setWebhook",
    describeRoute({
      description: "Set a webhook for receiving updates",
      tags: ["Updates"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: resolver(SetWebhookSchema),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Webhook set successfully",
          content: {
            "application/json": {
              schema: resolver(z.object({
                status: z.literal("success"),
              })),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(z.object({
                error: z.string(),
                message: z.string(),
              })),
            },
          },
        },
      },
    }),
    zValidator("json", SetWebhookSchema),
    async (c) => {
    const { url, secret } = c.req.valid("json");
    const user = c.get("user");
  
    await telegramService.setWebhook(user, url, secret);
    return c.json({ status: "success" });
  });
  
  // Delete webhook
  updates.post(
    "/deleteWebhook",
    describeRoute({
      description: "Delete the currently set webhook",
      tags: ["Updates"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: resolver(DeleteWebhookSchema),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Webhook deleted successfully",
          content: {
            "application/json": {
              schema: resolver(z.object({
                status: z.literal("success"),
              })),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(z.object({
                error: z.string(),
                message: z.string(),
              })),
            },
          },
        },
      },
    }),
    zValidator("json", DeleteWebhookSchema),
    async (c) => {
    const { dropPendingUpdates } = c.req.valid("json");
    const user = c.get("user");
  
    await telegramService.deleteWebhook(user, dropPendingUpdates);
    return c.json({ status: "success" });
  });
  
  // Get webhook info
  updates.get(
    "/getWebhookInfo",
    describeRoute({
      description: "Get information about the current webhook",
      tags: ["Updates"],
      responses: {
        200: {
          description: "Webhook information retrieved successfully",
          content: {
            "application/json": {
              schema: resolver(z.object({
                url: z.string(),
                has_custom_certificate: z.boolean(),
                pending_update_count: z.number(),
                last_error_date: z.null(),
                last_error_message: z.null(),
                max_connections: z.number(),
                ip_address: z.null(),
              })),
            },
          },
        },
      },
    }),
    async (c) => {
    const user = c.get("user");
  
    return c.json({
      url: user.webhookUrl || "",
      has_custom_certificate: false,
      pending_update_count: 0, // You might want to implement this
      last_error_date: null,
      last_error_message: null,
      max_connections: 40,
      ip_address: null
    });
  });
  
  // Get updates (polling)
  updates.post(
    "/getUpdates",
    describeRoute({
      description: "Get updates using long polling",
      tags: ["Updates"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: resolver(GetUpdatesSchema),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Updates retrieved successfully",
          content: {
            "application/json": {
              schema: resolver(z.array(z.any())), // You might want to define a more specific schema for updates
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(z.object({
                error: z.string(),
                message: z.string(),
              })),
            },
          },
        },
      },
    }),
    zValidator("json", GetUpdatesSchema),
    async (c) => {
    const { offset, limit, timeout } = c.req.valid("json");
    const user = c.get("user");
  
    const updates = await telegramService.getUpdates(user, offset, limit, timeout);
    return c.json(updates);
  });

export default updates;
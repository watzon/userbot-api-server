import { Hono } from "hono";
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { users, type User } from "../db/schema";
import { telegramService } from "../services/telegram";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { authMiddleware } from "../middleware/auth";
import { nanoid } from "nanoid";
import { config } from "../config";
import {
  LoginSchema,
  CodeConfirmationSchema,
  PasswordConfirmationSchema,
  SetWebhookSchema,
  DeleteWebhookSchema,
  GetUpdatesSchema,
} from "../types";
import { eq } from "drizzle-orm";

// Extend Hono's context type to include our user
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

const auth = new Hono();

// Login endpoint to start the authentication process
auth.post(
  "/login",
  describeRoute({
    description: "Start the Telegram authentication process",
    tags: ["Authentication"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(LoginSchema),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Authentication started successfully",
        content: {
          "application/json": {
            schema: resolver(z.object({
              status: z.enum(["waiting_code", "success"]),
              apiKey: z.string(),
            })),
          },
        },
      },
      500: {
        description: "Server error",
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
  zValidator("json", LoginSchema),
  async (c) => {
  const { phoneNumber } = c.req.valid("json");

  // Generate API key immediately
  const apiKey = nanoid(32);

  // Create or update user
  const [user] = await db.insert(users).values({
    phoneNumber,
    apiId: config.TELEGRAM_API_ID,
    apiHash: config.TELEGRAM_API_HASH,
    apiKey,
  }).onConflictDoUpdate({
    target: users.phoneNumber,
    set: { apiKey },
  }).returning();

  const client = await telegramService.getClient(user);
  await client.connect();
  
  try {
    // Send the code request
    const result = await client.invoke(new Api.auth.SendCode({
      phoneNumber: user.phoneNumber,
      apiId: user.apiId,
      apiHash: user.apiHash,
      settings: new Api.CodeSettings({
        allowFlashcall: false,
        currentNumber: true,
        allowAppHash: true,
        allowMissedCall: false,
      })
    }));
    
    switch (result.className) {
      case "auth.SentCode":
        // Store the phone code hash
        await db.update(users)
          .set({ phoneCodeHash: result.phoneCodeHash })
          .where(eq(users.phoneNumber, phoneNumber));

        return c.json({
          status: "waiting_code",
          apiKey
        });
      case "auth.SentCodeSuccess":
        return c.json({
          status: "success",
          apiKey
        });
    }
  } catch (error: any) {
    console.error('Error sending code:', error);
    return c.json({ 
      error: "Failed to send code",
      message: error.message 
    }, 500);
  }
});

// Protected routes
// Confirm login with code
auth.post(
  "/confirmCode",
  describeRoute({
    description: "Confirm login with verification code",
    tags: ["Authentication"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(CodeConfirmationSchema),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Code confirmation successful",
        content: {
          "application/json": {
            schema: resolver(z.object({
              status: z.enum(["success", "2fa_required"]),
              passwordInfo: z.any().optional(),
            })),
          },
        },
      },
      400: {
        description: "Invalid request",
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
  zValidator("json", CodeConfirmationSchema),
  async (c) => {
  const { code } = c.req.valid("json");
  const user = c.get("user");

  if (!user.phoneCodeHash) {
    return c.json({ 
      error: "Invalid state",
      message: "No verification code was sent. Please start the login process again."
    }, 400);
  }

  const client = await telegramService.getClient(user);
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: user.phoneNumber,
      phoneCode: code,
      phoneCodeHash: user.phoneCodeHash,
    }));

    // Save the session and clear the phone code hash
    const sessionString = telegramService.getSessionString(user.phoneNumber);
    if (sessionString) {
      await db.update(users)
        .set({ 
          sessionString,
          phoneCodeHash: null 
        })
        .where(eq(users.phoneNumber, user.phoneNumber));
    }

    return c.json({ status: "success" });
  } catch (error: any) {
    if (error.message === 'SESSION_PASSWORD_NEEDED') {
      // Get the password info
      const passwordInfo = await client.invoke(new Api.account.GetPassword());
      return c.json({ 
        status: "2fa_required",
        passwordInfo
      });
    }
    throw error;
  }
}).use(authMiddleware);

// Confirm login with 2FA password if needed
auth.post(
  "/confirmPassword",
  describeRoute({
    description: "Confirm login with 2FA password",
    tags: ["Authentication"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(PasswordConfirmationSchema),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Password confirmation successful",
        content: {
          "application/json": {
            schema: resolver(z.object({
              status: z.literal("success"),
            })),
          },
        },
      },
      500: {
        description: "Server error",
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
  zValidator("json", PasswordConfirmationSchema),
  async (c) => {
  const { password } = c.req.valid("json");
  const user = c.get("user");

  const client = await telegramService.getClient(user);
  
  try {
    // Get the current password info
    const passwordInfo = await client.invoke(new Api.account.GetPassword());
    
    // Compute the password check using the SRP protocol
    const passwordCheck = await computeCheck(passwordInfo, password);
    
    // Check the password
    await client.invoke(new Api.auth.CheckPassword({
      password: passwordCheck
    }));

    // Save the session
    const sessionString = telegramService.getSessionString(user.phoneNumber);
    if (sessionString) {
      await db.update(users)
        .set({ sessionString })
        .where(eq(users.phoneNumber, user.phoneNumber));
    }

    return c.json({ status: "success" });
  } catch (error: any) {
    console.error('Error checking password:', error);
    return c.json({ 
      error: "Failed to verify password",
      message: error.message 
    }, 500);
  }
}).use(authMiddleware);

export default auth;

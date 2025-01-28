import { z } from "zod";

export const LoginSchema = z.object({
  phoneNumber: z.string(),
});

export const CodeConfirmationSchema = z.object({
  code: z.string(),
});

export const PasswordConfirmationSchema = z.object({
  password: z.string(),
});

export const SendMessageSchema = z.object({
  peer: z.string(),
  message: z.string(),
});

export const SetWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
});

export const DeleteWebhookSchema = z.object({
  dropPendingUpdates: z.boolean().default(false),
});

export const GetUpdatesSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().min(1).max(100).default(100),
  timeout: z.number().min(0).max(50).default(0),
});

export type LoginRequest = z.infer<typeof LoginSchema>;
export type CodeConfirmationRequest = z.infer<typeof CodeConfirmationSchema>;
export type PasswordConfirmationRequest = z.infer<typeof PasswordConfirmationSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type SetWebhookRequest = z.infer<typeof SetWebhookSchema>;
export type DeleteWebhookRequest = z.infer<typeof DeleteWebhookSchema>;
export type GetUpdatesRequest = z.infer<typeof GetUpdatesSchema>;

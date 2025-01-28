import { Hono } from 'hono';
import { z } from 'zod';
import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { getClient } from '../services/telegram/client';
import type { User } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import "zod-openapi/extend"

const messages = new Hono();

// Apply auth middleware to all routes
messages.use(authMiddleware);

// Schema for sending a message
const sendMessageSchema = z.object({
    chat_id: z.string(),
    text: z.string(),
    parse_mode: z.enum(['html', 'markdown']).optional(),
    disable_web_page_preview: z.boolean().optional(),
    disable_notification: z.boolean().optional(),
    reply_to_message_id: z.number().optional(),
}).openapi({ ref: "SendMessage" });

// Schema for forwarding a message
const forwardMessageSchema = z.object({
    chat_id: z.string(),
    from_chat_id: z.string(),
    message_ids: z.union([z.number(), z.array(z.number())]),
    disable_notification: z.boolean().optional(),
}).openapi({ ref: "ForwardMessage" });

// Schema for deleting messages
const deleteMessageSchema = z.object({
    chat_id: z.string(),
    message_ids: z.union([z.number(), z.array(z.number())]),
}).openapi({ ref: "DeleteMessage" });

// Schema for editing a message
const editMessageSchema = z.object({
    chat_id: z.string(),
    message_id: z.number(),
    text: z.string(),
    parse_mode: z.enum(['html', 'markdown']).optional(),
    disable_web_page_preview: z.boolean().optional(),
}).openapi({ ref: "EditMessage" });

// Schema for pinning a message
const pinMessageSchema = z.object({
    chat_id: z.string(),
    message_id: z.number(),
    disable_notification: z.boolean().optional(),
});

// Response schemas
const messageResponseSchema = z.object({
    ok: z.boolean(),
    result: z.object({
        message_id: z.number(),
        date: z.number(),
    }),
}).openapi({ ref: "MessageResponse" });

const multipleMessageResponseSchema = z.object({
    ok: z.boolean(),
    result: z.array(z.object({
        message_id: z.number(),
        date: z.number(),
    })),
}).openapi({ ref: "MultipleMessageResponse" });

const successResponseSchema = z.object({
    ok: z.boolean(),
    result: z.boolean(),
}).openapi({ ref: "SuccessResponse" });

const errorResponseSchema = z.object({
    ok: z.boolean(),
    error_code: z.number(),
    description: z.string(),
}).openapi({ ref: "ErrorResponse" });

// Send a message
messages.post('/sendMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Send a new message to a chat',
        responses: {
            200: {
                description: 'Message sent successfully',
                content: {
                    'application/json': {
                        schema: resolver(messageResponseSchema),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', sendMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, text, parse_mode, disable_web_page_preview, disable_notification, reply_to_message_id } = c.req.valid('json');

        const result = await client.sendMessage(chat_id, {
            message: text,
            parseMode: parse_mode,
            linkPreview: !disable_web_page_preview,
            silent: disable_notification,
            replyTo: reply_to_message_id,
        });

        return c.json({
            ok: true,
            result: {
                message_id: result.id,
                date: Math.floor(Date.now() / 1000),
            },
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

// Forward messages
messages.post('/forwardMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Forward one or multiple messages',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(forwardMessageSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Messages forwarded successfully',
                content: {
                    'application/json': {
                        schema: resolver(z.union([messageResponseSchema, multipleMessageResponseSchema])),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', forwardMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, from_chat_id, message_ids, disable_notification } = c.req.valid('json');

        const messages = Array.isArray(message_ids) ? message_ids : [message_ids];
        const result = await client.forwardMessages(chat_id, {
            messages,
            fromPeer: from_chat_id,
            silent: disable_notification,
        }) as Api.Message[] | Api.Message;

        return c.json({
            ok: true,
            result: Array.isArray(result) 
                ? result.map(msg => ({ message_id: msg.id, date: Math.floor(Date.now() / 1000) }))
                : { message_id: result.id, date: Math.floor(Date.now() / 1000) },
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

// Delete messages
messages.post('/deleteMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Delete one or multiple messages',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(deleteMessageSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Messages deleted successfully',
                content: {
                    'application/json': {
                        schema: resolver(successResponseSchema),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', deleteMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, message_ids } = c.req.valid('json');

        const messages = Array.isArray(message_ids) ? message_ids : [message_ids];
        await client.deleteMessages(chat_id, messages, { revoke: true });

        return c.json({
            ok: true,
            result: true,
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

// Edit a message
messages.post('/editMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Edit an existing message',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(editMessageSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Message edited successfully',
                content: {
                    'application/json': {
                        schema: resolver(messageResponseSchema),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', editMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, message_id, text, parse_mode, disable_web_page_preview } = c.req.valid('json');

        const result = await client.editMessage(chat_id, {
            message: message_id,
            text: text,
            parseMode: parse_mode,
            linkPreview: !disable_web_page_preview,
        });

        return c.json({
            ok: true,
            result: {
                message_id: result.id,
                date: Math.floor(Date.now() / 1000),
            },
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

// Pin a message
messages.post('/pinMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Pin a message in a chat',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(pinMessageSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Message pinned successfully',
                content: {
                    'application/json': {
                        schema: resolver(successResponseSchema),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', pinMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, message_id, disable_notification } = c.req.valid('json');

        await client.pinMessage(chat_id, message_id, {
            notify: !disable_notification,
        });

        return c.json({
            ok: true,
            result: true,
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

// Unpin a message
messages.post('/unpinMessage',
    describeRoute({
        tags: ['Messages'],
        description: 'Unpin a message from a chat',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(pinMessageSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Message unpinned successfully',
                content: {
                    'application/json': {
                        schema: resolver(successResponseSchema),
                    },
                },
            },
            400: {
                description: 'Bad request',
                content: {
                    'application/json': {
                        schema: resolver(errorResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', pinMessageSchema),
    async (c) => {
    try {
        const user = c.get('user') as User;
        const client = await getClient(user);
        const { chat_id, message_id } = c.req.valid('json');

        await client.unpinMessage(chat_id, message_id);

        return c.json({
            ok: true,
            result: true,
        });
    } catch (error: any) {
        return c.json({
            ok: false,
            error_code: 400,
            description: error.message,
        }, 400);
    }
});

export default messages; 

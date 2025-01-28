import { Hono } from 'hono';
import { z } from 'zod';
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { getClient } from '../services/telegram/client';
import type { User } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { Api } from 'telegram';
import "zod-openapi/extend"

const chats = new Hono();

// Apply auth middleware to all routes
chats.use(authMiddleware);

// Schema for getting chat information
const getChatSchema = z.object({
    chat_id: z.string(),
}).openapi({ ref: "GetChat" });

// Response schema for chat information
const chatResponseSchema = z.object({
    ok: z.boolean(),
    result: z.object({
        id: z.string(),
        type: z.enum(['private', 'group', 'supergroup', 'channel', 'empty', 'forbidden']),
        title: z.string().optional(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        description: z.string().optional(),
        participant_count: z.number().optional(),
        is_verified: z.boolean().optional(),
        is_restricted: z.boolean().optional(),
        is_scam: z.boolean().optional(),
        is_fake: z.boolean().optional(),
        access_hash: z.string().optional(),
    }),
}).openapi({ ref: "ChatResponse" });

const errorResponseSchema = z.object({
    ok: z.boolean(),
    error_code: z.number(),
    description: z.string(),
}).openapi({ ref: "ErrorResponse" });

// Schema for getting chat administrators
const getChatAdministratorsSchema = z.object({
    chat_id: z.string(),
}).openapi({ ref: "GetChatAdministrators" });

// Response schema for chat administrators
const chatAdministratorSchema = z.object({
    user: z.object({
        id: z.string(),
        first_name: z.string(),
        last_name: z.string().optional(),
        username: z.string().optional(),
    }),
    status: z.enum(['creator', 'administrator']),
    custom_title: z.string().optional(),
    can_edit_messages: z.boolean().optional(),
    can_delete_messages: z.boolean(),
    can_restrict_members: z.boolean(),
    can_invite_users: z.boolean(),
    can_pin_messages: z.boolean().optional(),
    can_promote_members: z.boolean().optional(),
    is_anonymous: z.boolean().optional(),
}).openapi({ ref: "ChatAdministrator" });

const chatAdministratorsResponseSchema = z.object({
    ok: z.boolean(),
    result: z.array(chatAdministratorSchema),
}).openapi({ ref: "ChatAdministratorsResponse" });

// Schema for getting chat member information
const getChatMemberSchema = z.object({
    chat_id: z.string(),
    user_id: z.string(),
}).openapi({ ref: "GetChatMember" });

// Response schema for chat member
const chatMemberSchema = z.object({
    user: z.object({
        id: z.string(),
        first_name: z.string(),
        last_name: z.string().optional(),
        username: z.string().optional(),
    }),
    status: z.enum(['creator', 'administrator', 'member', 'restricted', 'left', 'banned']),
    custom_title: z.string().optional(),
    // Admin permissions (if admin)
    can_edit_messages: z.boolean().optional(),
    can_delete_messages: z.boolean().optional(),
    can_restrict_members: z.boolean().optional(),
    can_invite_users: z.boolean().optional(),
    can_pin_messages: z.boolean().optional(),
    can_promote_members: z.boolean().optional(),
    is_anonymous: z.boolean().optional(),
    // Restricted permissions (if restricted)
    can_send_messages: z.boolean().optional(),
    can_send_media: z.boolean().optional(),
    can_send_stickers: z.boolean().optional(),
    can_send_gifs: z.boolean().optional(),
    can_send_games: z.boolean().optional(),
    can_send_inline: z.boolean().optional(),
    can_add_web_page_previews: z.boolean().optional(),
    can_send_polls: z.boolean().optional(),
    // Ban info (if banned)
    banned_until: z.number().optional(),
    // Join date
    joined_date: z.number().optional(),
}).openapi({ ref: "ChatMember" });

const chatMemberResponseSchema = z.object({
    ok: z.boolean(),
    result: chatMemberSchema,
}).openapi({ ref: "ChatMemberResponse" });

// Get chat information
chats.post('/getChat',
    describeRoute({
        tags: ['Chats'],
        description: 'Get information about a chat',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(getChatSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Chat information retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(chatResponseSchema),
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
    zValidator('json', getChatSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { chat_id } = c.req.valid('json');

            const entity = await client.getEntity(chat_id);
            
            // Base result with common properties
            const result: any = {
                id: entity.id.toString(),
                access_hash: 'accessHash' in entity ? entity.accessHash?.toString() : undefined,
            };

            // Handle different entity types
            if (entity instanceof Api.User) {
                result.type = 'private';
                result.first_name = entity.firstName;
                result.last_name = entity.lastName;
                result.username = entity.username;
                result.is_verified = entity.verified;
                result.is_restricted = entity.restricted;
                result.is_scam = entity.scam;
                result.is_fake = entity.fake;
            } 
            else if (entity instanceof Api.Channel) {
                result.type = entity.megagroup ? 'supergroup' : 'channel';
                result.title = entity.title;
                result.username = entity.username;
                result.description = 'about' in entity ? entity.about : undefined;
                result.participant_count = entity.participantsCount;
                result.is_verified = entity.verified;
                result.is_restricted = entity.restricted;
                result.is_scam = entity.scam;
                result.is_fake = entity.fake;
            }
            else if (entity instanceof Api.Chat) {
                result.type = 'group';
                result.title = entity.title;
                result.participant_count = entity.participantsCount;
            }
            else if (entity instanceof Api.ChatEmpty || entity instanceof Api.UserEmpty) {
                result.type = 'empty';
            }
            else if (entity instanceof Api.ChatForbidden || entity instanceof Api.ChannelForbidden) {
                result.type = 'forbidden';
                result.title = entity.title;
            }

            return c.json({
                ok: true,
                result
            });
        } catch (error: any) {
            return c.json({
                ok: false,
                error_code: 400,
                description: error.message,
            }, 400);
        }
    }
);

// Get chat administrators
chats.post('/getChatAdministrators',
    describeRoute({
        tags: ['Chats'],
        description: 'Get a list of administrators in a chat',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(getChatAdministratorsSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Chat administrators retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(chatAdministratorsResponseSchema),
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
    zValidator('json', getChatAdministratorsSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { chat_id } = c.req.valid('json');

            // First get the chat to check if it's a channel/supergroup
            const chat = await client.getEntity(chat_id);
            
            if (!(chat instanceof Api.Channel)) {
                throw new Error('This method is only available for channels and supergroups');
            }

            // Get full channel/supergroup info
            const fullChat = await client.invoke(new Api.channels.GetFullChannel({
                channel: chat
            }));

            // Get participants with admin filter
            const participants = await client.getParticipants(chat_id, {
                filter: new Api.ChannelParticipantsAdmins()
            });

            const admins = await Promise.all(participants.map(async participant => {
                type AdminStatus = 'creator' | 'administrator';
                
                // Base admin object with default values
                const adminObject: {
                    user: {
                        id: string;
                        first_name: string;
                        last_name?: string;
                        username?: string;
                    };
                    status: AdminStatus;
                    custom_title?: string;
                    can_edit_messages: boolean;
                    can_delete_messages: boolean;
                    can_restrict_members: boolean;
                    can_invite_users: boolean;
                    can_pin_messages: boolean;
                    can_promote_members: boolean;
                    is_anonymous: boolean;
                } = {
                    user: {
                        id: participant.id.toString(),
                        first_name: participant.firstName || "",
                        last_name: participant.lastName,
                        username: participant.username,
                    },
                    status: 'administrator',
                    can_edit_messages: true,
                    can_delete_messages: true,
                    can_restrict_members: true,
                    can_invite_users: true,
                    can_pin_messages: true,
                    can_promote_members: false,
                    is_anonymous: false,
                };

                try {
                    // Get participant's specific admin rights
                    const participantInfo = await client.invoke(new Api.channels.GetParticipant({
                        channel: chat,
                        participant: participant
                    }));

                    if (participantInfo.participant instanceof Api.ChannelParticipantCreator) {
                        adminObject.status = 'creator';
                        adminObject.can_promote_members = true;
                        if (participantInfo.participant.rank) {
                            adminObject.custom_title = participantInfo.participant.rank;
                        }
                    }
                    else if (participantInfo.participant instanceof Api.ChannelParticipantAdmin) {
                        const rights = participantInfo.participant.adminRights;
                        if (rights) {
                            adminObject.can_edit_messages = Boolean(rights.changeInfo);
                            adminObject.can_delete_messages = Boolean(rights.deleteMessages);
                            adminObject.can_restrict_members = Boolean(rights.banUsers);
                            adminObject.can_invite_users = Boolean(rights.inviteUsers);
                            adminObject.can_pin_messages = Boolean(rights.pinMessages);
                            adminObject.can_promote_members = Boolean(rights.addAdmins);
                            adminObject.is_anonymous = Boolean(rights.anonymous);
                        }
                        if (participantInfo.participant.rank) {
                            adminObject.custom_title = participantInfo.participant.rank;
                        }
                    }
                } catch (error) {
                    console.error(`Failed to get participant info for ${participant.id}:`, error);
                }

                return adminObject;
            }));

            return c.json({
                ok: true,
                result: admins
            });
        } catch (error: any) {
            return c.json({
                ok: false,
                error_code: 400,
                description: error.message,
            }, 400);
        }
    }
);

// Get chat member
chats.post('/getChatMember',
    describeRoute({
        tags: ['Chats'],
        description: 'Get information about a chat member',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(getChatMemberSchema),
                    },
                },
                required: true,
            },
        },
        responses: {
            200: {
                description: 'Chat member information retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(chatMemberResponseSchema),
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
    zValidator('json', getChatMemberSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { chat_id, user_id } = c.req.valid('json');

            // First get the chat
            const chat = await client.getEntity(chat_id);
            
            // Get the user
            const targetUser = await client.getEntity(user_id);
            
            if (!(targetUser instanceof Api.User)) {
                throw new Error('Invalid user ID');
            }

            // Get participant info
            let participantInfo;
            if (chat instanceof Api.Channel) {
                participantInfo = await client.invoke(new Api.channels.GetParticipant({
                    channel: chat,
                    participant: targetUser
                }));
            } else if (chat instanceof Api.Chat) {
                // For regular groups, we need to get all participants and find our target
                const participants = await client.getParticipants(chat);
                const participant = participants.find(p => p.id.toString() === user_id);
                if (!participant) {
                    throw new Error('User is not a member of this chat');
                }
                participantInfo = { participant };
            } else {
                throw new Error('Invalid chat type');
            }

            // Base member object
            const memberObject: any = {
                user: {
                    id: targetUser.id.toString(),
                    first_name: targetUser.firstName || "",
                    last_name: targetUser.lastName,
                    username: targetUser.username,
                },
                status: 'member',
            };

            // Handle different participant types
            const participant = participantInfo.participant;
            if (participant instanceof Api.ChannelParticipantCreator) {
                memberObject.status = 'creator';
                memberObject.can_edit_messages = true;
                memberObject.can_delete_messages = true;
                memberObject.can_restrict_members = true;
                memberObject.can_invite_users = true;
                memberObject.can_pin_messages = true;
                memberObject.can_promote_members = true;
                memberObject.is_anonymous = false;
                if (participant.rank) {
                    memberObject.custom_title = participant.rank;
                }
            }
            else if (participant instanceof Api.ChannelParticipantAdmin) {
                memberObject.status = 'administrator';
                const rights = participant.adminRights;
                if (rights) {
                    memberObject.can_edit_messages = Boolean(rights.changeInfo);
                    memberObject.can_delete_messages = Boolean(rights.deleteMessages);
                    memberObject.can_restrict_members = Boolean(rights.banUsers);
                    memberObject.can_invite_users = Boolean(rights.inviteUsers);
                    memberObject.can_pin_messages = Boolean(rights.pinMessages);
                    memberObject.can_promote_members = Boolean(rights.addAdmins);
                    memberObject.is_anonymous = Boolean(rights.anonymous);
                }
                if (participant.rank) {
                    memberObject.custom_title = participant.rank;
                }
            }
            else if (participant instanceof Api.ChannelParticipantBanned) {
                memberObject.status = 'banned';
                if ('bannedRights' in participant) {
                    const rights = participant.bannedRights as {
                        untilDate: number;
                        sendMessages?: boolean;
                        sendMedia?: boolean;
                        sendStickers?: boolean;
                        sendGifs?: boolean;
                        sendGames?: boolean;
                        sendInline?: boolean;
                        embedLinks?: boolean;
                        sendPolls?: boolean;
                    };
                    memberObject.banned_until = rights.untilDate;
                    // Also include the restrictions
                    memberObject.can_send_messages = !rights.sendMessages;
                    memberObject.can_send_media = !rights.sendMedia;
                    memberObject.can_send_stickers = !rights.sendStickers;
                    memberObject.can_send_gifs = !rights.sendGifs;
                    memberObject.can_send_games = !rights.sendGames;
                    memberObject.can_send_inline = !rights.sendInline;
                    memberObject.can_add_web_page_previews = !rights.embedLinks;
                    memberObject.can_send_polls = !rights.sendPolls;
                }
            }
            else if (participant instanceof Api.ChannelParticipantLeft) {
                memberObject.status = 'left';
            }
            else if ('bannedRights' in participant) {
                // Handle restricted participants
                memberObject.status = 'restricted';
                const rights = participant.bannedRights as {
                    sendMessages?: boolean;
                    sendMedia?: boolean;
                    sendStickers?: boolean;
                    sendGifs?: boolean;
                    sendGames?: boolean;
                    sendInline?: boolean;
                    embedLinks?: boolean;
                    sendPolls?: boolean;
                };
                memberObject.can_send_messages = !rights.sendMessages;
                memberObject.can_send_media = !rights.sendMedia;
                memberObject.can_send_stickers = !rights.sendStickers;
                memberObject.can_send_gifs = !rights.sendGifs;
                memberObject.can_send_games = !rights.sendGames;
                memberObject.can_send_inline = !rights.sendInline;
                memberObject.can_add_web_page_previews = !rights.embedLinks;
                memberObject.can_send_polls = !rights.sendPolls;
            }

            // Add join date if available
            if ('date' in participant) {
                memberObject.joined_date = participant.date;
            }

            return c.json({
                ok: true,
                result: memberObject
            });
        } catch (error: any) {
            return c.json({
                ok: false,
                error_code: 400,
                description: error.message,
            }, 400);
        }
    }
);

export default chats; 
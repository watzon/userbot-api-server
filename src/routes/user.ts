import { Hono } from 'hono';
import { z } from 'zod';
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { getClient } from '../services/telegram/client';
import { Api } from 'telegram';
import type { User } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import bigInt from 'big-integer';
const user = new Hono();

// Apply auth middleware to all routes
user.use(authMiddleware);

// Response schemas
const userResponseSchema = z.object({
    ok: z.boolean(),
    result: z.object({
        id: z.number(),
        first_name: z.string(),
        last_name: z.string().optional(),
        username: z.string().optional(),
        phone: z.string(),
        bot: z.boolean(),
        premium: z.boolean().optional(),
    }),
});

const profilePhotosResponseSchema = z.object({
    ok: z.boolean(),
    result: z.object({
        total_count: z.number(),
        photos: z.array(z.object({
            file_id: z.string(),
            file_unique_id: z.string(),
            width: z.number(),
            height: z.number(),
            file_size: z.number().optional(),
        })),
    }),
});

const statusResponseSchema = z.object({
    ok: z.boolean(),
    result: z.object({
        online: z.boolean(),
        was_online: z.number().optional(),
        expires: z.number().optional(),
    }),
});

const errorResponseSchema = z.object({
    ok: z.boolean(),
    error_code: z.number(),
    description: z.string(),
});

// Get information about the logged-in user
user.get('/getMe',
    describeRoute({
        tags: ['User'],
        description: 'Get information about the logged-in user',
        responses: {
            200: {
                description: 'User information retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(userResponseSchema),
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
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const me = await client.getMe();

            return c.json({
                ok: true,
                result: {
                    id: me.id,
                    first_name: me.firstName,
                    last_name: me.lastName,
                    username: me.username,
                    phone: me.phone,
                    bot: me.bot,
                    premium: me.premium,
                },
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

// Get user's profile photos
const getUserProfilePhotosSchema = z.object({
    user_id: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
});

user.get('/getUserProfilePhotos',
    describeRoute({
        tags: ['User'],
        description: 'Get a list of profile pictures for a user',
        request: {
            query: resolver(getUserProfilePhotosSchema),
        },
        responses: {
            200: {
                description: 'Profile photos retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(profilePhotosResponseSchema),
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
    zValidator('query', getUserProfilePhotosSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { user_id, offset, limit } = c.req.valid('query');

            // Get the target user's input peer
            const targetUser = user_id ? await client.getEntity(user_id) : await client.getMe();
            
            // Get photos using the photos.getUserPhotos API method
            const result = await client.invoke(new Api.photos.GetUserPhotos({
                userId: targetUser,
                offset: offset || 0,
                limit: limit || 100,
                maxId: bigInt(0) // Use BigInt literal
            })) as Api.photos.Photos;

            // Process the photos
            const photos = result.photos
                .filter((photo): photo is Api.Photo => photo.className === 'Photo')
                .map(photo => {
                    const size = photo.sizes?.find(size => 
                        size.className === 'PhotoSize'
                    ) as Api.PhotoSize | undefined;

                    return {
                        file_id: photo.id.toString(),
                        file_unique_id: photo.accessHash?.toString() || '',
                        width: size?.w || 0,
                        height: size?.h || 0,
                        file_size: Number(size?.size) || 0,
                    };
                });

            return c.json({
                ok: true,
                result: {
                    total_count: photos.length,
                    photos,
                },
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

// Get user's online status
const getStatusSchema = z.object({
    user_id: z.string(),
});

user.get('/getStatus',
    describeRoute({
        tags: ['User'],
        description: 'Get the online status of a user',
        request: {
            query: resolver(getStatusSchema),
        },
        responses: {
            200: {
                description: 'User status retrieved successfully',
                content: {
                    'application/json': {
                        schema: resolver(statusResponseSchema),
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
    zValidator('query', getStatusSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { user_id } = c.req.valid('query');

            // Get the user's full information which includes status
            const result = await client.invoke(new Api.users.GetFullUser({
                id: user_id
            }));

            // Get the user's status from their full info
            const userInfo = await client.getEntity(user_id) as Api.User;
            const now = Math.floor(Date.now() / 1000);

            return c.json({
                ok: true,
                result: {
                    online: userInfo.status?.className === 'UserStatusOnline',
                    was_online: userInfo.status?.className === 'UserStatusOffline' ? 
                        Math.floor(Number(userInfo.status.wasOnline)) : undefined,
                    expires: userInfo.status?.className === 'UserStatusOnline' ? 
                        Math.floor(Number(userInfo.status.expires)) : undefined,
                },
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

// Update user's profile information
const updateProfileSchema = z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    about: z.string().optional(),
});

user.post('/updateProfile',
    describeRoute({
        tags: ['User'],
        description: 'Update the user\'s profile information',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: resolver(updateProfileSchema),
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Profile updated successfully',
                content: {
                    'application/json': {
                        schema: resolver(userResponseSchema),
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
    zValidator('json', updateProfileSchema),
    async (c) => {
        try {
            const user = c.get('user') as User;
            const client = await getClient(user);
            const { first_name, last_name, about } = c.req.valid('json');

            // Update first and last name if provided
            if (first_name || last_name) {
                await client.invoke(new Api.account.UpdateProfile({
                    firstName: first_name,
                    lastName: last_name,
                    about: about
                }));
            }

            // Get updated user info
            const me = await client.getMe();

            return c.json({
                ok: true,
                result: {
                    id: me.id,
                    first_name: me.firstName,
                    last_name: me.lastName,
                    username: me.username,
                    phone: me.phone,
                    bot: me.bot,
                    premium: me.premium,
                },
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

export default user;

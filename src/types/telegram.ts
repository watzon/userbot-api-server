import { Api } from "telegram";
import { getMediaFromMessage } from "../utils/telegram";

export type UpdateType =
    | "message"           // New messages
    | "edited_message"    // Edited messages
    | "channel_post"      // New channel posts
    | "edited_channel_post" // Edited channel posts
    | "delete"            // Deleted messages
    | "album"             // Media albums
    | "typing"            // User typing status
    | "user_update"       // User updates (status, profile, etc)
    | "chat_action"       // Chat actions (user joined, left, etc)
    | "inline_query"      // Inline bot queries
    | "callback_query"    // Callback button clicks
    | "reaction"          // Message reactions
    | "story"             // Story updates
    | "all";              // All update types

// Default update types if none specified
export const DEFAULT_UPDATE_TYPES: UpdateType[] = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "delete",
    "typing",
    "chat_action",
    "album"
];

export interface UpdateOptions {
    allowed_updates?: UpdateType[];
    exclude_updates?: UpdateType[];
}

export interface Update {
    update_id: number;
    message?: Message;
    edited_message?: Message;
    channel_post?: Message;
    edited_channel_post?: Message;
    deleted_message?: DeletedMessage;
    user_status?: UserStatus;
    typing_status?: TypingStatus;
    chat_action?: ChatAction;
    user_update?: UserUpdate;
    reaction?: MessageReaction;
    story?: Story;
    album?: MediaAlbum;
}

export interface Message {
    message_id: number;
    from?: {
        id: string;
        first_name: string;
        last_name?: string;
        username?: string;
    };
    chat: {
        id: string;
        type: string;
    };
    date: number;
    text: string;
    media?: MessageMedia;
    group_id?: string; // For media albums
    out: boolean;
}

export interface MessageMedia {
    type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
    file_id?: string;
    file_unique_id?: string;
    file_size?: number;
    mime_type?: string;
    width?: number;
    height?: number;
    duration?: number;
    thumb?: {
        file_id: string;
        file_unique_id: string;
        width: number;
        height: number;
        file_size?: number;
    };
    file_name?: string;
    title?: string;
    performer?: string;
}

export interface MediaAlbum {
    album_id: string;
    messages: Message[];
}

export interface UserStatus {
    user_id: string;
    status: 'online' | 'offline' | 'recently' | 'last_week' | 'last_month' | 'long_time_ago';
    was_online?: number;  // Unix timestamp when user was last seen
}

export interface UpdateHandler {
    phoneNumber: string;
    offset?: number;
    resolve: (updates: Update[]) => void;
    reject: (error: Error) => void;
    timeoutHandle?: ReturnType<typeof setTimeout>;
    options?: UpdateOptions;
}

export interface WebhookConfig {
    url: string;
    secret?: string;
    allowed_updates?: UpdateType[];
    exclude_updates?: UpdateType[];
}

export interface DeletedMessage {
    chat_id: string;
    message_id: number;
    deleted_at: number;
}

export interface TypingStatus {
    user_id?: string;
    chat_id?: string;
    action: 'typing' | 'upload_photo' | 'record_video' | 'upload_video' | 
            'record_voice' | 'upload_voice' | 'upload_document' | 'choose_sticker' |
            'find_location' | 'record_video_note' | 'upload_video_note';
}

export interface ChatAction {
    chat_id: string;
    user_id?: string;
    action: ChatActionType;
    action_data?: ChatActionData;
}

export type ChatActionType = 
    | 'join'              // User joined the chat
    | 'leave'             // User left the chat
    | 'invite'            // User invited to chat
    | 'title_changed'     // Chat title changed
    | 'description_changed' // Chat description changed
    | 'photo_changed'     // Chat photo changed
    | 'photo_deleted'     // Chat photo deleted
    | 'message_pinned'    // Message was pinned
    | 'message_unpinned'  // Message was unpinned
    | 'permissions_changed' // Chat permissions changed
    | 'admin_rights_changed' // Admin rights changed
    | 'member_rights_changed'; // Member rights changed

export interface ChatActionData {
    // For title changes
    new_title?: string;
    old_title?: string;
    
    // For description changes
    new_description?: string;
    old_description?: string;
    
    // For pinned messages
    message_id?: number;
    
    // For permission/rights changes
    old_permissions?: string[];
    new_permissions?: string[];
    
    // For user actions (join/leave/invite)
    inviter_id?: string;
    
    // For photo changes
    photo_id?: string;
}

export interface UserUpdate {
    user_id: string;
    update_type: 'name' | 'username' | 'photo' | 'emoji_status' | 'phone' | 'bio';
    old_value?: string;
    new_value?: string;
}

export interface MessageReaction {
    chat_id: string;
    message_id: number;
    user_id: string;
    reaction: string[];
    old_reaction?: string[];
    is_big: boolean;
}

export interface Story {
    user_id: string;
    story_id: number;
    action: 'new' | 'edit' | 'delete' | 'view';
    expire_date?: number;
}

// Helper function to convert GramJS message to our format
export function convertToMessage(message: Api.Message): Message {
    const sender = message.sender as Api.User;
    const chat = message.chat as Api.Chat;

    return {
        message_id: message.id,
        from: sender ? {
            id: sender.id.toString(),
            first_name: sender.firstName || "",
            last_name: sender.lastName || "",
            username: sender.username || "",
        } : undefined,
        chat: {
            id: message.chatId?.toString() || "",
            type: chat ? chat.className.toLowerCase() : "private",
        },
        date: Math.floor(Date.now() / 1000),
        text: message.message || "",
        media: getMediaFromMessage(message),
        group_id: message.groupedId?.toString(),
        out: message.out || false
    };
}

// Helper function to check if an update type should be included
export function shouldIncludeUpdate(type: UpdateType, options?: UpdateOptions): boolean {
    if (!options) return true;

    const { allowed_updates, exclude_updates } = options;

    // If explicitly excluded, don't include
    if (exclude_updates?.includes(type)) return false;

    // If no allowed updates specified, include all non-excluded
    if (!allowed_updates) return true;

    // If allowed updates specified, only include if in list
    return allowed_updates.includes(type) || allowed_updates.includes("all");
}

// Add this before the other utility functions
export function getIdFromPeer(peer: any): string | undefined {
    if (!peer) return undefined;

    // Handle different peer types
    switch (peer.className) {
        case 'PeerUser':
            return peer.userId?.toString();
        case 'PeerChat':
            return peer.chatId?.toString();
        case 'PeerChannel':
            return peer.channelId?.toString();
        // If it's already a raw ID
        default:
            return peer.toString();
    }
} 
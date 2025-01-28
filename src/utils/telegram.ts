import { Api } from "telegram";
import type { TypingStatus, ChatActionType, ChatActionData, MessageMedia } from "../types/telegram";

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

export function getTypingAction(action: Api.TypeSendMessageAction): TypingStatus['action'] {
    if (!action) return 'typing';

    switch (action.className) {
        case 'SendMessageTypingAction':
            return 'typing';
        case 'SendMessageUploadPhotoAction':
            return 'upload_photo';
        case 'SendMessageRecordVideoAction':
            return 'record_video';
        case 'SendMessageUploadVideoAction':
            return 'upload_video';
        case 'SendMessageRecordAudioAction':
            return 'record_voice';
        case 'SendMessageUploadAudioAction':
            return 'upload_voice';
        case 'SendMessageUploadDocumentAction':
            return 'upload_document';
        case 'SendMessageChooseStickerAction':
            return 'choose_sticker';
        case 'SendMessageGeoLocationAction':
            return 'find_location';
        case 'SendMessageRecordRoundAction':
            return 'record_video_note';
        case 'SendMessageUploadRoundAction':
            return 'upload_video_note';
        default:
            console.log('Unknown typing action:', action.className);
            return 'typing';
    }
}

export interface ChatActionResult {
    type: ChatActionType;
    data?: ChatActionData;
}

export function getChatAction(update: Api.TypeUpdate): ChatActionResult | undefined {
    switch (update.className) {
        case 'UpdateNewChannelMessage': {
            // Handle channel updates
            const message = update.message as Api.Message;
            if (message?.action) {
                switch (message.action.className) {
                    case 'MessageActionChatEditTitle':
                        return {
                            type: 'title_changed',
                            data: {
                                new_title: message.action.title
                            }
                        };
                    case 'MessageActionChatEditPhoto':
                        return {
                            type: 'photo_changed',
                            data: {
                                photo_id: message.action.photo?.id?.toString()
                            }
                        };
                    case 'MessageActionChatDeletePhoto':
                        return {
                            type: 'photo_deleted'
                        };
                    case 'MessageActionChatAddUser':
                        return {
                            type: 'join',
                            data: {
                                inviter_id: message.action.users?.[0]?.toString()
                            }
                        };
                    case 'MessageActionChatDeleteUser':
                        return {
                            type: 'leave'
                        };
                    case 'MessageActionPinMessage':
                        return {
                            type: 'message_pinned',
                            data: {
                                message_id: message.id
                            }
                        };
                }
            }
            break;
        }
        case 'UpdateChannelParticipant': {
            const newParticipant = update.newParticipant as Api.ChannelParticipantAdmin;
            const prevParticipant = update.prevParticipant as Api.ChannelParticipantAdmin;
            
            // Handle admin rights changes
            const newRights = Object.keys(newParticipant?.adminRights || {}).length;
            const prevRights = Object.keys(prevParticipant?.adminRights || {}).length;
            
            if (newRights !== prevRights) {
                return {
                    type: 'admin_rights_changed',
                    data: {
                        new_permissions: Object.keys(newParticipant?.adminRights || {}),
                        old_permissions: Object.keys(prevParticipant?.adminRights || {})
                    }
                };
            }
            
            // Handle banned rights changes
            const newBanned = update.newParticipant as Api.ChannelParticipantBanned;
            const prevBanned = update.prevParticipant as Api.ChannelParticipantBanned;
            
            const newBanRights = Object.keys(newBanned?.bannedRights || {}).length;
            const prevBanRights = Object.keys(prevBanned?.bannedRights || {}).length;
            
            if (newBanRights !== prevBanRights) {
                return {
                    type: 'member_rights_changed',
                    data: {
                        new_permissions: Object.keys(newBanned?.bannedRights || {}),
                        old_permissions: Object.keys(prevBanned?.bannedRights || {})
                    }
                };
            }
            break;
        }
    }
    
    return undefined;
}

// Keep track of pending albums
const pendingAlbums = new Map<string, {
    messages: Api.Message[];
    timer: ReturnType<typeof setTimeout>;
}>();

export function getMediaFromMessage(message: Api.Message): MessageMedia | undefined {
    if (!message.media || message.media.className === 'MessageMediaEmpty') return undefined;

    const baseMedia: Partial<MessageMedia> = {};

    switch (message.media.className) {
        case 'MessageMediaPhoto': {
            const photo = message.media.photo;
            if (!photo || photo.className === 'PhotoEmpty') return undefined;

            const photoSize = photo.sizes?.find(size => size.className === 'PhotoSize');
            if (!photoSize || photoSize.className !== 'PhotoSize') return undefined;

            return {
                type: 'photo',
                file_id: photo.id?.toString(),
                file_unique_id: photo.accessHash?.toString(),
                file_size: Number(photoSize.size) || undefined,
                width: photoSize.w,
                height: photoSize.h,
            };
        }
        
        case 'MessageMediaDocument': {
            const doc = message.media.document;
            if (!doc || doc.className === 'DocumentEmpty') return undefined;

            baseMedia.file_id = doc.id?.toString();
            baseMedia.file_unique_id = doc.accessHash?.toString();
            baseMedia.file_size = Number(doc.size) || undefined;
            baseMedia.mime_type = doc.mimeType;

            // Try to determine the type from attributes
            const attributes = doc.attributes || [];
            
            // Type-safe attribute finding
            const videoAttr = attributes.find((attr): attr is Api.DocumentAttributeVideo => 
                attr.className === 'DocumentAttributeVideo'
            );
            const audioAttr = attributes.find((attr): attr is Api.DocumentAttributeAudio => 
                attr.className === 'DocumentAttributeAudio'
            );
            const stickerAttr = attributes.find((attr): attr is Api.DocumentAttributeSticker => 
                attr.className === 'DocumentAttributeSticker'
            );
            const animatedAttr = attributes.find((attr): attr is Api.DocumentAttributeAnimated => 
                attr.className === 'DocumentAttributeAnimated'
            );
            const filenameAttr = attributes.find((attr): attr is Api.DocumentAttributeFilename => 
                attr.className === 'DocumentAttributeFilename'
            );
            const imageAttr = attributes.find((attr): attr is Api.DocumentAttributeImageSize => 
                attr.className === 'DocumentAttributeImageSize'
            );

            if (videoAttr) {
                return {
                    ...baseMedia,
                    type: 'video',
                    width: videoAttr.w,
                    height: videoAttr.h,
                    duration: videoAttr.duration,
                    file_name: filenameAttr?.fileName,
                };
            } else if (audioAttr) {
                return {
                    ...baseMedia,
                    type: audioAttr.voice ? 'voice' : 'audio',
                    duration: audioAttr.duration,
                    title: audioAttr.title,
                    performer: audioAttr.performer,
                    file_name: filenameAttr?.fileName,
                };
            } else if (stickerAttr) {
                return {
                    ...baseMedia,
                    type: 'sticker',
                    width: imageAttr?.w,
                    height: imageAttr?.h,
                };
            } else if (animatedAttr) {
                return {
                    ...baseMedia,
                    type: 'animation',
                    width: imageAttr?.w,
                    height: imageAttr?.h,
                    file_name: filenameAttr?.fileName,
                };
            } else {
                return {
                    ...baseMedia,
                    type: 'document',
                    file_name: filenameAttr?.fileName,
                };
            }
        }
        
        default:
            console.log('Unknown media type:', message.media.className);
            return undefined;
    }
}

export function handleMediaAlbum(message: Api.Message): Api.Message[] {
    // If message has no grouped ID, return it as a single message
    if (!message.groupedId) {
        return [message];
    }

    const groupId = message.groupedId.toString();
    const existingAlbum = pendingAlbums.get(groupId);

    if (existingAlbum) {
        // Clear existing timer
        clearTimeout(existingAlbum.timer);
        
        // Add message to existing album
        existingAlbum.messages.push(message);
        
        // Sort messages by ID to ensure consistent order
        existingAlbum.messages.sort((a, b) => a.id - b.id);

        // Set new timer with shorter delay for subsequent messages
        existingAlbum.timer = setTimeout(() => {
            pendingAlbums.delete(groupId);
        }, 500); // Reduced to 500ms for subsequent messages

        // If we have 2 or more messages, return them immediately
        // Most albums will be complete with 2 messages
        if (existingAlbum.messages.length >= 2) {
            pendingAlbums.delete(groupId);
            return existingAlbum.messages;
        }
        
        return [];
    } else {
        // Create new album entry with shorter initial timer
        const timer = setTimeout(() => {
            const album = pendingAlbums.get(groupId);
            // If we have at least one message when the timer expires, send it
            if (album?.messages.length === 1) {
                pendingAlbums.delete(groupId);
                return album.messages;
            }
            pendingAlbums.delete(groupId);
        }, 300); // Reduced to 300ms for initial wait
        
        pendingAlbums.set(groupId, {
            messages: [message],
            timer
        });
        
        return [];
    }
} 

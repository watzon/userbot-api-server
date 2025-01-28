import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { Api } from "telegram";
import type { User } from "../../db/schema";
import type { Update, UpdateHandler, UpdateType, UpdateOptions, UserStatus, MediaAlbum } from "../../types/telegram";
import { convertToMessage, shouldIncludeUpdate, DEFAULT_UPDATE_TYPES } from "../../types/telegram";
import { getIdFromPeer, getTypingAction, getChatAction, handleMediaAlbum } from "../../utils/telegram";

export class UpdateManager {
  private updateHandlers: Map<string, UpdateHandler> = new Map();
  private updateBuffers: Map<string, Update[]> = new Map();
  private lastUpdateId: Map<string, number> = new Map();
  private processedMessages: Map<string, number> = new Map();
  private readonly MESSAGE_CACHE_TTL = 60 * 1000; // 1 minute TTL
  private readonly MAX_CACHE_SIZE = 1000;

  constructor() {}

  private generateUpdateId(phoneNumber: string): number {
    const lastId = this.lastUpdateId.get(phoneNumber) || Date.now();
    const newId = lastId + 1;
    this.lastUpdateId.set(phoneNumber, newId);
    return newId;
  }

  private getBufferedUpdates(phoneNumber: string, offset?: number): Update[] {
    console.log(`Getting buffered updates for ${phoneNumber} with offset ${offset}`);
    const buffer = this.updateBuffers.get(phoneNumber) || [];
    if (!offset) {
      const updates = [...buffer];
      this.updateBuffers.set(phoneNumber, []);
      return updates;
    }

    const index = buffer.findIndex(update => update.update_id > offset);
    if (index === -1) return [];

    const updates = buffer.slice(index);
    this.updateBuffers.set(phoneNumber, []);
    return updates;
  }

  private convertToUserStatus(status: any): UserStatus['status'] {
    if (status.className === 'UserStatusOnline') {
      return 'online';
    } else if (status.className === 'UserStatusOffline') {
      return 'offline';
    } else if (status.className === 'UserStatusRecently') {
      return 'recently';
    } else if (status.className === 'UserStatusLastWeek') {
      return 'last_week';
    } else if (status.className === 'UserStatusLastMonth') {
      return 'last_month';
    } else {
      return 'long_time_ago';
    }
  }

  async setupEventHandling(user: User, client: TelegramClient, options?: UpdateOptions) {
    console.log(`Setting up event handling for ${user.phoneNumber} with mode ${user.updateMode}`);
    
    // Remove any existing handlers
    this.clearHandlers(user.phoneNumber);

    // First, catch any errors in the client
    client.setParseMode("html");
    
    // Add handlers based on allowed update types
    const allowedTypes = options?.allowed_updates || DEFAULT_UPDATE_TYPES;

    // Raw event handler for various updates
    client.addEventHandler((update) => {
      switch (update.className) {
        case 'UpdateUserStatus': {
          if (!shouldIncludeUpdate("user_update", options)) break;
          
          const statusUpdate: Update = {
            update_id: this.generateUpdateId(user.phoneNumber),
            user_status: {
              user_id: update.userId.toString(),
              status: this.convertToUserStatus(update.status),
              was_online: update.status.className === 'UserStatusOffline' ? 
                Math.floor(update.status.wasOnline) : undefined
            }
          };
          this.processUpdate(user, statusUpdate);
          break;
        }

        case 'UpdateUserTyping':
        case 'UpdateChannelUserTyping': {
          if (!shouldIncludeUpdate("typing", options)) break;

          const castUpdate = update as Api.UpdateUserTyping | Api.UpdateChannelUserTyping;
          let userId: string | undefined;
          let chatId: string | undefined;

          if (castUpdate.className === 'UpdateUserTyping') {
            userId = castUpdate.userId.toString();
          } else {
            userId = getIdFromPeer(castUpdate.fromId);
            chatId = castUpdate.channelId.toString();
          }

          const typingUpdate: Update = {
            update_id: this.generateUpdateId(user.phoneNumber),
            typing_status: {
              user_id: userId,
              ...(chatId && { chat_id: chatId }),
              action: getTypingAction(castUpdate.action)
            }
          };
          this.processUpdate(user, typingUpdate);
          break;
        }

        case 'UpdateChannel':
        case 'UpdateChannelParticipant':
        case 'UpdateNewChannelMessage': {
          if (!shouldIncludeUpdate("chat_action", options)) break;
          
          const chatAction = getChatAction(update);
          if (!chatAction) break;

          const chatUpdate: Update = {
            update_id: this.generateUpdateId(user.phoneNumber),
            chat_action: {
              chat_id: (update as any).channelId?.toString() || (update as any).chatId?.toString(),
              user_id: (update as any).userId?.toString(),
              action: chatAction.type,
              action_data: chatAction.data
            }
          };
          this.processUpdate(user, chatUpdate);
          break;
        }

        case 'UpdateDeleteMessages': {
          if (!shouldIncludeUpdate("delete", options)) break;
          
          const deleteUpdate: Update = {
            update_id: this.generateUpdateId(user.phoneNumber),
            deleted_message: {
              chat_id: update.chatId?.toString(),
              message_id: update.messages[0],
              deleted_at: Math.floor(Date.now() / 1000)
            }
          };
          this.processUpdate(user, deleteUpdate);
          break;
        }

        case 'UpdateMessageReactions': {
          if (!shouldIncludeUpdate("reaction", options)) break;
          
          const reactionUpdate: Update = {
            update_id: this.generateUpdateId(user.phoneNumber),
            reaction: {
              chat_id: update.peer.chatId?.toString(),
              message_id: update.msgId,
              user_id: update.userId?.toString(),
              reaction: update.newReactions?.map((r: { emoticon: string }) => r.emoticon) || [],
              old_reaction: update.oldReactions?.map((r: { emoticon: string }) => r.emoticon) || [],
              is_big: update.big || false
            }
          };
          this.processUpdate(user, reactionUpdate);
          break;
        }

        // Log unhandled update types to help with future implementations
        default:
          console.log(`Unhandled update type: ${update.className}`);
          break;
      }
    });
    
    // Message handler (new messages and edited messages)
    if (shouldIncludeUpdate("message", options) || 
        shouldIncludeUpdate("edited_message", options) ||
        shouldIncludeUpdate("channel_post", options) ||
        shouldIncludeUpdate("edited_channel_post", options)) {
      const messageHandler = new NewMessage({});
      client.addEventHandler(
        async (event: NewMessageEvent) => {
          const message = event.message as Api.Message;
          let type: UpdateType = message.editDate ? "edited_message" : "message";
          
          // Check if it's a channel post
          if (message.post) {
            type = message.editDate ? "edited_channel_post" : "channel_post";
          }
          
          // Only process if the type is allowed
          if (shouldIncludeUpdate(type, options)) {
            await this.handleMessageUpdate(user, event, type);
          }
        },
        messageHandler
      );
    }

    console.log('Event handlers added successfully');
  }

  private cleanupProcessedMessages() {
    const now = Date.now();
    const expiredTime = now - this.MESSAGE_CACHE_TTL;
    
    // Remove expired entries
    for (const [key, timestamp] of this.processedMessages) {
      if (timestamp < expiredTime) {
        this.processedMessages.delete(key);
      }
    }

    // If still too large, remove oldest entries
    if (this.processedMessages.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.processedMessages.entries())
        .sort(([, a], [, b]) => a - b)
        .slice(0, this.processedMessages.size - this.MAX_CACHE_SIZE);
      
      for (const [key] of entries) {
        this.processedMessages.delete(key);
      }
    }
  }

  private async handleMessageUpdate(user: User, event: NewMessageEvent, type: UpdateType) {
    const message = event.message as Api.Message;
    
    // Skip if we've already processed this message
    const messageKey = `${user.phoneNumber}:${message.id}:${type}`;
    const now = Date.now();
    
    if (this.processedMessages.has(messageKey)) {
      console.log(`Skipping duplicate message ${messageKey}`);
      return;
    }
    
    this.processedMessages.set(messageKey, now);

    // Cleanup old messages periodically
    if (this.processedMessages.size > this.MAX_CACHE_SIZE) {
      this.cleanupProcessedMessages();
    }

    try {
      // Handle media albums
      const messages = handleMediaAlbum(message);
      console.log(`handleMediaAlbum returned ${messages.length} messages`);

      if (messages.length === 0) {
        console.log('Message is part of an album but not ready to be sent yet');
        // Message is part of an album but not ready to be sent yet
        return;
      }

      const handler = this.updateHandlers.get(user.phoneNumber);
      if (messages.length > 1 && shouldIncludeUpdate("album", handler?.options)) {
        console.log('Processing complete album with', messages.length, 'messages');
        // This is a complete album
        const albumMessages = messages.map(msg => convertToMessage(msg as Api.Message));
        const albumId = message.groupedId?.toString();
        
        const albumUpdate: MediaAlbum = {
          album_id: albumId!,
          messages: albumMessages
        };

        const update: Update = {
          update_id: this.generateUpdateId(user.phoneNumber),
          album: albumUpdate
        };

        console.log('Sending album update:', {
          albumId,
          messageCount: albumMessages.length,
          updateMode: user.updateMode,
          hasWebhook: !!user.webhookUrl
        });

        if (user.updateMode === "webhook" && user.webhookUrl) {
          await this.sendWebhook(user, update);
        } else {
          await this.bufferUpdate(user.phoneNumber, update);
        }
      } else {
        // Single message or album disabled
        const isSingleMessage = messages.length === 1;
        const isAlbumDisabled = !shouldIncludeUpdate("album", handler?.options);
        console.log(
          isSingleMessage 
            ? 'Processing single message' 
            : 'Processing album as single messages (album updates disabled)'
        );

        const update: Update = {
          update_id: this.generateUpdateId(user.phoneNumber),
          [type]: convertToMessage(message)
        };

        if (user.updateMode === "webhook" && user.webhookUrl) {
          await this.sendWebhook(user, update);
        } else {
          await this.bufferUpdate(user.phoneNumber, update);
        }
      }
    } catch (error) {
      console.error('Error processing update:', error);
    }
  }

  private async sendWebhook(user: User, update: Update) {
    console.log(`Sending webhook for ${user.phoneNumber} to ${user.webhookUrl}`);
    const maxRetries = 50; // Maximum number of retries
    const baseTimeout = 5000; // Base timeout of 5 seconds
    const maxBackoffTime = 30000; // Maximum backoff time of 30 seconds

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), baseTimeout);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        
        if (user.webhookSecret) {
          headers['X-Telegram-Secret'] = user.webhookSecret;
        }

        const response = await fetch(user.webhookUrl!, {
          method: 'POST',
          headers,
          body: JSON.stringify(update),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
        }
        
        console.log(`Webhook delivered successfully on attempt ${attempt + 1}`);
        return;
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isTimeout = error?.name === 'AbortError';
        
        if (isTimeout) {
          console.error(`Webhook attempt ${attempt + 1}/${maxRetries + 1} timed out after ${baseTimeout}ms`);
        } else {
          let err = `Webhook attempt ${attempt + 1}/${maxRetries + 1} failed`
          if (error?.message) {
            err += `: ${error.message}`;
          }
          console.error(err);
        }

        if (isLastAttempt) {
          console.error(`All webhook attempts failed after ${maxRetries + 1} tries`);
          break;
        }

        // Calculate backoff time with exponential increase and jitter
        const backoffTime = Math.min(
          Math.floor(Math.random() * 200) + Math.pow(2, attempt) * 1000,
          maxBackoffTime
        );
        
        console.log(`Waiting ${backoffTime}ms before retry ${attempt + 2}`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }

  private async bufferUpdate(phoneNumber: string, update: Update) {
    console.log(`Buffering update for ${phoneNumber}`);
    const buffer = this.updateBuffers.get(phoneNumber) || [];
    buffer.push(update);
    this.updateBuffers.set(phoneNumber, buffer);

    // Check if there's a pending getUpdates request
    const handler = this.updateHandlers.get(phoneNumber);
    if (handler) {
      console.log(`Found pending handler for ${phoneNumber}`);
      const updates = this.getBufferedUpdates(phoneNumber, handler.offset);
      if (updates.length > 0) {
        console.log(`Resolving handler with ${updates.length} updates`);
        if (handler.timeoutHandle) {
          clearTimeout(handler.timeoutHandle);
        }
        this.updateHandlers.delete(phoneNumber);
        handler.resolve(updates);
      }
    }
  }

  clearHandlers(phoneNumber: string) {
    const existingHandler = this.updateHandlers.get(phoneNumber);
    if (existingHandler?.timeoutHandle) {
      clearTimeout(existingHandler.timeoutHandle);
    }
    this.updateHandlers.delete(phoneNumber);
    this.updateBuffers.set(phoneNumber, []);
  }

  async getUpdates(user: User, offset?: number, limit: number = 100, timeout: number = 0, options?: UpdateOptions): Promise<Update[]> {
    console.log(`Getting updates for ${user.phoneNumber} with offset ${offset} and timeout ${timeout}`);
    
    // Check if webhook mode is enabled
    if (user.updateMode === "webhook") {
      throw new Error("Updates cannot be retrieved via polling when webhook is enabled. Please delete the webhook first.");
    }

    // Clean up any existing handler
    this.clearHandlers(user.phoneNumber);

    // Check for buffered updates first
    const bufferedUpdates = this.getBufferedUpdates(user.phoneNumber, offset);
    if (bufferedUpdates.length > 0) {
      console.log(`Returning ${bufferedUpdates.length} buffered updates`);
      return bufferedUpdates.slice(0, limit);
    }

    // If no updates and no timeout, return empty array
    if (timeout === 0) {
      console.log('No timeout specified, returning empty array');
      return [];
    }

    // Wait for updates
    return new Promise((resolve, reject) => {
      console.log(`Setting up handler with ${timeout}s timeout`);
      const timeoutHandle = setTimeout(() => {
        console.log('Update timeout reached');
        this.updateHandlers.delete(user.phoneNumber);
        resolve([]);
      }, timeout * 1000);

      this.updateHandlers.set(user.phoneNumber, {
        phoneNumber: user.phoneNumber,
        offset,
        resolve,
        reject,
        timeoutHandle,
        options
      });
    });
  }

  private async processUpdate(user: User, update: Update) {
    if (user.updateMode === "webhook" && user.webhookUrl) {
      await this.sendWebhook(user, update);
    } else {
      await this.bufferUpdate(user.phoneNumber, update);
    }
  }
} 

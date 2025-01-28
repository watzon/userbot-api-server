import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import type { User } from "../../db/schema";
import { db } from "../../db";
import { users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { UpdateManager } from "./UpdateManager";
import type { Update } from "../../types/telegram";

export class TelegramService {
  private clients: Map<string, TelegramClient> = new Map();
  private updateManager: UpdateManager;

  constructor() {
    this.updateManager = new UpdateManager();
    // Initialize all clients on startup
    this.initializeAllClients().catch(error => {
      console.error('Error initializing clients:', error);
    });
  }

  private async initializeAllClients() {
    console.log('Initializing all clients on startup...');
    try {
      // Get all users from the database
      const allUsers = await db.query.users.findMany();
      
      // Initialize each user's client
      for (const user of allUsers) {
        console.log(`Initializing client for ${user.phoneNumber}`);
        try {
          await this.getClient(user);
          console.log(`Successfully initialized client for ${user.phoneNumber}`);
        } catch (error) {
          console.error(`Failed to initialize client for ${user.phoneNumber}:`, error);
        }
      }
      
      console.log('All clients initialized');
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }

  async getClient(user: User): Promise<TelegramClient> {
    const key = user.phoneNumber;
    
    if (this.clients.has(key)) {
      const client = this.clients.get(key)!;
      if (!client.connected) {
        console.log(`Reconnecting existing client for ${key}`);
        await client.connect();
        // Re-setup event handling after reconnect
        await this.updateManager.setupEventHandling(user, client);
      }
      return client;
    }

    console.log(`Creating new client for ${key}`);
    const session = new StringSession(user.sessionString || "");
    const client = new TelegramClient(session, user.apiId, user.apiHash, {
      connectionRetries: 5,
      useWSS: true
    });

    // Always ensure we're connected
    if (!client.connected) {
      console.log(`Connecting new client for ${key}`);
      await client.connect();
    }

    // Ensure we're properly logged in and can catch all updates
    console.log('Ensuring client is properly initialized');
    await client.getMe();
    // await client.getDialogs();

    this.clients.set(key, client);

    // Set up event handling based on user's update mode
    await this.updateManager.setupEventHandling(user, client);

    return client;
  }

  async getUpdates(user: User, offset?: number, limit: number = 100, timeout: number = 0): Promise<Update[]> {
    console.log(`Getting updates for ${user.phoneNumber} with offset ${offset} and timeout ${timeout}`);
    
    // First ensure we have a connected client with event handlers
    console.log('Ensuring client is connected and has event handlers');
    const client = await this.getClient(user);
    
    if (!client.connected) {
      console.log('Client was not connected, connecting now');
      await client.connect();
      // Re-setup event handling after reconnect
      await this.updateManager.setupEventHandling(user, client);
    }

    return this.updateManager.getUpdates(user, offset, limit, timeout);
  }

  async setWebhook(user: User, url: string, secret?: string) {
    console.log(`Setting webhook for ${user.phoneNumber} to ${url}`);

    // Update the user's webhook configuration
    await db.update(users)
      .set({ 
        webhookUrl: url,
        webhookSecret: secret,
        updateMode: "webhook"
      })
      .where(eq(users.phoneNumber, user.phoneNumber));

    // Get the updated user
    const updatedUser = await db.query.users.findFirst({
      where: eq(users.phoneNumber, user.phoneNumber),
    });

    if (!updatedUser) {
      throw new Error("User not found after update");
    }

    // Get the client and update event handling
    const client = await this.getClient(updatedUser);
    await this.updateManager.setupEventHandling(updatedUser, client);

    console.log(`Webhook set successfully for ${user.phoneNumber}`);
  }

  async deleteWebhook(user: User, dropPendingUpdates: boolean = false) {
    // Remove webhook configuration
    await db.update(users)
      .set({ 
        webhookUrl: null,
        webhookSecret: null,
        updateMode: "none"
      })
      .where(eq(users.phoneNumber, user.phoneNumber));

    // Get the client and reset event handling
    const client = await this.getClient(user);
    await this.updateManager.setupEventHandling(user, client);
  }

  async removeClient(phoneNumber: string) {
    const client = this.clients.get(phoneNumber);
    if (client) {
      await client.disconnect();
      this.clients.delete(phoneNumber);
    }
  }

  getSessionString(phoneNumber: string): string | null {
    const client = this.clients.get(phoneNumber);
    if (!client) return null;
    return (client.session as StringSession).save();
  }

  // Add a method to disconnect all clients (useful for cleanup)
  async disconnectAll() {
    for (const [phoneNumber, client] of this.clients.entries()) {
      await this.removeClient(phoneNumber);
    }
  }
}

export const telegramService = new TelegramService(); 
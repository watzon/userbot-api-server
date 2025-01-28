import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import type { User } from '../../db/schema';

const clients = new Map<string, TelegramClient>();

export async function getClient(user: User): Promise<TelegramClient> {
    const existingClient = clients.get(user.phoneNumber);
    if (existingClient) {
        // Ensure the client is connected
        if (!existingClient.connected) {
            await existingClient.connect();
        }
        return existingClient;
    }

    // Create new client
    const session = new StringSession(user.sessionString || '');
    const client = new TelegramClient(session, user.apiId, user.apiHash, {
        connectionRetries: 5,
        useWSS: false,
        deviceModel: "Telegram UserBot API",
        systemVersion: "1.0.0",
        appVersion: "1.0.0",
    });

    await client.connect();
    clients.set(user.phoneNumber, client);
    return client;
}

export async function disconnectClient(phoneNumber: string): Promise<void> {
    const client = clients.get(phoneNumber);
    if (client) {
        await client.disconnect();
        clients.delete(phoneNumber);
    }
}

export async function disconnectAllClients(): Promise<void> {
    for (const [phoneNumber, client] of clients) {
        await disconnectClient(phoneNumber);
    }
} 
import path from "path";
import { TelegramClient } from "telegram";
import { StoreSession } from "telegram/sessions";
import input from "@inquirer/input";

const apiId = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionDir = process.env.SESSION_DIR || "./session";
const stringSession = new StoreSession(path.join(sessionDir, "telegram"));

if (!apiId || !apiHash) {
  throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set");
}

(async () => {
  console.log("Loading interactive example...");
  const client = new TelegramClient(stringSession, Number(apiId), apiHash, {
    connectionRetries: 5,
  });
  await client.start({
    phoneNumber: async () => await input({ message: "Please enter your number: " }),
    password: async () => await input({ message: "Please enter your password: " }),
    phoneCode: async () =>
      await input({ message: "Please enter the code you received: " }),
    onError: (err) => console.log(err),
  });
  console.log("You should now be connected.");
  client.session.save(); // Save this string to avoid logging in again
  await client.sendMessage("me", { message: "Hello!" });
})();
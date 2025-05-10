require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in .env file");
}

const bot = new TelegramBot(token, { polling: true });

const allowedUserIds = process.env.ALLOWED_USER_IDS.split(",").map((id) =>
  parseInt(id.trim())
);

// Logging function to log with timestamp
const log = (message) => {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "Europe/Kyiv",
  });
  console.log(`[${timestamp}] ${message}`);
};

const logError = (message) => {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "Europe/Kyiv",
  });
  console.error(`[${timestamp}] ${message}`);
};

const sendMessage = async (chatId, message, options = {}) => {
  try {
    log(`Sending message to chat ${chatId}: ${message}`);
    return await bot.sendMessage(chatId, message, options);
  } catch (error) {
    logError(`Failed to send message to chat ${chatId}: ${error.message}`);
  }
};

const deleteMessage = async (chatId, messageId) => {
  try {
    log(`Deleting message ${messageId} from chat ${chatId}`);
    await bot.deleteMessage(chatId, messageId);
  } catch (error) {
    logError(`Failed to delete message ${messageId}: ${error.message}`);
  }
};

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  log(`Received /start command from chat ${chatId}`);
  await sendMessage(
    chatId,
    "Send /run_gog, /run_eg, /debug, or /raw to execute the script."
  );
});

const runScript = async (chatId, userId, mode, commandMessageId) => {
  log(`User ${userId} requested /${mode} in chat ${chatId}`);

  if (!allowedUserIds.includes(userId)) {
    await sendMessage(
      chatId,
      "Sorry, you are not authorized to use this command."
    );
    log(`Unauthorized access attempt by user ${userId}`);
    return;
  }

  const scriptMap = {
    run_gog: "./claim_gog.sh",
    run_eg: "./claim_eg.sh",
    // debug: "./claim_debug.sh", // Optional: Add a script for debug if needed
    // raw: "./claim_raw.sh",    // Optional: Add a script for raw if needed
  };

  const scriptPath = scriptMap[mode];
  if (!scriptPath) {
    await sendMessage(chatId, `Invalid mode: ${mode}`);
    logError(`Invalid mode requested: ${mode}`);
    return;
  }

  const statusMessage = await sendMessage(chatId, "Executing script...");

  try {
    log(`Executing script for user ${userId} in mode: ${mode}`);
    const { stdout, stderr } = await execAsync(scriptPath);

    const outputMessage = stderr ? `Error: ${stderr}\n` : stdout;
    await sendMessage(chatId, outputMessage);
    log(`Script execution completed for user ${userId} in mode: ${mode}`);
  } catch (error) {
    logError(`Script execution failed for user ${userId}: ${error.message}`);
    await sendMessage(chatId, `Execution failed: ${error.message}`);
  } finally {
    if (statusMessage) {
      await deleteMessage(chatId, statusMessage.message_id);
    }
    if (commandMessageId) {
      await deleteMessage(chatId, commandMessageId);
    }
  }
};

const commandHandler = async (msg, mode) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commandMessageId = msg.message_id;

  await runScript(chatId, userId, mode, commandMessageId);
};

bot.onText(/\/run_gog/, (msg) => commandHandler(msg, "run_gog"));
bot.onText(/\/run_eg/, (msg) => commandHandler(msg, "run_eg"));
bot.onText(/\/debug/, (msg) => commandHandler(msg, "debug"));
bot.onText(/\/raw/, (msg) => commandHandler(msg, "raw"));

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const util = require("util");
const fs = require("fs").promises;
const path = require("path");

const execAsync = util.promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in .env file");
}

const bot = new TelegramBot(token, { polling: true });

const allowedUserIds = process.env.ALLOWED_USER_IDS.split(",").map((id) =>
  parseInt(id.trim())
);

const lockFiles = {
  run: path.resolve(__dirname, "script_run.lock"),
  debug: path.resolve(__dirname, "script_debug.lock"),
  raw: path.resolve(__dirname, "script_raw.lock"),
};

const sendMessage = async (chatId, message, options = {}) => {
  try {
    return await bot.sendMessage(chatId, message, options);
  } catch (error) {
    console.error(`Failed to send message: ${error.message}`);
  }
};

const deleteMessage = async (chatId, messageId) => {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (error) {
    console.error(`Failed to delete message: ${error.message}`);
  }
};

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await sendMessage(
    chatId,
    "Send /run to execute the script, /debug to execute with debug messages, or /raw to get the raw output."
  );
});

const runScript = async (chatId, userId, mode, commandMessageId) => {
  if (!allowedUserIds.includes(userId)) {
    await sendMessage(
      chatId,
      "Sorry, you are not authorized to use this command."
    );
    return;
  }

  const lockFile = lockFiles[mode];

  try {
    await fs.access(lockFile);
    await sendMessage(chatId, "Script is already running. Please wait.");
    return;
  } catch (error) {
    // Lock file doesn't exist, continue execution
  }

  try {
    await fs.writeFile(lockFile, "locked");
  } catch (error) {
    await sendMessage(chatId, "Failed to create lock file. Try again.");
    return;
  }

  const statusMessage = await sendMessage(chatId, "Looking for free games...");

  try {
    const { stdout, stderr } = await execAsync(
      "~/claim_games_bot/claim_games.sh"
    );

    let outputMessage = stderr ? `Error: ${stderr}\n` : "";
    outputMessage += formatOutput(stdout, mode);

    await sendMessage(chatId, outputMessage, { parse_mode: "Markdown" });
  } catch (error) {
    await sendMessage(chatId, `Execution failed: ${error.message}`);
  } finally {
    await fs.unlink(lockFile);
    if (statusMessage) {
      await deleteMessage(chatId, statusMessage.message_id);
    }
    if (commandMessageId) {
      await deleteMessage(chatId, commandMessageId);
    }
  }
};

const formatOutput = (output, mode) => {
  if (mode === "raw") return output;

  const lines = output.trim().split("\n");
  let formattedMessage = "";
  let epicGamesFound = false;
  let games = [];
  let currentLink = "";

  for (let line of lines) {
    if (mode === "debug") formattedMessage += `Processing line: ${line}\n`;

    if (line.includes("started checking gog")) {
      formattedMessage += `GoG - Currently no free giveaway!\n`;
    } else if (line.includes("started checking epic-games")) {
      formattedMessage += `Epic Games - `;
      epicGamesFound = true;
    } else if (line.includes("Free games:") && epicGamesFound) {
      const matches = line.match(/'([^']+)'/g);
      if (matches) currentLink = matches[0].replace(/'/g, "");
    } else if (line.includes("Current free game:") && epicGamesFound) {
      const gameTitle = line.replace("Current free game: ", "").trim();
      games.push({ title: gameTitle, link: currentLink, inLibrary: false });
    } else if (line.includes("Already in library!") && epicGamesFound) {
      const currentGame = games[games.length - 1];
      if (currentGame) currentGame.inLibrary = true;
    } else if (line.includes("'https://store.epicgames.com/en-US/p/")) {
      currentLink = line.match(/'(.*?)'/)[1];
    }
  }

  games.forEach((game) => {
    formattedMessage += game.link
      ? `[${game.title}](${game.link}) (${
          game.inLibrary ? "Already in library" : "New"
        })\n`
      : `${game.title} (${game.inLibrary ? "Already in library" : "New"})\n`;
  });

  return formattedMessage;
};

const commandHandler = async (msg, mode) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commandMessageId = msg.message_id;
  await runScript(chatId, userId, mode, commandMessageId);
};

bot.onText(/\/run/, (msg) => commandHandler(msg, "run"));
bot.onText(/\/debug/, (msg) => commandHandler(msg, "debug"));
bot.onText(/\/raw/, (msg) => commandHandler(msg, "raw"));

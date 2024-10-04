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
    "Send /run to execute the script, /debug to execute with debug messages, or /raw to get the raw output."
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

  const statusMessage = await sendMessage(chatId, "Looking for free games...");

  try {
    log(`Executing script for user ${userId} in mode: ${mode}`);
    const { stdout, stderr } = await execAsync(
      "~/claim_games_bot/claim_games.sh"
    );

    let outputMessage = stderr ? `Error: ${stderr}\n` : "";
    outputMessage += formatOutput(stdout, mode);

    await sendMessage(chatId, outputMessage, { parse_mode: "Markdown" });
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

const formatOutput = (output, mode) => {
  if (mode === "raw") return output;

  const lines = output.trim().split("\n");
  let formattedMessage = "";
  let epicGamesFound = false;
  let gogFound = false; // Track if any GoG games are found
  let games = [];

  for (let line of lines) {
    if (mode === "debug") formattedMessage += `Processing line: ${line}\n`;

    // GoG logic
    if (line.includes("Currently no free giveaway!")) {
      formattedMessage += "GoG - Currently no free giveaway!\n";
    } else if (line.includes("Current free game:")) {
      const match = line.match(
        /Current free game: (.*?) - (https:\/\/www\.gog\.com\/en\/game\/\S+)/
      );
      if (match) {
        const gameTitle = match[1].trim();
        const gameLink = match[2];
        games.push({ title: gameTitle, link: gameLink, inLibrary: false });
        gogFound = true; // Mark GoG game found
      }
    } else if (line.includes("Already in library!") && games.length > 0) {
      const currentGame = games[games.length - 1];
      if (currentGame) currentGame.inLibrary = true;
    }

    // Epic Games logic
    else if (line.includes("started checking epic-games")) {
      epicGamesFound = true; // Mark that we are checking Epic Games
    } else if (line.includes("Free games:") && epicGamesFound) {
      const linkMatch = line.match(/Free games: \[ '(.*?)' \]/);
      if (linkMatch) {
        const gameLink = linkMatch[1]; // Extracting the link
        const gameTitleMatch = lines[lines.indexOf(line) + 1]?.match(
          /Current free game: (.*)/
        );
        if (gameTitleMatch) {
          const gameTitle = gameTitleMatch[1].trim(); // Title from the next line
          games.push({ title: gameTitle, link: gameLink, inLibrary: false });
        }
      }
    } else if (line.includes("Already in library!") && epicGamesFound) {
      const currentGame = games[games.length - 1];
      if (currentGame) currentGame.inLibrary = true;
    }
  }

  // Output formatting for GoG and Epic Games
  if (gogFound) {
    formattedMessage += "GoG: ";
    games.forEach((game) => {
      if (game.link.includes("gog.com")) {
        formattedMessage += game.link
          ? `[${game.title}](${game.link}) (${
              game.inLibrary ? "Already in library" : "New"
            })\n`
          : `${game.title} (${
              game.inLibrary ? "Already in library" : "New"
            })\n`;
      }
    });
  }

  if (epicGamesFound) {
    formattedMessage += "Epic Games: ";
    games.forEach((game) => {
      if (game.link.includes("epicgames.com")) {
        formattedMessage += game.link
          ? `[${game.title}](${game.link}) (${
              game.inLibrary ? "Already in library" : "New"
            })\n`
          : `${game.title} (${
              game.inLibrary ? "Already in library" : "New"
            })\n`;
      }
    });
  }

  return formattedMessage || "No free games found.";
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

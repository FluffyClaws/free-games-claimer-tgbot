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
  let gogFound = false;
  const games = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mode === "debug") formattedMessage += `Processing line: ${line}\n`;

    // GoG logic
    if (line.includes("Currently no free giveaway!")) {
      formattedMessage += "GoG - Currently no free giveaway!\n";
    } else if (line.includes("Current free game:")) {
      const match = line.match(/Current free game: (.+)/);
      if (match) {
        const gameTitle = match[1].trim();
        games.push({ title: gameTitle, link: null, inLibrary: false });
        gogFound = true;
      }
    }

    // Epic Games logic
    if (line.includes("started checking epic-games")) {
      epicGamesFound = true;
    } else if (line.includes("Free games:") && epicGamesFound) {
      // Collect multiple game links for Epic Games
      while (lines[i + 1] && lines[i + 1].trim().startsWith("'")) {
        const gameLinkMatch = lines[i + 1].match(
          /'(https:\/\/store\.epicgames\.com\/\S+)'/
        );
        if (gameLinkMatch) {
          const currentEpicGame = {
            title: null,
            link: gameLinkMatch[1],
            inLibrary: false,
          };
          games.push(currentEpicGame);
        }
        i++;
      }
    } else if (line.includes("Current free game:")) {
      const gameTitleMatch = line.match(/Current free game: (.+)/);
      if (gameTitleMatch) {
        const gameTitle = gameTitleMatch[1].trim();
        const lastGameWithoutTitle = games.find((game) => !game.title);
        if (lastGameWithoutTitle) {
          lastGameWithoutTitle.title = gameTitle;
        }
      }
    }

    // Handling "Already in library!" line correctly
    if (line.includes("Already in library!")) {
      // The previous line contains the current game's title
      const previousLine = lines[i - 1];
      const titleMatch = previousLine.match(/Current free game: (.+)/);
      if (titleMatch) {
        const gameTitle = titleMatch[1].trim();
        const lastGame = games.find((game) => game.title === gameTitle);
        if (lastGame) {
          lastGame.inLibrary = true; // Mark as inLibrary if the title matches
        }
      }
    }
  }

  // Format the output
  if (gogFound) {
    formattedMessage += "GoG:\n";
    games.forEach((game) => {
      if (game.link?.includes("gog.com")) {
        formattedMessage += `[${game.title || "Unknown"}](${game.link}) (${
          game.inLibrary ? "Already in library" : "New"
        })\n`;
      }
    });
  }

  if (epicGamesFound) {
    formattedMessage += "Epic Games:\n";
    games.forEach((game) => {
      if (game.link?.includes("epicgames.com")) {
        formattedMessage += `[${game.title || "Unknown"}](${game.link}) (${
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

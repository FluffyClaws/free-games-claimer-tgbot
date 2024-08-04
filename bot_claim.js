// Load environment variables from .env file
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec for better async/await handling
const execAsync = util.promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined in .env file");
}

const bot = new TelegramBot(token, { polling: true });

// List of allowed user IDs
const allowedUserIds = process.env.ALLOWED_USER_IDS.split(",").map((id) =>
  parseInt(id.trim())
);

const lockFileRun = path.resolve(__dirname, "script_run.lock");
const lockFileDebug = path.resolve(__dirname, "script_debug.lock");
const lockFileRaw = path.resolve(__dirname, "script_raw.lock");

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "Send /run to execute the script, /debug to execute with debug messages, or /raw to get the raw output."
  );
});

async function runScript(
  chatId,
  userId,
  debugMode = false,
  rawMode = false,
  commandMessageId = null
) {
  // Check if the user is allowed to execute the command
  if (!allowedUserIds.includes(userId)) {
    bot.sendMessage(
      chatId,
      "Sorry, you are not authorized to use this command."
    );
    return;
  }

  // Check which lock file to use
  const lockFile = rawMode
    ? lockFileRaw
    : debugMode
    ? lockFileDebug
    : lockFileRun;

  // Check if the script is already running
  if (fs.existsSync(lockFile)) {
    bot.sendMessage(chatId, "Script is already running. Please wait.");
    return;
  }

  // Create a lock file to prevent concurrent executions
  try {
    fs.writeFileSync(lockFile, "locked");
  } catch (error) {
    bot.sendMessage(chatId, "Failed to create lock file. Try again.");
    return;
  }

  // Send a message indicating that the script is starting and store its ID
  let statusMessage;
  try {
    statusMessage = await bot.sendMessage(chatId, "Looking for free games...");
  } catch (error) {
    bot.sendMessage(chatId, "Failed to send status message.");
    return;
  }

  try {
    // Execute the script
    const { stdout, stderr } = await execAsync(
      "~/claim_games_bot/claim_games.sh"
    );

    // Capture and format output
    let outputMessage = "";
    if (stderr) {
      outputMessage += `Error: ${stderr}\n`;
    }

    if (rawMode) {
      outputMessage += formatRawOutput(stdout);
    } else {
      // Process and format the stdout
      const formattedMessage = debugMode
        ? formatScriptOutputWithDebug(stdout)
        : formatScriptOutput(stdout);

      outputMessage += formattedMessage;
    }

    // Send the formatted message
    await bot.sendMessage(chatId, outputMessage, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `Execution failed: ${error.message}`);
  } finally {
    // Remove the lock file after execution
    try {
      fs.unlinkSync(lockFile);
    } catch (error) {
      // Handle potential error, e.g., file not found
    }

    // Delete the initial status message
    if (statusMessage) {
      try {
        await bot.deleteMessage(chatId, statusMessage.message_id);
      } catch (error) {
        // Handle potential error, e.g., message not found
      }
    }

    // Delete the command message if provided
    if (commandMessageId) {
      try {
        await bot.deleteMessage(chatId, commandMessageId);
      } catch (error) {
        // Handle potential error, e.g., message not found
      }
    }
  }
}

bot.onText(/\/run/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commandMessageId = msg.message_id;
  await runScript(chatId, userId, false, false, commandMessageId);
});

bot.onText(/\/debug/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commandMessageId = msg.message_id;
  await runScript(chatId, userId, true, false, commandMessageId);
});

bot.onText(/\/raw/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commandMessageId = msg.message_id;
  await runScript(chatId, userId, false, true, commandMessageId);
});

// Function to format the raw script output
function formatRawOutput(output) {
  // Simply return the raw output as is
  // If the output is too long, consider splitting it into multiple messages
  return output;
}

// Function to format the script output for /run command
function formatScriptOutput(output) {
  // Split the output by lines
  const lines = output.trim().split("\n");

  // Initialize variables to store formatted sections
  let formattedMessage = "";
  let epicGamesFound = false; // Flag to check if Epic Games section was found
  let games = []; // Array to store game objects with title and link
  let currentLink = ""; // Store the current link being processed

  // Loop through each line of the output
  for (let line of lines) {
    if (line.includes("started checking gog")) {
      formattedMessage += `GoG - Currently no free giveaway!\n`;
    } else if (line.includes("started checking epic-games")) {
      formattedMessage += `Epic Games - `;
      epicGamesFound = true;
    } else if (line.includes("Free games:") && epicGamesFound) {
      // Extract all links from the Free games line
      const matches = line.match(/'([^']+)'/g);
      if (matches) {
        currentLink = matches[0].replace(/'/g, "");
      }
    } else if (line.includes("Current free game:") && epicGamesFound) {
      const gameTitle = line.replace("Current free game: ", "").trim();
      games.push({ title: gameTitle, link: currentLink, inLibrary: false });
    } else if (line.includes("Already in library!") && epicGamesFound) {
      const currentGame = games[games.length - 1];
      if (currentGame) {
        currentGame.inLibrary = true;
      }
    } else if (line.includes("'https://store.epicgames.com/en-US/p/")) {
      currentLink = line.match(/'(.*?)'/)[1];
    }
  }

  // Format the games into the message
  games.forEach((game) => {
    if (game.link) {
      formattedMessage += `[${game.title}](${game.link}) (${
        game.inLibrary ? "Already in library" : "New"
      })\n`;
    } else {
      formattedMessage += `${game.title} (${
        game.inLibrary ? "Already in library" : "New"
      })\n`;
    }
  });

  return formattedMessage;
}

// Function to format the script output with debug messages for /debug command
function formatScriptOutputWithDebug(output) {
  // Split the output by lines
  const lines = output.trim().split("\n");

  // Initialize variables to store formatted sections
  let formattedMessage = "";
  let epicGamesFound = false; // Flag to check if Epic Games section was found
  let games = []; // Array to store game objects with title and link
  let currentLink = ""; // Store the current link being processed

  // Loop through each line of the output
  for (let line of lines) {
    formattedMessage += `Processing line: ${line}\n`; // Debug log to Telegram

    if (line.includes("started checking gog")) {
      formattedMessage += `GoG - Currently no free giveaway!\n`;
    } else if (line.includes("started checking epic-games")) {
      formattedMessage += `Epic Games - `;
      epicGamesFound = true;
    } else if (line.includes("Free games:") && epicGamesFound) {
      // Extract all links from the Free games line
      const matches = line.match(/'([^']+)'/g);
      if (matches) {
        currentLink = matches[0].replace(/'/g, "");
      }
    } else if (line.includes("Current free game:") && epicGamesFound) {
      const gameTitle = line.replace("Current free game: ", "").trim();
      games.push({ title: gameTitle, link: currentLink, inLibrary: false });
    } else if (line.includes("Already in library!") && epicGamesFound) {
      const currentGame = games[games.length - 1];
      if (currentGame) {
        currentGame.inLibrary = true;
      }
    } else if (line.includes("'https://store.epicgames.com/en-US/p/")) {
      currentLink = line.match(/'(.*?)'/)[1];
    }
  }

  // Format the games into the message
  games.forEach((game) => {
    if (game.link) {
      formattedMessage += `[${game.title}](${game.link}) (${
        game.inLibrary ? "Already in library" : "New"
      })\n`;
    } else {
      formattedMessage += `${game.title} (${
        game.inLibrary ? "Already in library" : "New"
      })\n`;
    }
  });

  return formattedMessage;
}

// Load environment variables from .env file
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { exec } = require("child_process");
const util = require("util");

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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Send /run to execute the script.");
});

bot.onText(/\/run/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Check if the user is allowed to execute the command
  if (!allowedUserIds.includes(userId)) {
    bot.sendMessage(
      chatId,
      "Sorry, you are not authorized to use this command."
    );
    return;
  }

  // Send a message indicating that the script is starting
  bot.sendMessage(chatId, "Looking for free games...");

  try {
    // Execute the script
    const { stdout, stderr } = await execAsync(
      "~/claim_games_bot/claim_games.sh"
    );
    if (stderr) {
      // If there is an error, send the error message
      bot.sendMessage(chatId, `Error: ${stderr}`);
    } else {
      // Parse the stdout to format the message
      const formattedMessage = formatScriptOutput(stdout);
      // Send the formatted message
      bot.sendMessage(chatId, formattedMessage, { parse_mode: "Markdown" });
    }
  } catch (error) {
    bot.sendMessage(chatId, `Execution failed: ${error.message}`);
  }
});

// Function to format the script output
function formatScriptOutput(output) {
  // Split the output by lines
  const lines = output.trim().split("\n");

  // Initialize variables to store formatted sections
  let formattedMessage = "";
  let epicGamesFound = false; // Flag to check if Epic Games section was found
  let currentGame = ""; // Store the current game title
  let currentGameLink = ""; // Store the current game link

  // Loop through each line of the output
  for (let line of lines) {
    if (line.includes("started checking gog")) {
      formattedMessage += `GoG - Currently no free giveaway!\n`;
    } else if (line.includes("started checking epic-games")) {
      formattedMessage += `Epic Games - `;
      epicGamesFound = true;
    } else if (line.includes("Free games:") && epicGamesFound) {
      const match = line.match(/\[ '(.+?)' \]/);
      if (match) {
        currentGameLink = match[1];
      }
    } else if (line.includes("Current free game:") && epicGamesFound) {
      currentGame = line.replace("Current free game: ", "").trim();
    } else if (line.includes("Already in library!") && epicGamesFound) {
      formattedMessage += ` [${currentGame}](${currentGameLink}) (Already in library)`;
    }
  }

  return formattedMessage;
}

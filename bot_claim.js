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
      const formattedMessage = formatScriptOutput(stdout, chatId);
      // Send the formatted message
      bot.sendMessage(chatId, formattedMessage, { parse_mode: "Markdown" });
    }
  } catch (error) {
    bot.sendMessage(chatId, `Execution failed: ${error.message}`);
  }
});

// Function to format the script output
function formatScriptOutput(output, chatId) {
  // Split the output by lines
  const lines = output.trim().split("\n");

  // Initialize variables to store formatted sections
  let formattedMessage = "";
  let epicGamesFound = false; // Flag to check if Epic Games section was found
  let games = []; // Array to store game objects with title and link
  let currentLink = ""; // Store the current link being processed

  // Loop through each line of the output
  for (let line of lines) {
    bot.sendMessage(chatId, `Processing line: ${line}`); // Debug log to Telegram

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
        bot.sendMessage(chatId, `Current link: ${currentLink}`); // Debug log to Telegram
      }
    } else if (line.includes("Current free game:") && epicGamesFound) {
      const gameTitle = line.replace("Current free game: ", "").trim();
      games.push({ title: gameTitle, link: currentLink, inLibrary: false });
      bot.sendMessage(
        chatId,
        `Current game: ${gameTitle} with link: ${currentLink}`
      ); // Debug log to Telegram
    } else if (line.includes("Already in library!") && epicGamesFound) {
      const currentGame = games[games.length - 1];
      if (currentGame) {
        currentGame.inLibrary = true;
      }
    } else if (line.includes("'https://store.epicgames.com/en-US/p/")) {
      currentLink = line.match(/'(.*?)'/)[1];
      bot.sendMessage(chatId, `Found game link: ${currentLink}`); // Debug log to Telegram
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

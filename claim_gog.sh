#!/bin/bash

# Load environment variables from .env file
export $(grep -v '^#' /home/claimer/free-games-claimer-tgbot/.env | xargs)

# Function to send a message to Telegram
send_telegram_message() {
  local message="$1"
  local encoded_message=$(echo -e "${message}" | sed ':a;N;$!ba;s/\n/%0A/g')
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ALLOWED_USER_IDS}" \
    -d text="${encoded_message}" > /dev/null
}

# Navigate to the directory containing free-games-claimer scripts
cd ~/free-games-claimer || {
  send_telegram_message "Failed to navigate to the free-games-claimer directory."
  exit 1
}

# Run the Node.js script and capture output
OUTPUT=$(node gog 2>&1 | grep -v "started checking gog")
EXIT_CODE=$?

# Notify the bot about the result
if [ $EXIT_CODE -eq 0 ]; then
  FORMATTED_OUTPUT="✅ GOG Claim Script Executed Successfully%0A%0AOutput:%0A${OUTPUT}"
  send_telegram_message "${FORMATTED_OUTPUT}"
else
  FORMATTED_OUTPUT="❌ GOG Claim Script Failed%0A%0AExit Code: ${EXIT_CODE}%0AOutput:%0A${OUTPUT}"
  send_telegram_message "${FORMATTED_OUTPUT}"
fi
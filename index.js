import CONFIG from './config.js';
import fetch from 'node-fetch';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';

// VARIABLES
let currentBalance = -1;
let isLoaded = false;
let currentBetAmount = CONFIG.STARTING_BET;
let lastWinBalance = -1;
let losses = 0;
let totalDifference = 0;
let shouldRun = true;
//

// direction: "OVER", "UNDER"
const roll = async (amount, threshold, direction) => {
  amount = "" + amount; // Force to string to improve formatting
  let res = await fetch("https://api.withyotta.com/v1/app/games/dice", {
    "headers": {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "app_name": "Yotta",
      "app_version": "6.19.154",
      "authorization": "Bearer " + CONFIG.API_TOKEN,
      "content-type": "application/json;charset=UTF-8",
      "device_id": CONFIG.DEVICE_ID,
      "device_name": "Chrome",
      "platform": "web",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": "\"Android\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site"
    },
    "referrer": "https://members.withyotta.com/",
    "body": `{"wager_amount":${CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? parseFloat(amount) : parseInt(amount)},"wager_currency":"${CONFIG.WAGER_CURRENCY}", "direction":"${direction}","threshold":${threshold},"use_free_play_credit":false}`,
    "method": "POST",
    "mode": "cors",
    "credentials": "include"
  });

  res = await res.json();

  if (res.error_subtitle) {
    console.error("Dice roll error! " + res.error_title + ":" + res.error_subtitle);
    return null;
  }

  return { won: res.dice_game.did_win };
};

const getBalance = async () => {
  let res = await fetch(`https://api.withyotta.com/v1/app/${CONFIG.WAGER_CURRENCY.toLowerCase()}/balance`, {
    "headers": {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "app_name": "Yotta",
      "app_version": "6.19.154",
      "authorization": "Bearer " + CONFIG.API_TOKEN,
      "device_id": CONFIG.DEVICE_ID,
      "device_name": "Chrome",
      "if-none-match": "W/\"f-nAZyQgQl32Vjcvuuv+70v78aIso\"",
      "platform": "web",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": "\"Android\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site"
    },
    "referrer": "https://members.withyotta.com/",
    "body": null,
    "method": "GET",
    "mode": "cors",
    "credentials": "include"
  });

  res = await res.json();

  return CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? parseFloat(res.available) : parseInt(res.balance);
};

const run = async () => {
  if (!isLoaded || !shouldRun) return;
  console.log("+===================================================================+");
  console.log("Balance is now at: " + currentBalance.toFixed(2));
  console.log("Total win/loss is: " + totalDifference.toFixed(2));
  console.log("-----");

  if (currentBalance < CONFIG.SAFETY_VALUE) {
    console.error("WE HIT SAFETY VALUE! BOT IS EXITING.")
    process.exit(0);
    return;
  }

  console.log("Rolling dice with bet: " + currentBetAmount);
  let rollResult = await roll(currentBetAmount, CONFIG.THRESHOLD, CONFIG.DIRECTION);
  if (!rollResult) return; // Errored, so lets stop here.
  const newBalance = await getBalance();
  const diff = newBalance - currentBalance;
  console.log("Dice roll outcome: (diff: " + diff.toFixed(2) + ") (win: " + rollResult.won + ")");

  totalDifference += diff;

  if (rollResult.won && currentBalance > newBalance) {
    console.error("WTF! Yotta is fucking lying.");
    return;
  }

  if (currentBalance > newBalance) {
    console.log("We lost!");
    // we lost, increment and check the loss thresholds to increase bet amount
    losses++;

    // check stop loss
    if (newBalance < (lastWinBalance - CONFIG.STOP_LOSS_THRESHOLD)) {
      lastWinBalance = newBalance; // has to reset last win balance
      currentBetAmount = CONFIG.STARTING_BET;
      console.log("Stop loss detected, resetting to starting bet.")
    } else {
      // check loss thresholds
      if (losses == CONFIG.INITIAL_LOSS_THRESHOLD) {
        currentBetAmount *= CONFIG.INITIAL_INCREASE_PERCENTAGE;
        console.log("Increased bet amount (because of initial losses): " + currentBetAmount.toFixed(2));
      } else if (losses > CONFIG.INITIAL_LOSS_THRESHOLD && ((losses - CONFIG.INITIAL_LOSS_THRESHOLD) % CONFIG.LOSS_THRESHOLD) === 0) {
        currentBetAmount *= CONFIG.LOSS_INCREASE_PERCENTAGE;
        console.log("Reached loss threshold again (losses: " + losses + ")");
      }
    }
  } else {
    losses = 0;
    lastWinBalance = newBalance;
    console.log("We won!");
    // we won, reset bet amount to starting
    currentBetAmount = CONFIG.STARTING_BET;
    console.log("Resetting bet to starting bet because of win: " + currentBetAmount.toFixed(2))
  }

  currentBalance = newBalance;
  io.emit("newData", {
    timestamp: Date.now(),
    value: currentBalance,
    label: new Date().toLocaleTimeString()
  });
  io.emit("bal", currentBalance);
  io.emit("bet", currentBetAmount);
  io.emit("diff", totalDifference);

  setTimeout(run, CONFIG.RUN_DELAY);
};

// Load current balance, then run the bot.
console.log("Loading...")
getBalance().then(loaded => {
  console.log("Loaded! Bot is starting now.")
  currentBalance = loaded;
  lastWinBalance = currentBalance + CONFIG.STOP_LOSS_THRESHOLD;
  isLoaded = true;
}).then(() => {
  if (!CONFIG.DEVELOPMENT) {
    run();
  }
});
//

const app = express();
const server = createServer(app);
const io = new Server(server);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Serve static files
app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
})

io.on('connection', (socket) => {
  console.log("Client connected to webview.");
  socket.emit("status", shouldRun);
  socket.on("toggle", (flag) => {
    console.log("TOGGLING: " + flag)
    if (flag && !shouldRun) {
      shouldRun = true;
      run();
    } else if (!flag && shouldRun) {
      shouldRun = false; // will turn off on its own
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
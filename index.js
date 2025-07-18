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

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
};

// Generic retry function with exponential backoff
const retryWithBackoff = async (fn, retries = RETRY_CONFIG.maxRetries) => {
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (result !== null) {
        return result;
      }
      throw new Error('Function returned null');
    } catch (error) {
      lastError = error;
      
      if (attempt === retries) {
        console.error(`Final attempt failed after ${retries + 1} tries:`, error.message);
        break;
      }
      
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );
      
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return null;
};

// direction: "OVER", "UNDER"
const roll = async (amount, threshold, direction) => {
  const body = `{"wager_amount":${CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? amount.toFixed(2) : amount.toFixed(0)},"wager_currency":"${CONFIG.WAGER_CURRENCY}","direction":"${direction}","threshold":${threshold.toFixed(0)},"use_free_play_credit":false}`;
  
  const makeRequest = async () => {
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
      "body": body,
      "method": "POST",
      "mode": "cors",
      "credentials": "include"
    });

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }

    res = await res.json();

    if (res.error_subtitle) {
      throw new Error(`Dice roll error! ${res.error_title}: ${res.error_subtitle}`);
    }

    return { won: res.dice_game.did_win };
  };

  return await retryWithBackoff(makeRequest);
};

const getBalance = async () => {
  const makeRequest = async () => {
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

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }

    res = await res.json();
    return CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? parseFloat(res.available) : parseInt(res.balance);
  };

  return await retryWithBackoff(makeRequest);
};

const run = async () => {
  if (!isLoaded || !shouldRun) return;
  console.log("+==============================================================================+");
  let msg = `Balance: ${currentBalance.toFixed(2)} | P/L: ${totalDifference.toFixed(2)} | Losses: ${losses} | Bet: ${currentBetAmount.toFixed(4)}`;
  console.log(msg);
  console.log("--" + "-".repeat(msg.length));

  if (currentBalance < CONFIG.SAFETY_VALUE) {
    console.error("WE HIT SAFETY VALUE! BOT IS EXITING.")
    process.exit(0);
    return;
  }

  console.log("Rolling dice with bet: " + currentBetAmount);
  let rollResult = await roll(currentBetAmount, CONFIG.THRESHOLD, CONFIG.DIRECTION);
  if (rollResult === null) {
    console.error("Roll failed after all retries, waiting before next attempt...");
    setTimeout(run, CONFIG.RUN_DELAY * 2); // Wait longer before next attempt
    return;
  }
  
  const newBalance = await getBalance();
  if (newBalance === null) {
    console.error("Balance fetch failed after all retries, waiting before next attempt...");
    setTimeout(run, CONFIG.RUN_DELAY * 2); // Wait longer before next attempt
    return;
  }
  
  const diff = newBalance - currentBalance;
  console.log(`Outcome: ${rollResult.won ? 'WIN' : 'LOSS'} | Diff: ${diff.toFixed(2)}`);

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
      losses = 0;
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
  if (loaded === null) {
    console.error("Failed to load after all retries!");
    return;
  }
  console.log("Loaded! Bot is starting now.")
  currentBalance = loaded;
  lastWinBalance = currentBalance;
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
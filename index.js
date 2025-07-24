import fetch from 'node-fetch';
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import fs from 'fs/promises';
import cookieParser from 'cookie-parser';

import CONFIG, { setConfigStrategy } from './config.js';

// ENHANCED VARIABLES
let STRATEGY = "SAFE";
let currentBalance = -1;
let startingBalance = -1; // Track original balance
let sessionHighBalance = -1; // Track session high for stop loss
let isLoaded = false;
let currentBetAmount = CONFIG.MIN_BET;
let lastWinBalance = -1;
let losses = 0;
let consecutiveLosses = 0;
let totalDifference = 0;
let shouldRun = true;
let isInCooldown = false;
let cooldownEndTime = 0;
let profitTargetReached = false;
let manualStopLoss = false;

const loadConfig = async () => {
  try {
    // Use a cache-busting query parameter to ensure the latest file is loaded
    const configModule = await import(`./config.js?v=${Date.now()}`);
    return {
      strategies: configModule.strategies,
      general: configModule.general,
      default: configModule.default
    };
  } catch (error) {
    console.error("Failed to load config:", error);
    return null;
  }
};

// Enhanced statistics
let sessionStats = {
  startTime: Date.now(),
  totalBets: 0,
  wins: 0,
  losses: 0,
  maxWinStreak: 0,
  maxLossStreak: 0,
  currentWinStreak: 0,
  currentLossStreak: 0,
  largestWin: 0,
  largestLoss: 0,
  totalWagered: 0
};

// Load/save statistics
const loadStats = async () => {
  try {
    const data = await fs.readFile('session_stats.json', 'utf8');
    if (!CONFIG.RESET_STATS_ON_RESTART) {
      const savedStats = JSON.parse(data);
      Object.assign(sessionStats, savedStats);
    }
  } catch (error) {
    console.log("No previous stats found, starting fresh");
  }
};

const saveStats = async () => {
  if (CONFIG.TRACK_STATISTICS) {
    try {
      await fs.writeFile('session_stats.json', JSON.stringify(sessionStats, null, 2));
    } catch (error) {
      console.error("Failed to save stats:", error.message);
    }
  }
};

// Enhanced retry configuration
const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 15000,
  backoffMultiplier: 1.8,
  jitterFactor: 0.1 // Add randomness to prevent synchronized requests
};

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

      const baseDelay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelay
      );

      // Add jitter to prevent thundering herd
      const jitter = baseDelay * RETRY_CONFIG.jitterFactor * (Math.random() - 0.5);
      const delay = Math.max(100, baseDelay + jitter);

      console.log(`Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return null;
};

// Calculate optimal bet size based on current balance and progression
const calculateBetSize = () => {
  const baseBet = Math.max(
    CONFIG.MIN_BET,
    currentBalance * CONFIG.STARTING_BET_PERCENTAGE
  );

  let progressiveBet = baseBet;

  if (losses > 0) {
    // Apply initial progression
    if (losses >= CONFIG.INITIAL_LOSS_THRESHOLD) {
      progressiveBet *= Math.pow(CONFIG.INITIAL_INCREASE_PERCENTAGE, 1);

      // Apply subsequent progressions
      const subsequentLosses = losses - CONFIG.INITIAL_LOSS_THRESHOLD;
      if (subsequentLosses > 0) {
        const progressionSteps = Math.floor(subsequentLosses / CONFIG.LOSS_THRESHOLD) + 1;
        progressiveBet *= Math.pow(CONFIG.LOSS_INCREASE_PERCENTAGE, progressionSteps);
      }
    }
  }

  // Apply caps
  const maxBetByBalance = currentBalance * CONFIG.MAX_BET_PERCENTAGE;
  return Math.min(progressiveBet, maxBetByBalance, CONFIG.ABSOLUTE_MAX_BET);
};

// Enhanced risk checks
const checkRiskLimits = () => {
  // Safety check - absolute minimum balance
  const safetyLimit = startingBalance * CONFIG.SAFETY_PERCENTAGE;
  if (currentBalance <= safetyLimit) {
    console.error(`SAFETY LIMIT REACHED! Balance: ${currentBalance}, Limit: ${safetyLimit}`);
    return 'SAFETY_STOP';
  }

  // Stop loss check - percentage from session high
  const stopLossLimit = sessionHighBalance * (1 - CONFIG.STOP_LOSS_PERCENTAGE);
  if (manualStopLoss || currentBalance <= stopLossLimit) {
    manualStopLoss = false;
    console.error(`STOP LOSS TRIGGERED! Balance: ${currentBalance}, Stop Loss: ${stopLossLimit}`);
    return 'STOP_LOSS';
  }

  // Consecutive loss limit
  if (consecutiveLosses >= CONFIG.MAX_CONSECUTIVE_LOSSES) {
    console.error(`MAX CONSECUTIVE LOSSES REACHED! Count: ${consecutiveLosses}`);
    return 'MAX_LOSSES';
  }

  // Profit target check
  if (CONFIG.PROFIT_TARGET) {
    const profitTarget = startingBalance * (1 + CONFIG.PROFIT_TARGET_PERCENTAGE);
    if (currentBalance >= profitTarget) {
      console.log(`PROFIT TARGET REACHED! Balance: ${currentBalance}, Target: ${profitTarget}`);
      return 'PROFIT_TARGET';
    }
  }

  return 'CONTINUE';
};

const roll = async (amount, threshold, direction) => {
  const body = `{"wager_amount":${CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? amount.toFixed(2) : Math.ceil(amount)},"wager_currency":"${CONFIG.WAGER_CURRENCY}","direction":"${direction}","threshold":${threshold.toFixed(0)},"use_free_play_credit":false}`;

  const makeRequest = async () => {
    const res = await fetch("https://api.withyotta.com/v1/app/games/dice", {
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

    const result = await res.json();

    if (result.error_subtitle) {
      throw new Error(`Dice roll error! ${result.error_title}: ${result.error_subtitle}`);
    }

    return {
      won: result.dice_game.did_win,
      roll_value: result.dice_game.roll_value || 0,
      payout: result.dice_game.payout || 0
    };
  };

  return await retryWithBackoff(makeRequest);
};

const getBalance = async () => {
  const makeRequest = async () => {
    const res = await fetch(`https://api.withyotta.com/v1/app/${CONFIG.WAGER_CURRENCY.toLowerCase()}/balance`, {
      "headers": {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "app_name": "Yotta",
        "app_version": "6.19.154",
        "authorization": "Bearer " + CONFIG.API_TOKEN,
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
      "method": "GET",
      "mode": "cors",
      "credentials": "include"
    });

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }

    const result = await res.json();
    return CONFIG.WAGER_CURRENCY === "YOTTA_CASH" ? parseFloat(result.available) : parseInt(result.balance);
  };

  return await retryWithBackoff(makeRequest);
};

const updateStatistics = (won, betAmount, winAmount = 0) => {
  sessionStats.totalBets++;
  sessionStats.totalWagered += betAmount;

  if (won) {
    sessionStats.wins++;
    sessionStats.currentWinStreak++;
    sessionStats.currentLossStreak = 0;
    sessionStats.maxWinStreak = Math.max(sessionStats.maxWinStreak, sessionStats.currentWinStreak);
    sessionStats.largestWin = Math.max(sessionStats.largestWin, winAmount);
  } else {
    sessionStats.losses++;
    sessionStats.currentLossStreak++;
    sessionStats.currentWinStreak = 0;
    sessionStats.maxLossStreak = Math.max(sessionStats.maxLossStreak, sessionStats.currentLossStreak);
    sessionStats.largestLoss = Math.max(sessionStats.largestLoss, betAmount);
  }

  saveStats();
};

const printStatistics = () => {
  const runtime = (Date.now() - sessionStats.startTime) / 1000 / 60; // minutes
  const winRate = sessionStats.totalBets > 0 ? (sessionStats.wins / sessionStats.totalBets * 100).toFixed(2) : '0.00';
  const avgBet = sessionStats.totalBets > 0 ? (sessionStats.totalWagered / sessionStats.totalBets).toFixed(2) : '0.00';

  console.log(`SESSION STATS (${runtime.toFixed(1)}m) | Win Rate: ${winRate}% | Avg Bet: ${avgBet}`);
  console.log(`Bets: ${sessionStats.totalBets} | W/L: ${sessionStats.wins}/${sessionStats.losses} | Streaks: ${sessionStats.maxWinStreak}W/${sessionStats.maxLossStreak}L`);
};

const run = async () => {
  if (!isLoaded || !shouldRun) return;

  // Check cooldown
  if (isInCooldown && Date.now() < cooldownEndTime) {
    const remainingCooldown = Math.ceil((cooldownEndTime - Date.now()) / 1000);
    console.log(`Cooldown active: ${remainingCooldown}s remaining`);
    setTimeout(run, 5000);
    return;
  } else if (isInCooldown) {
    isInCooldown = false;
    console.log("Cooldown ended, resuming operations");
  }

  console.log("+" + "=".repeat(80) + "+");

  // Check risk limits
  const riskStatus = checkRiskLimits();
  if (riskStatus !== 'CONTINUE') {
    if (riskStatus === 'SAFETY_STOP') {
      console.error("SAFETY STOP - Bot exiting permanently");
      io.emit("safetyLimitReached");
      setTimeout(() => process.exit(0), 5000); // Give time for popup
      return;
    } else if (['STOP_LOSS', 'MAX_LOSSES'].includes(riskStatus)) {
      console.log(`Entering cooldown period (${CONFIG.COOLDOWN_AFTER_STOP_LOSS / 1000}s)`);
      isInCooldown = true;
      cooldownEndTime = Date.now() + CONFIG.COOLDOWN_AFTER_STOP_LOSS;

      // Reset progression
      losses = 0;
      consecutiveLosses = 0;
      sessionHighBalance = currentBalance; // Reset high water mark

      setTimeout(run, CONFIG.COOLDOWN_AFTER_STOP_LOSS);
      return;
    } else if (riskStatus === 'PROFIT_TARGET') {
      console.log("Profit target reached! Stopping bot.");
      shouldRun = false;
      profitTargetReached = true; // Set the flag
      io.emit("status", shouldRun);
      io.emit("profitTargetReached");
      return;
    }
  }

  // Calculate bet size
  currentBetAmount = calculateBetSize();

  const balanceInfo = `Balance: ${currentBalance.toFixed(2)} | P/L: ${totalDifference >= 0 ? '+' : ''}${totalDifference.toFixed(2)}`;
  const lossInfo = `Losses: ${losses}/${consecutiveLosses} | Bet: ${currentBetAmount.toFixed(2)}`;
  console.log(`${balanceInfo} | ${lossInfo}`);
  console.log("--" + "-".repeat(78));

  if (CONFIG.TRACK_STATISTICS && sessionStats.totalBets % 10 === 0) {
    printStatistics();
  }

  console.log(`Rolling dice: ${currentBetAmount.toFixed(2)} @ ${CONFIG.THRESHOLD}+ (${CONFIG.DIRECTION})`);

  const rollResult = await roll(currentBetAmount, CONFIG.THRESHOLD, CONFIG.DIRECTION);
  if (rollResult === null) {
    console.error("Roll failed after all retries, waiting before next attempt...");
    setTimeout(run, CONFIG.RUN_DELAY * 3);
    return;
  }

  const newBalance = await getBalance();
  if (newBalance === null) {
    console.error("Balance fetch failed, waiting before next attempt...");
    setTimeout(run, CONFIG.RUN_DELAY * 3);
    return;
  }

  const diff = newBalance - currentBalance;
  const outcome = rollResult.won ? 'WIN' : 'LOSS';
  console.log(`${outcome} | Roll: ${rollResult.roll_value || 'N/A'} | Diff: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`);

  totalDifference += diff;
  updateStatistics(rollResult.won, currentBetAmount, Math.abs(diff));

  // Update session high
  if (newBalance > sessionHighBalance) {
    sessionHighBalance = newBalance;
  }

  if (rollResult.won) {
    // Win logic
    losses = 0;
    consecutiveLosses = 0;
    lastWinBalance = newBalance;
    console.log("Resetting progression after win");
  } else {
    // Loss logic
    losses++;
    consecutiveLosses++;
    console.log(`Loss #${losses} (consecutive: ${consecutiveLosses})`);
  }

  currentBalance = newBalance;

  // Emit to frontend
  io.emit("newData", {
    timestamp: Date.now(),
    value: currentBalance,
    label: new Date().toLocaleTimeString()
  });
  io.emit("bal", currentBalance);
  io.emit("bet", currentBetAmount);
  io.emit("diff", totalDifference);
  io.emit("stats", sessionStats);

  setTimeout(run, CONFIG.RUN_DELAY);
};

// Initialize bot
console.log("Loading optimized dice bot...");
loadStats().then(() => {
  return getBalance();
}).then(loaded => {
  if (loaded === null) {
    console.error("Failed to load balance after all retries!");
    return;
  }
  console.log("Loaded! Starting bot with advanced risk management");
  currentBalance = loaded;
  startingBalance = loaded;
  lastWinBalance = currentBalance;
  sessionHighBalance = currentBalance;
  isLoaded = true;

  if (!CONFIG.DEVELOPMENT) {
    run();
  }
});

// Express server setup
const app = express();
const server = createServer(app);
const io = new Server(server);
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(cookieParser());

// Password protection middleware
app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path === '/login' || req.path === '/style.css') {
    return next();
  }

  if (req.cookies.password === process.env.APP_PASSWORD) {
    return next();
  }

  res.redirect('/login.html');
});

app.use(express.static(join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.APP_PASSWORD) {
    res.cookie('password', password, { httpOnly: true, maxAge: 86400000 * 30 }); // 30 days
    res.status(200).json({ message: 'Login successful' });
  } else {
    res.status(401).json({ message: 'Invalid password' });
  }
});

io.use((socket, next) => {
    const cookies = socket.handshake.headers.cookie;
    const parsedCookies = cookies ? Object.fromEntries(cookies.split(';').map(c => c.trim().split('='))) : {};
    if (parsedCookies.password === process.env.APP_PASSWORD) {
        return next();
    }
    next(new Error('Authentication error'));
});

io.on('connection', (socket) => {
  console.log("Client connected to webview");
  socket.emit("status", shouldRun);
  socket.emit("stats", sessionStats);
  socket.emit("config", { STRATEGY, ...CONFIG });

  socket.on("toggle", (flag) => {
    console.log("TOGGLING BOT: " + flag);
    if (flag && !shouldRun) {
      if (profitTargetReached) {
        console.log("Resetting for new session after profit target.");
        startingBalance = currentBalance;
        sessionHighBalance = currentBalance;
        totalDifference = 0;
        profitTargetReached = false;
      }
      shouldRun = true;
      run();
    } else if (!flag && shouldRun) {
      shouldRun = false;
    }
  });

  socket.on("resetStats", () => {
    console.log("Resetting statistics");
    Object.assign(sessionStats, {
      startTime: Date.now(),
      totalBets: 0,
      wins: 0,
      losses: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
      currentWinStreak: 0,
      currentLossStreak: 0,
      largestWin: 0,
      largestLoss: 0,
      totalWagered: 0
    });
    saveStats();
    socket.emit("stats", sessionStats);
  });

  socket.on("reloadConfig", async () => {
    console.log("Reloading configuration from file...");
    const newConfig = await loadConfig();
    if (newConfig) {
      // Update the strategies in the config module
      Object.assign(CONFIG, newConfig.default);
      setConfigStrategy(STRATEGY, newConfig.strategies);
      io.emit("config", { STRATEGY, ...CONFIG });
      socket.emit("configReloaded", "Configuration reloaded successfully!");
    } else {
      socket.emit("configReloaded", "Failed to reload configuration.");
    }
  });

  socket.on("setStrategy", async (strategy) => {
    console.log(`Setting strategy to: ${strategy}`);
    STRATEGY = strategy;
    setConfigStrategy(strategy); // This will use the in-memory strategies
    io.emit("config", { STRATEGY: strategy, ...CONFIG });
  });

  socket.on("manualStopLoss", () => {
    console.log("Manual stop loss triggered by user.");
    manualStopLoss = true;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
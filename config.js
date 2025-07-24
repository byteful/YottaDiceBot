import 'dotenv/config';

export let STRATEGY = "AGGRESSIVE"; // "SAFE" or "AGGRESSIVE"

export const general = {
    DEVELOPMENT: false,
    API_TOKEN: process.env.API_TOKEN,
    WAGER_CURRENCY: "TOKENS", // "TOKENS" or "YOTTA_CASH"
    DEVICE_ID: process.env.DEVICE_ID,
    RUN_DELAY: 100, // milliseconds
    DIRECTION: "OVER",
    TRACK_STATISTICS: true,
    RESET_STATS_ON_RESTART: false,
    PROFIT_TARGET: false,
};

export const strategies = {
    SAFE: {
        THRESHOLD: 94,
        INITIAL_INCREASE_PERCENTAGE: 4,
        INITIAL_LOSS_THRESHOLD: 7,
        LOSS_INCREASE_PERCENTAGE: 1,
        LOSS_THRESHOLD: 5,
        STARTING_BET_PERCENTAGE: 0.0005,
        MIN_BET: 1,
        MAX_BET_PERCENTAGE: 0.02,
        ABSOLUTE_MAX_BET: 500,
        STOP_LOSS_PERCENTAGE: 0.25,
        SAFETY_PERCENTAGE: 0.15,
        PROFIT_TARGET_PERCENTAGE: 0.15,
        MAX_CONSECUTIVE_LOSSES: 20,
        COOLDOWN_AFTER_STOP_LOSS: 100,
    },
    AGGRESSIVE: {
        THRESHOLD: 96,
        INITIAL_INCREASE_PERCENTAGE: 1.1,
        INITIAL_LOSS_THRESHOLD: 1,
        LOSS_INCREASE_PERCENTAGE: 1.1,
        LOSS_THRESHOLD: 1,
        STARTING_BET_PERCENTAGE: 0.001,
        MIN_BET: 1,
        MAX_BET_PERCENTAGE: 0.2,
        ABSOLUTE_MAX_BET: 1000,
        STOP_LOSS_PERCENTAGE: 0.6,
        SAFETY_PERCENTAGE: 0.1,
        PROFIT_TARGET_PERCENTAGE: 0.2,
        MAX_CONSECUTIVE_LOSSES: 70,
        COOLDOWN_AFTER_STOP_LOSS: 10,
    }
};

let config = {
    ...general,
    ...strategies[STRATEGY]
};

export const setConfigStrategy = (newStrategy, newStrategies) => {
    const strategySource = newStrategies || strategies;
    if (strategySource[newStrategy]) {
        STRATEGY = newStrategy;
        // Mutate the existing config object to ensure all imports see the change
        for (const key in config) {
            delete config[key];
        }
        Object.assign(config, general, strategySource[newStrategy]);
        console.log(`Strategy changed to ${STRATEGY}`);
    } else {
        console.error(`Invalid strategy: ${newStrategy}`);
    }
};

export default config;
import 'dotenv/config';

export default {
    DEVELOPMENT: false, // disables betting and only hosts frontend
    API_TOKEN: process.env.API_TOKEN,
    WAGER_CURRENCY: "YOTTA_CASH", // "TOKENS" or "YOTTA_CASH"
    DEVICE_ID: process.env.DEVICE_ID,
    INITIAL_INCREASE_PERCENTAGE: 5.00, // 400% increase after the first x losses,
    INITIAL_LOSS_THRESHOLD: 7, // the number of initial losses before initial increase percentage is applied
    LOSS_INCREASE_PERCENTAGE: 2.00, // 200% increase every x losses after the initial x losses
    LOSS_THRESHOLD: 5, // the number of losses before increase percentage is applied
    RUN_DELAY: 1000, // milliseconds between each bet,
    STARTING_BET: 0.01, // the amount to start the bot with,
    STOP_LOSS_THRESHOLD: 15.00, // the amount subtracted from the last win balance to determine when to reset the bet amount to starting bet
    SAFETY_VALUE: 50.00, // if balance drops below this, the betting stops
    THRESHOLD: 87, // yotta dice game threshold
    DIRECTION: "OVER", // yotta dice game direction
}
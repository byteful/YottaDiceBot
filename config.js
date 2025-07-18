import 'dotenv/config';

export default {
    DEVELOPMENT: false, // disables betting and only hosts frontend
    API_TOKEN: process.env.API_TOKEN,
    WAGER_CURRENCY: "YOTTA_CASH", // "TOKENS" or "YOTTA_CASH"
    DEVICE_ID: process.env.DEVICE_ID,
    
    // MATHEMATICALLY OPTIMAL PROGRESSION
    INITIAL_INCREASE_PERCENTAGE: 1.618, // Golden ratio - mathematically optimal growth
    INITIAL_LOSS_THRESHOLD: 2, // Quick adaptation for faster recovery
    LOSS_INCREASE_PERCENTAGE: 1.618, // Golden ratio maintains optimal risk/reward
    LOSS_THRESHOLD: 2, // Consistent with initial threshold
    
    // OPTIMAL TIMING
    RUN_DELAY: 1000, // Fastest safe execution for compound growth
    
    // OPTIMAL BET SIZING
    STARTING_BET: 0.01, // Keep small for progression math
    
    // MATHEMATICALLY DERIVED RISK MANAGEMENT
    STOP_LOSS_THRESHOLD: 6.18, // Golden ratio applied to risk management
    SAFETY_VALUE: 20.00, // 20% of typical starting balance for early protection
    
    // GAME SETTINGS
    THRESHOLD: 53,
    DIRECTION: "OVER",
}
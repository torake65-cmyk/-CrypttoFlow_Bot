require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

// Initialize bot
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store user data (in production, use a database)
let userAlerts = {};
let userPreferences = {};

// Load data if exists
if (fs.existsSync('./data.json')) {
  const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
  userAlerts = data.alerts || {};
  userPreferences = data.preferences || {};
}

// Save data
function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify({ alerts: userAlerts, preferences: userPreferences }, null, 2));
}

// Crypto symbols with proper formatting
const cryptoList = {
  'btc': 'Bitcoin',
  'eth': 'Ethereum',
  'bnb': 'BNB',
  'ada': 'Cardano',
  'sol': 'Solana',
  'xrp': 'Ripple',
  'dot': 'Polkadot',
  'doge': 'Dogecoin',
  'avax': 'Avalanche',
  'matic': 'Polygon'
};

// Get crypto price from CoinGecko (free API)
async function getCryptoPrice(coinId) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
    );
    return response.data[coinId]?.usd || null;
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Get multiple prices
async function getMultiplePrices(coinIds) {
  try {
    const ids = coinIds.join(',');
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    return response.data;
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Check alerts
async function checkAlerts() {
  console.log('Checking alerts...');
  const allCoins = Object.keys(cryptoList);
  
  for (let userId in userAlerts) {
    const alerts = userAlerts[userId];
    if (!alerts || alerts.length === 0) continue;

    const coinIds = alerts.map(alert => alert.coinId);
    const prices = await getMultiplePrices(coinIds);
    
    if (!prices) continue;

    for (let alert of alerts) {
      const currentPrice = prices[alert.coinId]?.usd;
      if (!currentPrice) continue;

      // Check if price crossed the alert threshold
      if (alert.type === 'above' && currentPrice >= alert.targetPrice) {
        bot.sendMessage(
          userId,
          `🚨 *PRICE ALERT!*\n\n` +
          `📊 ${cryptoList[alert.coinId]}\n` +
          `💰 Current: $${currentPrice.toFixed(2)}\n` +
          `🎯 Target: $${alert.targetPrice.toFixed(2)}\n` +
          `⬆️ Price is ABOVE your target!`,
          { parse_mode: 'Markdown' }
        );
        // Remove alert after triggering
        userAlerts[userId] = userAlerts[userId].filter(a => a !== alert);
        saveData();
      } else if (alert.type === 'below' && currentPrice <= alert.targetPrice) {
        bot.sendMessage(
          userId,
          `🚨 *PRICE ALERT!*\n\n` +
          `📊 ${cryptoList[alert.coinId]}\n` +
          `💰 Current: $${currentPrice.toFixed(2)}\n` +
          `🎯 Target: $${alert.targetPrice.toFixed(2)}\n` +
          `⬇️ Price is BELOW your target!`,
          { parse_mode: 'Markdown' }
        );
        userAlerts[userId] = userAlerts[userId].filter(a => a !== alert);
        saveData();
      }
    }
  }
}

// Check alerts every 60 seconds
cron.schedule('* * * * *', () => {
  checkAlerts();
});

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = 
    `🤖 *Welcome to CryptoFlow Bot!*\n\n` +
    `Your personal crypto price tracker and alert system.\n\n` +
    `📌 *Available Commands:*\n` +
    `/price [coin] - Get current price (e.g., /price btc)\n` +
    `/alert [coin] [price] - Set price alert (e.g., /alert btc 50000)\n` +
    `/alerts - View your active alerts\n` +
    `/remove [id] - Remove a specific alert\n` +
    `/list - Show available cryptocurrencies\n` +
    `/help - Display this help message\n` +
    `/about - About this bot\n\n` +
    `🔒 *100% Free & Non-Custodial*`;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Price command
bot.onText(/\/price (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coinQuery = match[1].toLowerCase();
  
  // Check if it's a known coin or direct symbol
  let coinId = coinQuery;
  if (cryptoList[coinQuery]) {
    coinId = coinQuery;
  } else {
    // Try to find in list
    const found = Object.keys(cryptoList).find(key => 
      key.includes(coinQuery) || cryptoList[key].toLowerCase().includes(coinQuery)
    );
    if (found) coinId = found;
  }

  const price = await getCryptoPrice(coinId);
  if (price !== null) {
    bot.sendMessage(
      chatId,
      `📊 *${cryptoList[coinId] || coinId.toUpperCase()} Price*\n\n` +
      `💰 Current: $${price.toFixed(2)} USD\n` +
      `⏰ Updated: ${new Date().toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(
      chatId,
      `❌ Could not find price for "${coinQuery}".\n` +
      `Use /list to see available cryptocurrencies.`
    );
  }
});

// Alert command
bot.onText(/\/alert (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coinQuery = match[1].toLowerCase();
  const targetPrice = parseFloat(match[2]);

  if (isNaN(targetPrice) || targetPrice <= 0) {
    bot.sendMessage(chatId, '❌ Please enter a valid price!');
    return;
  }

  let coinId = coinQuery;
  if (cryptoList[coinQuery]) {
    coinId = coinQuery;
  } else {
    const found = Object.keys(cryptoList).find(key => 
      key.includes(coinQuery) || cryptoList[key].toLowerCase().includes(coinQuery)
    );
    if (found) coinId = found;
    else {
      bot.sendMessage(chatId, `❌ Cryptocurrency "${coinQuery}" not found. Use /list to see available coins.`);
      return;
    }
  }

  // Get current price to determine alert type
  const currentPrice = await getCryptoPrice(coinId);
  if (currentPrice === null) {
    bot.sendMessage(chatId, '❌ Unable to fetch current price. Please try again.');
    return;
  }

  const alertType = targetPrice > currentPrice ? 'above' : 'below';
  
  // Save alert
  if (!userAlerts[chatId]) userAlerts[chatId] = [];
  userAlerts[chatId].push({
    coinId: coinId,
    targetPrice: targetPrice,
    type: alertType,
    timestamp: Date.now()
  });
  saveData();

  bot.sendMessage(
    chatId,
    `✅ *Alert Set!*\n\n` +
    `📊 ${cryptoList[coinId]}\n` +
    `🎯 Target: $${targetPrice.toFixed(2)}\n` +
    `📈 Current: $${currentPrice.toFixed(2)}\n` +
    `🔔 Alert when price goes ${alertType === 'above' ? '⬆️ ABOVE' : '⬇️ BELOW'} target`,
    { parse_mode: 'Markdown' }
  );
});

// View alerts
bot.onText(/\/alerts/, (msg) => {
  const chatId = msg.chat.id;
  const alerts = userAlerts[chatId] || [];

  if (alerts.length === 0) {
    bot.sendMessage(chatId, '📭 You have no active alerts.');
    return;
  }

  let message = '🔔 *Your Active Alerts*\n\n';
  alerts.forEach((alert, index) => {
    message += `${index + 1}. ${cryptoList[alert.coinId]}: $${alert.targetPrice.toFixed(2)} ` +
               `(Alert when ${alert.type === 'above' ? '⬆️ above' : '⬇️ below'})\n`;
  });
  message += '\nUse /remove [id] to remove an alert.';

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Remove alert
bot.onText(/\/remove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1]) - 1;

  if (!userAlerts[chatId] || id < 0 || id >= userAlerts[chatId].length) {
    bot.sendMessage(chatId, '❌ Invalid alert ID. Use /alerts to see your alerts.');
    return;
  }

  const removed = userAlerts[chatId].splice(id, 1)[0];
  saveData();
  bot.sendMessage(
    chatId,
    `✅ Alert removed for ${cryptoList[removed.coinId]} at $${removed.targetPrice.toFixed(2)}`
  );
});

// List available coins
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  let message = '📊 *Available Cryptocurrencies*\n\n';
  Object.entries(cryptoList).forEach(([id, name]) => {
    message += `• /price ${id} - ${name}\n`;
  });
  message += '\n💡 Use /price [coin] to check price';
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = 
    `📚 *Help & Commands*\n\n` +
    `🔹 /price [coin] - Get current price\n` +
    `🔹 /alert [coin] [price] - Set price alert\n` +
    `🔹 /alerts - View active alerts\n` +
    `🔹 /remove [id] - Remove an alert\n` +
    `🔹 /list - See all cryptocurrencies\n` +
    `🔹 /about - About this bot\n\n` +
    `📝 *Examples:*\n` +
    `/price btc - Check Bitcoin price\n` +
    `/alert eth 3000 - Alert when ETH hits $3000\n\n` +
    `🔒 *No financial transactions are handled here.*`;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// About command
bot.onText(/\/about/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `🤖 *CryptoFlow Bot v1.0*\n\n` +
    `A non-custodial crypto price tracker and alert system.\n\n` +
    `✨ *Features:*\n` +
    `• Real-time price updates\n` +
    `• Custom price alerts\n` +
    `• 100+ cryptocurrencies\n` +
    `• Free & secure\n\n` +
    `📊 *Powered by CoinGecko API*\n` +
    `🔒 *No financial transactions or data storage*`,
    { parse_mode: 'Markdown' }
  );
});

// Default response
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text.startsWith('/')) {
    bot.sendMessage(
      chatId,
      `❓ I don't understand that command.\n` +
      `Use /help to see available commands.`
    );
  }
});

console.log('🚀 CryptoFlow Bot is running...');
console.log(`📊 Tracking ${Object.keys(cryptoList).length} cryptocurrencies`);

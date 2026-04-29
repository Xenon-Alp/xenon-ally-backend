const fs = require("fs");

let users = {};

const linkedDiscordUsers = {};

try {
  const data = fs.readFileSync("users.json");
  users = JSON.parse(data);
} catch (err) {
  console.log("No users file, starting fresh");
}

require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
console.log("Whop key loaded:", process.env.WHOP_API_KEY ? "YES" : "NO");

const app = express();
const PORT = 3000;

const client = new Client({
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
],
});

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
});





const activeSubscriptions = {
  "testuser": true
};

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Xenon Ally backend is running");
});

async function checkWhopSubscription(username) {
  try {
    const res = await axios.get("https://api.whop.com/api/v2/memberships", {
      headers: {
        Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
      },
    });

   

    const memberships = res.data.data;

    

  const userFound = memberships.find((m) => {
  if (m.status !== "active") return false;

  const answers = m.custom_field_responses || [];

  return answers.some(
    (a) =>
      a.question === "Enter your TradingView username" &&
      a.answer === username
  );
});

    return userFound;
  } catch (err) {
    console.log("Whop error:", err.message);
    return false;
  }
}

app.post("/webhook", async (req, res) => {
  console.log("Signal received:");
  console.log(req.body);

  const { user, pair, signal } = req.body;
const cleanPair = pair.replace(".P", "").trim();

  try {
    let currentPrice = "N/A";
    let priceChange = "N/A";
    let marketTrend = "N/A";
let volumeStatus = "N/A";

    try {
     const marketData = await axios.get(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${cleanPair}`
      );

      currentPrice = marketData.data.lastPrice;
      priceChange = marketData.data.priceChangePercent;
      const volume = marketData.data.volume;
     marketTrend =
  priceChange >= 0 ? "Bullish 📈" : "Bearish 📉";

volumeStatus =
  volume > 1000000 ? "High 🔥" : "Normal ✅";
    } catch (err) {
      console.log("Binance data not available for:", cleanPair);
    }

    const whopMember = await checkWhopSubscription(user);

    if (!whopMember) {
      console.log("❌ Not subscribed (Whop):", user);
      return res.json({ message: "User not subscribed" });
    }

    const discordId = whopMember?.discord?.id;
    const telegramId = whopMember?.telegram_account_id;

    if (!discordId && !telegramId) {
      console.log("❌ No Discord or Telegram connected:", user);
      return res.json({ message: "No connected account found" });
    }

    const directionEmoji = signal === "BUY" ? "🟢" : "🔴";
    const signalTitle = signal === "BUY" ? "BUY SIGNAL" : "SELL SIGNAL";

  let insight = "";

if (signal === "BUY") {
  if (marketTrend.includes("Bullish") && volumeStatus.includes("High")) {

      insight =
  `${pair} is currently showing strong bullish momentum with elevated trading activity. Market conditions are favoring buyers, but confirmation before entry is still recommended.`;
  } else if (marketTrend.includes("Bullish")) {
    
    insight =
  `${pair} is maintaining bullish market conditions with moderate activity levels. Momentum remains positive, but waiting for confirmation could reduce risk.`;
  } else {
    insight =
      "Mixed market conditions detected. Manage risk carefully before entering.";
  }
}

if (signal === "SELL") {
  if (marketTrend.includes("Bearish") && volumeStatus.includes("High")) {
   insight =
  `${pair} is currently under strong bearish pressure with elevated selling activity. Sellers remain in control, so confirmation and proper risk management are important before entry.`;
  } else if (marketTrend.includes("Bearish")) {
insight =
  `${pair} continues to show bearish market conditions with moderate momentum. Waiting for continuation confirmation may help avoid weak entries.`;
  } else {
    insight =
      "Market structure appears mixed. Trade cautiously and manage exposure.";
  }
}

    if (discordId) {
      const targetUser = await client.users.fetch(discordId);

      await targetUser.send(
`🚨 **XENON ALPHA PRO SIGNAL**

━━━━━━━━━━━━━━
📊 **Pair:** ${pair}
💰 **Price:** ${currentPrice}
📈 **24h Change:** ${priceChange}%
📊 **Trend:** ${marketTrend}
🔥 **Volume:** ${volumeStatus}
${directionEmoji} **${signalTitle}**

🤖 **Ally Insight**
${insight}

⚠️ **Risk Reminder:** Use proper position sizing.

⚡ Powered by **Ally**`
      );

      console.log("Discord DM sent!");
    }

    if (telegramId) {
      await telegramBot.sendMessage(
        telegramId,
`🚨 XENON ALPHA PRO SIGNAL

━━━━━━━━━━━━━━
📊 Pair: ${pair}
💰 Price: ${currentPrice}
📈 24h Change: ${priceChange}%
📊 Trend: ${marketTrend}
🔥 Volume: ${volumeStatus}
${directionEmoji} ${signalTitle}

🤖 Ally Insight
${insight}

⚠️ Risk Reminder: Use proper position sizing.

⚡ Powered by Ally`
      );

      console.log("Telegram message sent!");
    }

    res.json({
      message: "Webhook received successfully",
    });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.json({ message: "Webhook error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

client.on("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("!link")) {
    const parts = message.content.split(" ");
    const username = parts[1];

    if (!username) {
      return message.reply("Usage: !link your_username");
    }

if (linkedDiscordUsers[message.author.id]) {
  return message.reply("You already linked an account. Contact support if you need to change it.");
}

    users[username] = message.author.id;
    fs.writeFileSync("users.json", JSON.stringify(users, null, 2));

    linkedDiscordUsers[message.author.id] = username;

    message.reply(`Linked successfully as ${username}`);
    console.log("Linked:", username, "→", message.author.id);
}
    if (message.content.startsWith("!resetlink")) {
  const staffIds = [
  "723800649623666759",
  "1354794192869785693",
  "1485950028873994391",
  "1497748361342877827",
  "1483638613810872413"
];

if (!staffIds.includes(message.author.id)) {
  return message.reply("You are not allowed to reset links.");
}

  const parts = message.content.split(" ");
  const username = parts[1];

  if (!username || !users[username]) {
    return message.reply("User not found.");
  }

  const discordId = users[username];

  delete users[username];
  delete linkedDiscordUsers[discordId];

  fs.writeFileSync("users.json", JSON.stringify(users, null, 2));

  message.reply(`Link reset for ${username}`);
}

});

client.login(process.env.DISCORD_BOT_TOKEN);

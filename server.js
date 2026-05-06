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

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

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

const { user, pair, signal, entry, tp1, tp2, sl, be } = req.body;

const tradeLevels =
  signal === "BUY" || signal === "SELL"
    ? `
🎯 **Entry:** ${entry || "N/A"}
🛑 **Stop Loss:** ${sl || "N/A"}
✅ **TP1:** ${tp1 || "N/A"}
✅ **TP2:** ${tp2 || "N/A"}
🛡️ **BE Trigger:** ${be || "N/A"}`
    : "";
const cleanPair = pair.replace(".P", "").trim();
console.log("Clean pair for Binance:", cleanPair);

  try {
    let currentPrice = "N/A";
    let priceChange = "N/A";
    let marketTrend = "N/A";
let volumeStatus = "N/A";

    try {
 const marketData = await axios.get(
 `https://www.okx.com/api/v5/market/ticker?instId=${cleanPair.replace("USDT", "")}-USDT-SWAP`
);

const ticker = marketData.data.data[0];

currentPrice = ticker.last;
const open24h = Number(ticker.open24h);
const last = Number(ticker.last);

priceChange = (((last - open24h) / open24h) * 100).toFixed(2);
const volume = Number(ticker.vol24h);
     marketTrend =
  priceChange >= 0 ? "Bullish 📈" : "Bearish 📉";

volumeStatus =
  volume > 1000000 ? "High 🔥" : "Normal ✅";
    } catch (err) {
     console.log("Market data not available for:", cleanPair, err.response?.data || err.message);
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

   const directionEmoji =
  signal === "BUY"
    ? "🟢"
    : signal === "SELL"
    ? "🔴"
    : "🛡️";
   const signalTitle =
  signal === "BUY"
    ? "BUY SIGNAL"
    : signal === "SELL"
    ? "SELL SIGNAL"
    : "BREAK EVEN ALERT";

  let insight = "";
  if (signal === "BE") {
  insight =
    `${pair} has moved in favor of the trade. Consider moving stop loss to break-even to secure the position while allowing further upside potential.`;
}
 
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
${tradeLevels}

🤖 **Ally Insight**
${insight}


⚠️ **Risk Reminder:** Use proper position sizing.

⚡ Powered by **Ally**`
      );

      console.log("Discord DM sent!");
    }

    console.log("Whop member keys:", Object.keys(whopMember));
console.log("Whop member full:", JSON.stringify(whopMember, null, 2));
console.log("Trying email:", whopMember.email);

    if (whopMember.email) {
  await resend.emails.send({
    from: "Xenon Ally <onboarding@resend.dev>",
    to: whopMember.email,
    subject: `Xenon Alpha Pro ${signalTitle}`,
    html: `
      <h2>${signalTitle}</h2>

      <p><strong>Pair:</strong> ${pair}</p>
      <p><strong>Price:</strong> ${currentPrice}</p>
      <p><strong>Trend:</strong> ${marketTrend}</p>
      <p><strong>24h Change:</strong> ${priceChange}%</p>

      <hr>

      <p>${insight}</p>

      <br>

      <p>Powered by Ally</p>
    `,
  });

  console.log("Email sent!");
}else {
  console.log("Email skipped: no whopMember.email field");
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
${tradeLevels}

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

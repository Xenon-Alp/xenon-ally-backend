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

const accessConfig = require("./accessConfig");

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

// Required env: TG_GROUP_ID — Telegram group chat ID used to generate one-time member invite links
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    autoStart: false,
    params: {
      timeout: 10,
      allowed_updates: ["message", "callback_query"],
    },
  },
});

telegramBot.on("polling_error", (error) => {
  console.error("Polling error:", error.code);
});

// Delete any existing webhook and release held polling connections before starting,
// preventing 409 Conflict when Railway overlaps old and new instances during deploy.
telegramBot.deleteWebHook({ drop_pending_updates: true }).then(() => {
  telegramBot.startPolling();
  console.log("Telegram polling started");
});


const activeSubscriptions = {
  "testuser": true
};

async function findWhopMemberByTelegramId(telegramId) {
  try {
    let memberships = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await axios.get("https://api.whop.com/api/v2/memberships", {
        headers: {
          Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
        },
        params: {
          page,
          per: 100,
        },
      });

      memberships = memberships.concat(res.data.data || []);
      hasMore = (res.data.data || []).length === 100;
      page++;
    }

    return memberships.find(
      (m) => String(m.telegram_account_id) === String(telegramId)
    ) || null;
  } catch (err) {
    console.log("Whop error (Telegram lookup):", err.message);
    return null;
  }
}

telegramBot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const member = await findWhopMemberByTelegramId(telegramId);

    if (!member) {
      return telegramBot.sendMessage(
        chatId,
        "🚫 No access found. Get your plan here 👉 xenonalpha.com"
      );
    }

    const productId = member.product || member.plan?.product_id || member.product_id;
    const status = member.status;

    const isPaidActive =
      accessConfig.PAID_PRODUCT_IDS.includes(productId) &&
      accessConfig.PAID_ALLOWED_STATUSES.includes(status);

    const isFreeLaunchActive =
      accessConfig.FREE_LAUNCH_ENABLED &&
      accessConfig.FREE_PRODUCT_IDS.includes(productId) &&
      accessConfig.FREE_ALLOWED_STATUSES.includes(status);

    if (!isPaidActive && !isFreeLaunchActive) {
      return telegramBot.sendMessage(
        chatId,
        "❌ Your subscription has expired. Renew here 👉 xenonalpha.com"
      );
    }

    const invite = await telegramBot.createChatInviteLink(
      process.env.TG_GROUP_ID,
      { member_limit: 1 }
    );

    await telegramBot.sendMessage(
      chatId,
`✅ Access Confirmed — Welcome to Xenon Alpha!

🤖 You're now connected to Xenon Ally.

Join your exclusive member group here:
${invite.invite_link}

Inside you'll find:
📢 Announcements
🌅 Daily Market Brief
🎯 Results
🛠️ Setup Guide
💬 Community
🆘 Support

⚡ Powered by Ally`
    );

    console.log("Telegram /start: access granted for", telegramId);
  } catch (err) {
    console.error("Telegram /start error:", err.message);
    telegramBot.sendMessage(chatId, "Something went wrong. Please try again.");
  }
});

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Xenon Ally backend is running");
});

async function checkWhopSubscription(username) {
  try {
    let memberships = [];
let page = 1;
let hasMore = true;

while (hasMore) {
  const res = await axios.get("https://api.whop.com/api/v2/memberships", {
    headers: {
      Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
    },
    params: {
      page,
      per: 100,
    },
  });

  memberships = memberships.concat(res.data.data || []);

  hasMore = (res.data.data || []).length === 100;
  page++;
}
  
   const signalUsername = String(username || "")
  .trim()
  .replace(/\s+/g, "")
  .toLowerCase();

    // 1) Find the Whop customer/user that has this TradingView username
    const tvOwner = memberships.find((m) => {
      const answers = m.custom_field_responses || [];

      return answers.some((a) => {
        const question = String(a.question || "").trim().toLowerCase();
        const answer = String(a.answer || "")
  .trim()
  .replace(/\s+/g, "")
  .toLowerCase();

        return question.includes("tradingview") && answer === signalUsername;
      });
    });

    if (!tvOwner) {
      console.log("❌ No Whop user found with TV username:", username);
      return false;
    }

    const ownerEmail = tvOwner.email;
    const ownerDiscordId = tvOwner.discord?.id;
    const ownerTelegramId = tvOwner.telegram_account_id;

    // 2) Find any valid active/free membership for that same user
    const validMembership = memberships.find((m) => {
    const sameUser =
  (ownerEmail && m.email === ownerEmail) ||
  (ownerDiscordId && m.discord?.id === ownerDiscordId) ||
  (ownerTelegramId && m.telegram_account_id === ownerTelegramId) ||
  (tvOwner.user && m.user === tvOwner.user);

      if (!sameUser) return false;

      const productId =
        m.product ||
        m.plan?.product_id ||
        m.product_id;

      const status = m.status;

      const isPaidAllowed =
        accessConfig.PAID_PRODUCT_IDS.includes(productId) &&
        accessConfig.PAID_ALLOWED_STATUSES.includes(status);

      const isFreeLaunchAllowed =
        accessConfig.FREE_LAUNCH_ENABLED &&
        accessConfig.FREE_PRODUCT_IDS.includes(productId) &&
        accessConfig.FREE_ALLOWED_STATUSES.includes(status);

      return isPaidAllowed || isFreeLaunchAllowed;
    });

    if (!validMembership) {
      console.log("❌ TV username found, but no valid active membership:", username);
      return false;
    }

    const connectedData = memberships.find((m) => {
  return (
    (ownerEmail && m.email === ownerEmail) ||
    (ownerDiscordId && m.discord?.id === ownerDiscordId) ||
    (ownerTelegramId && m.telegram_account_id === ownerTelegramId) ||
    (tvOwner.user && m.user === tvOwner.user)
  );
});

return {
  ...validMembership,
  email: validMembership.email || connectedData?.email || tvOwner.email,
  discord: validMembership.discord || connectedData?.discord || tvOwner.discord,
  telegram_account_id:
    validMembership.telegram_account_id ||
    connectedData?.telegram_account_id ||
    tvOwner.telegram_account_id,
};
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
    const telegramTradeLevels =
  signal === "BUY" || signal === "SELL"
    ? `
🎯 Entry: ${entry || "N/A"}
🛑 Stop Loss: ${sl || "N/A"}
✅ TP1: ${tp1 || "N/A"}
✅ TP2: ${tp2 || "N/A"}
🛡️ BE Trigger: ${be || "N/A"}`
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
  `https://www.okx.com/api/v5/market/ticker?instId=${cleanPair.replace("USDT", "")}-USDT-SWAP`,
  { timeout: 8000 }
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

if (!discordId && !telegramId && !whopMember.email) {
  console.log("❌ No Discord, Telegram, or email connected:", user);
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
   from: "Xenon Ally <ally@xenonalpha.com>",
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
} else {
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
${telegramTradeLevels}

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

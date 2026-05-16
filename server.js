const fs = require("fs");

let users = {};

const linkedDiscordUsers = {};

let postMode = "manual"; // "manual" = private preview to owner, "auto" = post publicly

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
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");

// Required env: DAILY_BRIEF_TOPIC_ID — Telegram thread/topic ID for the Daily Market Brief channel
const DAILY_BRIEF_TOPIC_ID = parseInt(process.env.DAILY_BRIEF_TOPIC_ID) || 0;

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

// Required env: TG_GROUP_ID    — Telegram group chat ID for one-time member invite links
// Required env: TV_SCRIPT_ID  — TradingView Pine Script ID (from the indicator URL)
// Required env: TV_SESSION_ID — TradingView sessionid cookie value
// Required env: TV_SESSION_SIGN — TradingView sessionid_sign cookie value
// Optional env: TV_CSRF_TOKEN — TradingView csrftoken cookie (add if requests return 403)
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
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

function getTradingViewUsername(membership) {
  const answers = membership.custom_field_responses || [];
  const field = answers.find((a) =>
    String(a.question || "").trim().toLowerCase().includes("tradingview")
  );
  return field ? String(field.answer || "").trim() : null;
}

async function updateTradingViewAccess(tvUsername, action) {
  const body = new URLSearchParams();
  body.append("pine_id", process.env.TV_SCRIPT_ID);
  body.append("username_recip", tvUsername);

  const res = await axios.post(
    `https://www.tradingview.com/pine_perm/${action}/`,
    body.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": `sessionid=${process.env.TV_SESSION_ID}; sessionid_sign=${process.env.TV_SESSION_SIGN}${process.env.TV_CSRF_TOKEN ? `; csrftoken=${process.env.TV_CSRF_TOKEN}` : ""}`,
        ...(process.env.TV_CSRF_TOKEN && { "X-CSRFToken": process.env.TV_CSRF_TOKEN }),
        "Referer": "https://www.tradingview.com/",
      },
    }
  );

  return res.data;
}

async function addTVUser(tvUsername) {
  return updateTradingViewAccess(tvUsername, "add");
}

async function removeTVUser(tvUsername) {
  return updateTradingViewAccess(tvUsername, "remove");
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

// ─── Daily Market Brief helpers ───────────────────────────────────────────────

function fgEmoji(value) {
  const v = parseInt(value);
  if (v <= 25) return "😱 EXTREME FEAR";
  if (v <= 45) return "😰 FEAR";
  if (v <= 55) return "😐 NEUTRAL";
  if (v <= 75) return "🤑 GREED";
  return "🚀 EXTREME GREED";
}

function formatChange(pct) {
  if (!pct) return "0.00%";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

async function getCryptoData() {
  const res = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
    params: {
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: 20,
      page: 1,
      price_change_percentage: "24h",
    },
  });
  const coins = res.data;
  const btc = coins.find((c) => c.id === "bitcoin");
  const eth = coins.find((c) => c.id === "ethereum");
  const alts = coins.filter((c) => c.id !== "bitcoin" && c.id !== "ethereum").slice(0, 3);
  return { btc, eth, alts };
}

async function getStockData() {
  const [sp500Res, nasdaqRes] = await Promise.all([
    axios.get("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } }),
    axios.get("https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } }),
  ]);

  const sp500 = sp500Res.data.chart.result[0].meta;
  const nasdaq = nasdaqRes.data.chart.result[0].meta;

  const activeRes = await axios.get(
    "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=3",
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  const activeStocks = activeRes.data.finance.result[0].quotes.slice(0, 3);

  return { sp500, nasdaq, activeStocks };
}

async function getFearGreed() {
  const res = await axios.get("https://api.alternative.me/fng/");
  const data = res.data.data[0];
  return { value: data.value, label: data.value_classification };
}

async function sendCryptoBrief() {
  try {
    const { btc, eth, alts } = await getCryptoData();
    const fg = await getFearGreed();
    const date = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const altLines = alts.map((a) =>
      `• ${a.symbol.toUpperCase()}: $${a.current_price.toLocaleString()} (${formatChange(a.price_change_percentage_24h)})`
    ).join("\n");

    const msg =
`🌅 Xenon Alpha — Daily Market Brief
${date}

─────────────────────
🪙 CRYPTO MARKET
─────────────────────
₿ BTC: $${btc.current_price.toLocaleString()} (${formatChange(btc.price_change_percentage_24h)})
Ξ ETH: $${eth.current_price.toLocaleString()} (${formatChange(eth.price_change_percentage_24h)})

🔥 Top Altcoins Today:
${altLines}

─────────────────────
🧠 Market Sentiment
Fear & Greed: ${fg.value} — ${fgEmoji(fg.value)}
─────────────────────

Powered by Xenon Alpha Pro ⚡`;

    await telegramBot.sendMessage(-1003964213191, msg, { message_thread_id: DAILY_BRIEF_TOPIC_ID });
    const dcChannel = await client.channels.fetch("1505104581359833148");
    await dcChannel.send(msg);
    console.log("✅ Crypto brief sent!");
  } catch (err) {
    console.error("❌ Crypto brief failed:", err.message);
  }
}

async function sendStockBrief() {
  try {
    const { sp500, nasdaq, activeStocks } = await getStockData();
    const fg = await getFearGreed();
    const date = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const sp500Change = ((sp500.regularMarketPrice - sp500.chartPreviousClose) / sp500.chartPreviousClose) * 100;
    const nasdaqChange = ((nasdaq.regularMarketPrice - nasdaq.chartPreviousClose) / nasdaq.chartPreviousClose) * 100;

    const stockLines = activeStocks.map((s) =>
      `• ${s.symbol}: $${s.regularMarketPrice?.toFixed(2)} (${formatChange(s.regularMarketChangePercent)})`
    ).join("\n");

    const msg =
`🌅 Xenon Alpha — Daily Market Brief
${date}

─────────────────────
📈 STOCK MARKET
─────────────────────
📊 S&P 500: ${sp500.regularMarketPrice.toLocaleString()} (${formatChange(sp500Change)})
📊 NASDAQ: ${nasdaq.regularMarketPrice.toLocaleString()} (${formatChange(nasdaqChange)})

🔥 Most Active Today:
${stockLines}

─────────────────────
🧠 Market Sentiment
Fear & Greed: ${fg.value} — ${fgEmoji(fg.value)}
─────────────────────

Powered by Xenon Alpha Pro ⚡`;

    await telegramBot.sendMessage(-1003964213191, msg, { message_thread_id: DAILY_BRIEF_TOPIC_ID });
    const dcChannel = await client.channels.fetch("1505104581359833148");
    await dcChannel.send(msg);
    console.log("✅ Stock brief sent!");
  } catch (err) {
    console.error("❌ Stock brief failed:", err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

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

const { user, pair, signal, direction, entry, tp1, tp2, sl, be, timeframe } = req.body;

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

    // Build public post caption for manual preview or auto posting
    const cleanPairDisplay = pair.replace(".P", "").trim();
    let publicCaption = "";

    if (signal === "BUY" || signal === "SELL") {
      const direction = signal === "BUY" ? "🟢 LONG" : "🔴 SHORT";
      const tfDisplay = timeframe ? ` (${timeframe})` : "";

      let rr = "N/A";
      if (entry && sl && tp1) {
        const risk = Math.abs(Number(entry) - Number(sl));
        const reward = Math.abs(Number(tp1) - Number(entry));
        if (risk > 0) rr = `1:${(reward / risk).toFixed(1)}`;
      }

      publicCaption =
`${direction} — ${cleanPairDisplay}${tfDisplay}

📥 Entry: ${entry || "N/A"}
🛑 SL: ${sl || "N/A"}
🎯 TP1: ${tp1 || "N/A"}
🎯 TP2: ${tp2 || "N/A"}
⚖️ BE: ${be || "N/A"}
📊 RR: ${rr}

Powered by Xenon Alpha Pro ⚡`;

    } else if (signal === "BE") {
      publicCaption =
`🔒 BE Alert — ${cleanPairDisplay}
Move your Stop Loss to Entry now!`;

    } else if (signal === "TP1_HIT") {
      const dir = direction || "LONG";
      publicCaption =
`🎯 TP1 HIT — ${cleanPairDisplay}

Our ${dir} signal played out!

📈 Direction: ${dir}
💰 Entry: ${entry || "N/A"}
✅ TP1: ${tp1 || "N/A"} HIT!
🎯 TP2: ${tp2 || "N/A"} (running)
🛑 SL was: ${sl || "N/A"}

The algorithm doesn't miss 👁️
Xenon Alpha Pro ⚡`;

    } else if (signal === "TP2_HIT") {
      const dir = direction || "LONG";
      publicCaption =
`🏆 TP2 HIT — ${cleanPairDisplay}

Full trade played out perfectly!

📈 Direction: ${dir}
💰 Entry: ${entry || "N/A"}
✅ TP1: ${tp1 || "N/A"} ✅
✅ TP2: ${tp2 || "N/A"} ✅ FULL TP HIT!

This is why we trade with Xenon Alpha Pro 🔥⚡`;
    }

    if (publicCaption) {
      try {
        if (postMode === "manual") {
          await telegramBot.sendMessage("7471817214", publicCaption);
          console.log("📤 Signal preview sent privately (manual mode)");
        } else if (postMode === "auto") {
          await telegramBot.sendMessage("-1003925059991", publicCaption);
          const discordChannel = await client.channels.fetch("1505081634347548754");
          await discordChannel.send(publicCaption);
          console.log("📢 Signal posted publicly (auto mode)");
        }
      } catch (err) {
        console.error("Public post failed:", err.message);
      }
    }

    res.json({
      message: "Webhook received successfully",
    });
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.json({ message: "Webhook error" });
  }
});

app.post("/whop-webhook", async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately so Whop doesn't retry

  const { action, data } = req.body;
  const membership = data?.object;

  if (!membership) return;

  console.log("Whop event:", action);

  const tvUsername = getTradingViewUsername(membership);
  const discordId = membership.discord?.id;
  const telegramId = membership.telegram_account_id;

  if (action === "membership.went_valid") {
    if (tvUsername) {
      try {
        await updateTradingViewAccess(tvUsername, "add");
        console.log("✅ TV access granted:", tvUsername);
      } catch (err) {
        console.error("❌ TV access grant failed:", tvUsername, err.response?.data || err.message);
      }
    } else {
      console.log("⚠️ No TradingView username found for new member");
    }

    if (telegramId) {
      try {
        await telegramBot.sendMessage(
          telegramId,
`🎉 Welcome to Xenon Alpha!

Your membership is now active.

To get your group access and start receiving live signals:

👉 Open this chat with Xenon Ally and tap /start
@XenonAllyBot

⚡ Powered by Ally`
        );
        console.log("Telegram welcome DM sent:", telegramId);
      } catch (err) {
        console.error("Telegram welcome DM failed:", err.message);
      }
    }

    if (discordId) {
      try {
        const targetUser = await client.users.fetch(discordId);
        await targetUser.send(
`🎉 **Welcome to Xenon Alpha!**

Your membership is now active.

**To get started:**
1. Open Telegram and message **@XenonAllyBot**
2. Tap **/start** — Ally will verify your access and drop you a private invite link to the member group
3. Live trading signals will be delivered here on Discord automatically

⚡ Powered by **Ally**`
        );
        console.log("Discord welcome DM sent:", discordId);
      } catch (err) {
        console.error("Discord welcome DM failed:", err.message);
      }
    }

  } else if (action === "membership.went_invalid") {
    if (tvUsername) {
      try {
        await updateTradingViewAccess(tvUsername, "remove");
        console.log("✅ TV access removed:", tvUsername);
      } catch (err) {
        console.error("❌ TV access removal failed:", tvUsername, err.response?.data || err.message);
      }
    } else {
      console.log("⚠️ No TradingView username found for expired member");
    }
  }
});

app.post("/telegram-webhook", (req, res) => {
  console.log("Telegram update received:", JSON.stringify(req.body));
  telegramBot.processUpdate(req.body);
  res.sendStatus(200);
});



app.get("/test-crypto-brief", async (req, res) => {
  await sendCryptoBrief();
  res.json({ ok: true });
});

app.get("/test-stock-brief", async (req, res) => {
  await sendStockBrief();
  res.json({ ok: true });
});

// Stock brief: Mon / Wed / Fri at 9:50 AM EST
cron.schedule("50 9 * * 1,3,5", () => {
  console.log("📈 Sending stock brief...");
  sendStockBrief();
}, { timezone: "America/New_York" });

// Crypto brief: Tue / Thu / Sat / Sun at 9:50 AM EST
cron.schedule("50 9 * * 2,4,6,0", () => {
  console.log("🪙 Sending crypto brief...");
  sendCryptoBrief();
}, { timezone: "America/New_York" });

const RAILWAY_URL = "https://xenon-ally-backend-production.up.railway.app";

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  telegramBot.setWebHook(`${RAILWAY_URL}/telegram-webhook`)
    .then(() => console.log("Telegram webhook set"))
    .catch((err) => console.error("Failed to set Telegram webhook:", err.message));
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

  if (message.content.startsWith("!mode")) {
    if (message.author.id !== "723800649623666759") {
      return message.reply("❌ You don't have permission to use this command.");
    }

    const arg = message.content.split(" ")[1];

    if (arg === "manual") {
      postMode = "manual";
      return message.reply("✅ Mode set to MANUAL — signals sent to you privately");
    } else if (arg === "auto") {
      postMode = "auto";
      return message.reply("✅ Mode set to AUTO — signals posting publicly");
    } else if (arg === "status") {
      return message.reply(`Current mode: **${postMode}**`);
    } else {
      return message.reply("Usage: `!mode manual` | `!mode auto` | `!mode status`");
    }
  }

});

client.login(process.env.DISCORD_BOT_TOKEN);

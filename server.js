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

    console.log(res.data);

    const memberships = res.data.data;

    console.log(JSON.stringify(memberships[0], null, 2));

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

  try {
const discordId = users[user];

const whopMember = await checkWhopSubscription(user);

console.log(JSON.stringify(whopMember, null, 2));

if (!whopMember) {
  console.log("❌ Not subscribed (Whop):", user);
  return res.json({ message: "User not subscribed" });
}

if (!discordId) {
  console.log("❌ Unlinked user:", user);
  return res.json({ message: "User not linked" });
}

const targetUser = await client.users.fetch(discordId);

const insight =
  signal === "BUY"
    ? "Market showing bullish momentum. Potential upward move, watch for confirmation."
    : "Market showing bearish pressure. Possible downside move, wait for proper entry.";

await targetUser.send(
`🚨 **XENON ALPHA PRO SIGNAL**

━━━━━━━━━━━━━━
📊 **Pair:** ${pair}
📌 **Signal:** ${signal}

🤖 **Ally Insight**
${insight}

⚠️ **Risk Reminder:** Use proper position sizing.

⚡ Powered by **Ally**`
);

    console.log("DM sent!");
  } catch (err) {
    console.error("Error sending DM:", err);
  }

  res.json({
    message: "Webhook received successfully",
  });
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

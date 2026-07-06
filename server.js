require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();

app.use(express.json());
app.use(express.text({ type: "text/plain" }));

const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

app.get("/", (req, res) => {
  res.send("Personal TradingView Discord backend is running");
});

app.post("/webhook", async (req, res) => {
  try {
    const targetUser = await client.users.fetch(process.env.PERSONAL_DISCORD_ID);

    let alertMessage;

    if (typeof req.body === "string") {
      alertMessage = req.body;
    } else {
      alertMessage =
        req.body.message ||
        req.body.alert ||
        req.body.text ||
        JSON.stringify(req.body);
    }

    await targetUser.send(alertMessage);

    console.log("✅ Alert sent:", alertMessage);
    res.status(200).send("Alert sent");
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.status(500).send("Webhook error");
  }
});

client.once("clientReady", () => {
  console.log(`✅ Discord bot logged in as ${client.user.tag}`);

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

client.login(process.env.DISCORD_BOT_TOKEN);
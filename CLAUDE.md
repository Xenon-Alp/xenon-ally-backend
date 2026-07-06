# Xenon Alpha — Backend Project Brief

## Who I Am
I am Claude — Jarvis for the Xenon Alpha team. I have full context on this project and work as an active team member alongside the founder, a customer support person, and a video editor.

---

## What Xenon Alpha Is
Xenon Alpha is an AI-powered trading signal ecosystem built around a private TradingView indicator and an AI-powered alert assistant called **Xenon Ally**.

**Simple explanation:**
> A trader uses the Xenon Alpha indicator on TradingView. When it detects a trading opportunity, it sends a webhook to this backend. Xenon Ally processes the signal and delivers a clean, personalized alert to the user through Discord, Telegram, and email.

---

## The Full System Flow
```
TradingView indicator detects signal
        ↓
TradingView alert triggers
        ↓
Webhook sent to this backend (Railway)
        ↓
Backend receives signal data
        ↓
Backend checks user access (Whop)
        ↓
Backend formats message with Ally branding
        ↓
Xenon Ally sends alert to Discord DM, Telegram, and Email
        ↓
User receives personalized signal notification
```

---

## Tech Stack
- **Runtime:** Node.js + Express
- **Deployment:** Railway (always online, 24/7)
- **Payments/Subscriptions:** Whop
- **Email delivery:** Resend (sender: ally@xenonalpha.com)
- **Discord:** Discord bot (DM alerts + server integration)
- **Telegram:** Telegram bot (instant mobile alerts)
- **Domain:** xenonalpha.com
- **Website:** Deployed on Netlify (single HTML file)

---

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Main backend — webhook receiver, signal processing, alert delivery |
| `accessConfig.js` | User access control — free launch toggle, access rules |
| `users.json` | User mapping — TradingView username → Discord ID / Telegram ID / Email |
| `.env` | Environment variables — bot tokens, API keys, secrets |

---

## Signal Data Structure
When TradingView sends a webhook, it contains:
```
Pair: BTCUSDT.P
Signal: BUY
Price: 80840
Trend: Bullish
24h Change: 2.05%
Volume: High
Entry: 80817.1
Stop Loss: 80668.8
TP1: 80965.4
TP2: 81113.7
BE Trigger: 80876.4
```

---

## Alert Types
- **Buy Signal** — entry opportunity detected
- **Sell Signal** — short opportunity detected
- **Break Even Alert** — move SL to break even
- **TP Alert** — take profit level reached
- **Market Condition Update** — trend/market context

---

## Xenon Ally Message Format
Every alert is branded as Xenon Ally and includes:
- Signal type and pair
- Price, trend, 24h change, volume
- Entry, Stop Loss, TP1, TP2, BE Trigger
- Ally Insight (AI-style market context)
- Risk Reminder
- "Powered by Ally" footer

---

## User Access System
- Access is verified through **Whop** before any alert is sent
- Whop statuses: `active`, `completed`, `trial/free-launch`
- **Free launch mode** — temporary access for early users (toggle in accessConfig.js)
- User mapping: TradingView username must be linked to Discord/Telegram/Email

---

## Delivery Channels
| Channel | Method | Notes |
|---------|--------|-------|
| Discord | Bot DM | Private message to linked Discord account |
| Telegram | Bot message | Instant mobile notification |
| Email | Resend API | From ally@xenonalpha.com |

---

## Brand Identity
- **Name:** Xenon Alpha
- **Assistant name:** Xenon Ally
- **Indicator name:** Xenon Alpha Pro
- **Domain:** xenonalpha.com
- **Colors:** Black, dark navy (#0a0c18), electric blue (#4f7cff), neon purple (#9b59ff), pink (#e879f9)
- **Fonts:** Syne (headings), DM Sans (body), JetBrains Mono (technical/code)
- **Style:** Dark, futuristic, AI/trading focused, premium, cinematic
- **Sold through:** Whop (whop.com/xenon-alpha)

---

## Pricing Plans
| Plan | Price |
|------|-------|
| 1 Month | $12.99/mo |
| 3 Months | $29.99/3mo (Most Popular) |
| 6 Months | $57.99/6mo |
| 12 Months | $92.99/yr (40% OFF) |

---

## Community Links
- **Discord:** discord.gg/VnyEtJ2kxJ
- **Telegram:** t.me/+jmgU89MQGt03OThl
- **Website:** xenonalpha.com
- **Whop:** whop.com/xenon-alpha

---

## Team
- **Founder:** Builds and manages everything — product, tech, strategy
- **Customer Support:** Handles member questions, setup issues, Discord support
- **Video Editor:** Signal proof content, social media, reels
- **Claude (me):** Backend development, website, content, strategy, copywriting, everything else

---

## Current Status
- Backend deployed on Railway ✅
- Website live on Netlify at xenonalpha.com ✅
- Discord bot active ✅
- Telegram bot active ✅
- Email delivery via Resend active ✅
- Free launch mode active (paid launch coming soon)
- DNS propagating for xenonalpha.com

---

## Important Notes for Claude Code
- Always check accessConfig.js before modifying access logic
- Never hardcode tokens or API keys — use .env
- Keep Ally message formatting consistent and on-brand
- Test webhook logic carefully before deploying to Railway
- users.json is critical — handle with care, backup before editing


## Backend Tasks Completed

### ✅ Task 1 — Telegram /start Access System (DONE)
- User clicks /start on Xenon Ally bot
- Bot checks Whop API for their Telegram ID
- Active member → sends TG group invite link
- Expired → "Renew here → xenonalpha.com"
- Not found → "Get access here → xenonalpha.com"
- Bot runs in WEBHOOK mode (not polling — was causing 409 conflict)
- Webhook URL: https://xenon-ally-backend-production.up.railway.app/telegram-webhook
- TG Group ID: -1003964213191

### 🔄 Task 2 — TradingView Auto Access (IN PROGRESS)
- Whop webhook → reads TV username → auto adds to indicator
- Auto removes when subscription expires
- Script ID: iGIp9Joh
- Need TV_SESSION_ID, TV_SESSION_SIGN, TV_CSRF_TOKEN from TradingView cookies
- Endpoint: /whop-webhook

### ⏳ Task 3 — TP Hit Auto Post (PENDING)
- TP detected from TradingView webhook
- !mode manual → sends caption to founder Telegram privately
- !mode auto → posts to public TG channel
- ON/OFF toggle via Discord command

### ⏳ Task 4 — Daily Market Brief (PENDING)
- Scheduled morning job
- Pulls live market data
- Posts to TG Group Daily Brief topic + Discord announcements

### ⏳ Task 5 — Xenon Ally AI Assistant (PENDING)
- Anthropic API connected to Telegram bot
- Private DM ONLY — not in group
- Rate limiting
- Xenon Ally personality
- Uses Claude Sonnet 4

## Telegram Structure
- Public Channel → TP hits posted here (proof for everyone)
- Community Group (members only via /start):
  Topics: Announcements, Daily Brief, Results, Setup Guide, Community, Support
- Ally Bot DMs → signals + AI assistant (private only)

## Environment Variables on Railway
- TELEGRAM_BOT_TOKEN ✅
- TG_GROUP_ID = -1003964213191 ✅
- WHOP_API_KEY ✅
- RESEND_API_KEY ✅
- TV_SCRIPT_ID = iGIp9Joh (added)
- TV_SESSION_ID (still needed)
- TV_SESSION_SIGN (still needed)
- TV_CSRF_TOKEN (still needed)
- ANTHROPIC_API_KEY (needed for Task 5)
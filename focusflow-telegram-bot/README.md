# FocusFlow Telegram Mini App

This project turns FocusFlow into a Telegram Mini App launched by a bot.

## What is included

- `public/index.html`
  The Mini App frontend.
- `server.js`
  Static file server, Telegram bot polling, `initData` validation, and per-user JSON state storage.
- `data/states.json`
  Created automatically on first launch. Stores app state by Telegram user id.

## Requirements

- Node.js 18+
- A Telegram bot created via `@BotFather`
- A public `HTTPS` URL for the app

Telegram Mini Apps require an `HTTPS` web app URL in the Bot API `WebAppInfo` object and use `initData` for authorization/validation.

Official docs:

- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/api

## Environment variables

Create a local `.env` equivalent in your deployment environment:

- `BOT_TOKEN`
  Bot token from `@BotFather`
- `APP_URL`
  Public HTTPS URL where this app is deployed, e.g. `https://focusflow.example.com`
- `BOT_USERNAME`
  Optional helper value for your own reference
- `PORT`
  Optional, defaults to `3000`

## Run locally

```bash
node server.js
```

Then open:

- `http://localhost:3000` for normal browser testing

Note:

- Telegram Mini App auth and synced per-user storage only work when opened from Telegram with valid `initData`.
- Plain browser mode still works, but falls back to local browser storage.

## Deploy flow

1. Deploy this folder to any Node-friendly host with HTTPS.
2. Set `BOT_TOKEN` and `APP_URL` in the host environment.
3. Start the app with `node server.js`.
4. Open `@BotFather`.
5. Configure the bot's Mini App URL to point to your deployed `APP_URL`.
6. Open your bot in Telegram and use `/start`.

## Railway quick start

1. Create a new GitHub repo and upload this folder.
2. Create a new Railway project from that repo.
3. In Railway variables, set:
   - `BOT_TOKEN`
   - `APP_URL`
   - `BOT_USERNAME`
4. Set `APP_URL` to your Railway public domain, for example:
   - `https://focusflow-telegram-bot-production.up.railway.app`
5. Railway will run `npm start` automatically.
6. After first deploy, open your bot and send `/start`.

Notes:

- Telegram Mini Apps require `HTTPS`.
- The app URL must match the deployed public domain you use for the Mini App.
- The server will automatically configure bot commands and the menu button when both `BOT_TOKEN` and `APP_URL` are present.

The server also attempts to configure:

- bot commands
- chat menu button with a `web_app` URL

## State sync model

- In Telegram Mini App mode:
  - frontend sends `Telegram.WebApp.initData` to backend
  - backend validates it using the bot token
  - state is loaded/saved under the Telegram `user.id`
- Outside Telegram:
  - the app uses browser `localStorage`

## Next recommended step

Deploy the app to a public HTTPS host first, then connect the bot.

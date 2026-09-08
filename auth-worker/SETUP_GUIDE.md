# Discord Sign-In — Setup Guide

Nothing works until these steps are done. Roughly 20 minutes, all free tier.

---

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**. Name it `BiteSterxBeast`.
2. On **General Information**, copy the **Application ID** and the **Public Key**. Keep both.
3. Go to **Bot** → **Reset Token** → copy the token. This is a secret — treat it like a password.
4. Still on **Bot**, enable **Server Members Intent** (needed to confirm someone is still in the server).

## 2. Invite the bot to your server

**OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot permissions: none needed

Open the generated URL and add the bot to the BiteSterxBeast server.

## 3. Get your server ID

In Discord: **User Settings → Advanced → Developer Mode** on. Right-click the server icon → **Copy Server ID**.

## 4. Create the KV namespace

```bash
npx wrangler kv namespace create AUTH_KV
```

Copy the returned `id` into `wrangler.toml`.

## 5. Fill in wrangler.toml

```toml
GUILD_ID = "your server ID from step 3"
DISCORD_PUBLIC_KEY = "public key from step 1"
ALLOWED_ORIGIN = "https://bitesterxbeast.github.io"
```

And the KV `id` from step 4.

## 6. Add the bot token as a secret

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
```

Paste the token from step 1.3 when prompted. **Never put this in wrangler.toml** — that file is in the public repo.

## 7. Deploy the Worker

```bash
cd auth-worker
npx wrangler deploy
```

Copy the deployed URL, e.g. `https://bsb-auth.yourname.workers.dev`.

## 8. Point Discord at the Worker

Back on the Discord app's **General Information** page, set:

**Interactions Endpoint URL** = `https://bsb-auth.yourname.workers.dev/interactions`

Save. Discord sends a test PING — if the Worker is deployed correctly it saves without error. If it rejects the URL, the Worker isn't reachable or the public key is wrong.

## 9. Register the /verify command

```bash
APP_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx node register-command.js
```

`/verify` should appear in your server immediately.

## 10. Point the site at the Worker

Edit **`/assets/auth-config.js`** in the repo:

```js
api: "https://bsb-auth.yourname.workers.dev",
```

Commit and push. That's the only site file that needs the URL.

---

## Testing

1. Open `https://bitesterxbeast.github.io/` → should redirect to `/sign-in/`.
2. In Discord, run `/verify` → private reply with a 6-character code.
3. Enter the code → redirected back, username shows in the header.
4. Wrong code → red boxes, error message.
5. Click your username in the header → signs out, back to `/sign-in/`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Discord rejects the Interactions URL | Worker not deployed, or `DISCORD_PUBLIC_KEY` wrong |
| `/verify` doesn't appear | Step 9 not run, or wrong `GUILD_ID` |
| "invalid request signature" | Public key mismatch between app and `wrangler.toml` |
| Code always invalid | KV binding named something other than `AUTH_KV` |
| CORS error in browser console | `ALLOWED_ORIGIN` doesn't exactly match your site origin |
| Signed in but stuck on redirect loop | `api` in `auth-config.js` still the placeholder URL |

## Free tier limits

- Workers: 100,000 requests/day
- KV: 100,000 reads/day, 1,000 writes/day
- Discord: no cost

The per-page `/me` check is the main consumer. Sessions are cached for 10 minutes client-side to keep that well under the limit.

## Locking yourself out

If the Worker breaks, every page redirects to `/sign-in/`. To restore access fast, open the browser console on any page and run:

```js
localStorage.setItem("bsb_session_checked", String(Date.now()))
```

The gate fails open on an already-validated session when the Worker is unreachable, so a Cloudflare outage won't lock you out of your own site mid-session.

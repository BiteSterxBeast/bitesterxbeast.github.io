/**
 * Run ONCE (and again only if you change the command).
 *
 *   APP_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx node register-command.js
 *
 * Registering to a single guild makes it appear instantly.
 * (Global commands can take up to an hour to propagate.)
 */
const { APP_ID, BOT_TOKEN, GUILD_ID } = process.env;

if (!APP_ID || !BOT_TOKEN || !GUILD_ID) {
  console.error("Set APP_ID, BOT_TOKEN and GUILD_ID environment variables.");
  process.exit(1);
}

const command = {
  name: "verify",
  description: "Get a code to sign in on bitesterxbeast.github.io",
  type: 1,
  dm_permission: false
};

fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
  method: "POST",
  headers: {
    Authorization: "Bot " + BOT_TOKEN,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(command)
})
  .then(async (r) => {
    const text = await r.text();
    console.log(r.status, text);
    if (!r.ok) process.exit(1);
    console.log("\n/verify registered.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

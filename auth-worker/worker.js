/**
 * BiteSterxBeast — auth worker
 *
 * Routes:
 *   POST /interactions      Discord slash-command endpoint (/verify)
 *   POST /redeem            { code } -> { token, user }
 *   GET  /me                Bearer token -> { ok, user }
 *   POST /logout            Bearer token -> destroys session
 *   GET  /data/:key         Bearer token -> { value }
 *   PUT  /data/:key         Bearer token, { value } -> saves per-user data
 *
 * Bindings (wrangler.toml / dashboard):
 *   KV     AUTH_KV
 *   vars   GUILD_ID, ALLOWED_ORIGIN, DISCORD_PUBLIC_KEY
 *   secret DISCORD_BOT_TOKEN
 */

const CODE_TTL = 300;                 // 5 minutes for a /verify code
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));

    try {
      if (path === "/interactions" && request.method === "POST") {
        return await handleInteraction(request, env); // Discord: no CORS needed
      }
      if (path === "/redeem" && request.method === "POST") {
        return cors(env, await handleRedeem(request, env));
      }
      if (path === "/me" && request.method === "GET") {
        return cors(env, await handleMe(request, env));
      }
      if (path === "/logout" && request.method === "POST") {
        return cors(env, await handleLogout(request, env));
      }
      if (path.startsWith("/data/")) {
        return cors(env, await handleData(request, env, decodeURIComponent(path.slice(6))));
      }
      return cors(env, json({ error: "not_found" }, 404));
    } catch (err) {
      return cors(env, json({ error: "server_error", detail: String(err) }, 500));
    }
  }
};

/* ------------------------------------------------------------------ */
/* Discord slash command                                               */
/* ------------------------------------------------------------------ */

async function handleInteraction(request, env) {
  const sig = request.headers.get("x-signature-ed25519");
  const ts = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!sig || !ts || !(await verifySignature(env.DISCORD_PUBLIC_KEY, sig, ts, body))) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body);

  // PING
  if (interaction.type === 1) return json({ type: 1 });

  // APPLICATION_COMMAND
  if (interaction.type === 2) {
    const name = interaction.data && interaction.data.name;

    if (name !== "verify") return ephemeral("Unknown command.");

    // Must be run inside the server, not in a DM.
    if (!interaction.guild_id) {
      return ephemeral("Run `/verify` inside the BiteSterxBeast server, not in DMs.");
    }
    if (env.GUILD_ID && interaction.guild_id !== env.GUILD_ID) {
      return ephemeral("This command only works in the BiteSterxBeast server.");
    }

    const member = interaction.member || {};
    const user = member.user || interaction.user;
    if (!user) return ephemeral("Couldn't read your Discord account. Try again.");

    const code = await generateCode(env);
    await env.AUTH_KV.put(
      "code:" + code,
      JSON.stringify({
        id: user.id,
        username: user.global_name || user.username,
        avatar: avatarUrl(user)
      }),
      { expirationTtl: CODE_TTL }
    );

    return ephemeral(
      "**Your sign-in code is `" + code + "`**\n" +
      "Enter it at <https://bitesterxbeast.github.io/sign-in/> within 5 minutes.\n" +
      "_Only you can see this message. Don't share the code._"
    );
  }

  return json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });
}

async function generateCode(env) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = "";
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const existing = await env.AUTH_KV.get("code:" + code);
    if (!existing) return code;
  }
  throw new Error("could not allocate a unique code");
}

function ephemeral(content) {
  return json({ type: 4, data: { content, flags: 64 } });
}

function avatarUrl(user) {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
}

/* Ed25519 verification via WebCrypto (needs compatibility_date >= 2024-01-01) */
async function verifySignature(publicKeyHex, sigHex, timestamp, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(publicKeyHex),
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    hexToBytes(sigHex),
    new TextEncoder().encode(timestamp + body)
  );
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/* ------------------------------------------------------------------ */
/* Site auth                                                           */
/* ------------------------------------------------------------------ */

async function handleRedeem(request, env) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: "bad_code" }, 400);

  const raw = await env.AUTH_KV.get("code:" + code);
  if (!raw) return json({ error: "invalid_or_expired" }, 401);

  // Single use.
  await env.AUTH_KV.delete("code:" + code);
  const user = JSON.parse(raw);

  // Re-check they're still in the server at redemption time.
  if (env.GUILD_ID && env.DISCORD_BOT_TOKEN) {
    const stillMember = await isGuildMember(env, user.id);
    if (!stillMember) return json({ error: "not_in_guild" }, 403);
  }

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await env.AUTH_KV.put(
    "sess:" + token,
    JSON.stringify({ ...user, issued: Date.now() }),
    { expirationTtl: SESSION_TTL }
  );

  return json({ ok: true, token, user });
}

async function isGuildMember(env, userId) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.GUILD_ID}/members/${userId}`,
    { headers: { Authorization: "Bot " + env.DISCORD_BOT_TOKEN } }
  );
  return res.ok;
}

async function session(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const raw = await env.AUTH_KV.get("sess:" + token);
  if (!raw) return null;
  return { token, user: JSON.parse(raw) };
}

async function handleMe(request, env) {
  const s = await session(request, env);
  if (!s) return json({ ok: false, error: "no_session" }, 401);
  return json({
    ok: true,
    user: { id: s.user.id, username: s.user.username, avatar: s.user.avatar }
  });
}

async function handleLogout(request, env) {
  const s = await session(request, env);
  if (s) await env.AUTH_KV.delete("sess:" + s.token);
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Per-user saved data                                                 */
/* ------------------------------------------------------------------ */

async function handleData(request, env, key) {
  const s = await session(request, env);
  if (!s) return json({ error: "no_session" }, 401);
  if (!key || key.length > 64) return json({ error: "bad_key" }, 400);

  const kvKey = `user:${s.user.id}:${key}`;

  if (request.method === "GET") {
    const raw = await env.AUTH_KV.get(kvKey);
    return json({ ok: true, value: raw ? JSON.parse(raw) : null });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!body || !("value" in body)) return json({ error: "bad_body" }, 400);
    const serialized = JSON.stringify(body.value);
    if (serialized.length > 1000000) return json({ error: "too_large" }, 413);
    await env.AUTH_KV.put(kvKey, serialized);
    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
}

/* ------------------------------------------------------------------ */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function cors(env, res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN || "*");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  h.set("Vary", "Origin");
  return new Response(res.body, { status: res.status, headers: h });
}

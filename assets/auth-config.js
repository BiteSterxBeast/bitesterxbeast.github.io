/* BiteSterxBeast — auth config
   The ONLY file you need to edit after deploying the Worker. */
window.BSB_AUTH = {
  // Paste your deployed Cloudflare Worker URL here (no trailing slash).
  api: "https://bsb-auth.bitesterxbeastbusiness.workers.dev",

  // Your Discord server invite.
  invite: "https://discord.gg/nvAvpsucpa",

  // Pages that never require sign-in (paths, matched by "starts with").
  publicPaths: ["/sign-in/", "/privacy-terms/"]
};

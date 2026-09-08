/* BiteSterxBeast — auth gate
   Include on every page AFTER auth-config.js:
     <script src="/assets/auth-config.js"></script>
     <script src="/assets/auth-gate.js"></script>

   NOTE: this is a client-side gate. It hides pages from normal visitors,
   but anyone can still read the raw HTML from GitHub. Real protection is
   on the Worker: saved user data is only returned with a valid session. */
(function () {
  var CFG = window.BSB_AUTH || {};
  var KEY = "bsb_session";
  var CACHE_KEY = "bsb_session_checked";
  var REVALIDATE_MS = 10 * 60 * 1000; // re-check with the server every 10 min

  var path = location.pathname;
  var isPublic = (CFG.publicPaths || []).some(function (p) {
    return path.indexOf(p) === 0 || path.indexOf(p.replace(/\/$/, "")) === 0;
  });
  if (isPublic) return;

  // Hide the page until we know the visitor is signed in.
  var style = document.createElement("style");
  style.id = "bsb-gate-style";
  style.textContent = "html{visibility:hidden!important}";
  (document.head || document.documentElement).appendChild(style);

  function reveal() {
    var s = document.getElementById("bsb-gate-style");
    if (s) s.remove();
  }

  function toSignIn() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(CACHE_KEY); } catch (e) {}
    var next = encodeURIComponent(path + location.search);
    location.replace("/sign-in/?next=" + next);
  }

  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) {}
  if (!token) return toSignIn();

  var last = 0;
  try { last = parseInt(localStorage.getItem(CACHE_KEY) || "0", 10); } catch (e) {}

  // Recently validated — show immediately, re-check quietly in the background.
  if (Date.now() - last < REVALIDATE_MS) {
    reveal();
    validate(token, function (ok) { if (!ok) toSignIn(); });
    return;
  }

  validate(token, function (ok, user) {
    if (!ok) return toSignIn();
    try { localStorage.setItem(CACHE_KEY, String(Date.now())); } catch (e) {}
    reveal();
    if (user) injectUserChip(user);
  });

  function validate(tok, cb) {
    fetch(CFG.api + "/me", { headers: { Authorization: "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { cb(!!(j && j.ok), j && j.user); })
      .catch(function () {
        // Worker unreachable — fail open on an already-cached session so a
        // Cloudflare blip doesn't lock you out of your own site.
        cb(last > 0, null);
      });
  }

  function injectUserChip(user) {
    document.addEventListener("DOMContentLoaded", function () {
      var nav = document.querySelector(".nav-links");
      if (!nav || nav.querySelector(".bsb-user-chip")) return;

      var wrap = document.createElement("div");
      wrap.className = "bsb-user-chip";
      wrap.style.cssText = "position:relative;display:inline-flex;";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;background:none;border:none;cursor:pointer;" +
        "color:var(--muted,#8A93A1);font:inherit;font-size:13px;font-weight:600;padding:0;";
      if (user.avatar) {
        var img = document.createElement("img");
        img.src = user.avatar;
        img.width = 20; img.height = 20;
        img.style.cssText = "border-radius:50%;display:block;";
        btn.appendChild(img);
      }
      var nameSpan = document.createElement("span");
      nameSpan.textContent = user.username;
      btn.appendChild(nameSpan);
      var caret = document.createElement("span");
      caret.textContent = "\u25BE";
      caret.style.cssText = "font-size:9px;opacity:.7;";
      btn.appendChild(caret);

      var menu = document.createElement("div");
      menu.style.cssText =
        "position:absolute;top:calc(100% + 10px);right:0;min-width:160px;" +
        "background:var(--panel,#14171C);border:1px solid var(--line,#262B33);border-radius:10px;" +
        "padding:10px;display:none;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,0.35);";

      var status = document.createElement("div");
      if (user.pro) {
        status.textContent = "Pro Boost";
        status.style.cssText = "font-size:18px;font-weight:700;color:#F2C744;padding:2px 6px 8px;";
      } else {
        status.textContent = "Regular";
        status.style.cssText = "font-size:14px;font-weight:600;color:var(--muted,#8A93A1);padding:2px 6px 8px;";
      }
      menu.appendChild(status);

      var settings = document.createElement("div");
      settings.textContent = "Settings";
      settings.style.cssText =
        "font-size:13px;color:var(--text,#E8EAED);padding:8px 6px;cursor:default;";
      menu.appendChild(settings);

      var signOut = document.createElement("button");
      signOut.type = "button";
      signOut.textContent = "Log Off";
      signOut.style.cssText =
        "display:block;width:100%;text-align:left;background:none;border:none;cursor:pointer;" +
        "color:#E5484D;font:inherit;font-weight:600;font-size:13px;padding:8px 6px;border-radius:6px;";
      signOut.addEventListener("mouseenter", function () { signOut.style.background = "var(--panel-2,#1B1F26)"; });
      signOut.addEventListener("mouseleave", function () { signOut.style.background = "none"; });
      signOut.addEventListener("click", function () {
        var tok = localStorage.getItem(KEY);
        fetch(CFG.api + "/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok }
        }).catch(function () {}).then(function () { toSignIn(); });
      });
      menu.appendChild(signOut);

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.style.display = menu.style.display === "block" ? "none" : "block";
      });
      document.addEventListener("click", function () { menu.style.display = "none"; });

      wrap.appendChild(btn);
      wrap.appendChild(menu);
      nav.appendChild(wrap);
    });
  }

  // Small helper other pages can use for per-user saved data.
  window.bsbData = {
    get: function (key) {
      return fetch(CFG.api + "/data/" + encodeURIComponent(key), {
        headers: { Authorization: "Bearer " + localStorage.getItem(KEY) }
      }).then(function (r) { return r.ok ? r.json() : null; });
    },
    set: function (key, value) {
      return fetch(CFG.api + "/data/" + encodeURIComponent(key), {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + localStorage.getItem(KEY),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ value: value })
      }).then(function (r) { return r.ok; });
    }
  };
})();

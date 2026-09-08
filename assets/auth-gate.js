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

      var chip = document.createElement("a");
      chip.className = "bsb-user-chip";
      chip.href = "#";
      chip.title = "Signed in as " + user.username + " — click to sign out";
      chip.style.cssText =
        "display:inline-flex;align-items:center;gap:7px;color:var(--muted,#8A93A1);" +
        "text-decoration:none;font-size:13px;font-weight:600;";
      if (user.avatar) {
        var img = document.createElement("img");
        img.src = user.avatar;
        img.width = 20; img.height = 20;
        img.style.cssText = "border-radius:50%;display:block;";
        chip.appendChild(img);
      }
      chip.appendChild(document.createTextNode(user.username));
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        var tok = localStorage.getItem(KEY);
        fetch(CFG.api + "/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + tok }
        }).catch(function () {}).then(function () { toSignIn(); });
      });
      nav.appendChild(chip);
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

/* BiteSterxBeast — Pro features (cosmetic only)
   Injects a glowing "Pro" nav button that opens a panel for customizing
   the site background (solid color or image). Purely cosmetic — no tool
   behavior is affected. Not gated by boost status yet; see worker.js for
   where that would hook in later.

   Include on every page, after auth-config.js and whichever of
   auth-gate.js / auth-home.js that page uses:
     <script src="/assets/auth-config.js"></script>
     <script src="/assets/auth-gate.js"></script>  (or auth-home.js)
     <script src="/assets/pro-features.js"></script> */
(function () {
  var CFG = window.BSB_AUTH || {};
  var LOCAL_KEY = "bsb_pro_bg";
  var SESSION_KEY = "bsb_session";

  // Apply whatever's saved locally immediately, before DOMContentLoaded,
  // to avoid a flash of the default background.
  applyBackground(readLocal());

  document.addEventListener("DOMContentLoaded", function () {
    injectButton();

    // If signed in, the server copy is the source of truth (follows you
    // across devices) — apply it once it loads, and keep local in sync.
    var token = null;
    try { token = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (token && CFG.api) {
      fetch(CFG.api + "/data/pro-background", { headers: { Authorization: "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ok && j.value) {
            applyBackground(j.value);
            saveLocal(j.value);
          }
        })
        .catch(function () {});
    }
  });

  function readLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLocal(val) {
    try {
      if (val) localStorage.setItem(LOCAL_KEY, JSON.stringify(val));
      else localStorage.removeItem(LOCAL_KEY);
    } catch (e) {}
  }

  function applyBackground(val) {
    if (!val) { document.body.style.background = ""; return; }
    if (val.type === "color" && val.color) {
      document.body.style.background = val.color;
    } else if (val.type === "image" && val.url) {
      document.body.style.background =
        "url('" + val.url + "') center center / cover no-repeat fixed, var(--bg, #0B0D10)";
    }
  }

  function persist(val) {
    saveLocal(val);
    var token = null;
    try { token = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (token && CFG.api) {
      fetch(CFG.api + "/data/pro-background", {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ value: val })
      }).catch(function () {});
    }
  }

  function injectButton() {
    var nav = document.querySelector(".nav-links");
    if (!nav || nav.querySelector(".bsb-pro-btn")) return;

    if (!document.getElementById("bsb-pro-glow-style")) {
      var style = document.createElement("style");
      style.id = "bsb-pro-glow-style";
      style.textContent =
        "@keyframes bsbProGlow{0%,100%{box-shadow:0 0 6px rgba(242,184,75,.55);}50%{box-shadow:0 0 16px rgba(242,184,75,.95);}}" +
        "@media (prefers-reduced-motion: reduce){.bsb-pro-btn{animation:none!important;}}";
      document.head.appendChild(style);
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bsb-pro-btn";
    btn.textContent = "\u26A1 Pro";
    btn.style.cssText =
      "font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:none;" +
      "border-radius:20px;padding:6px 14px;color:#3a2c00;letter-spacing:.01em;" +
      "background:linear-gradient(135deg,#FFD866,#F2B84B);" +
      "box-shadow:0 0 8px rgba(242,184,75,0.6);animation:bsbProGlow 2.4s ease-in-out infinite;";
    btn.addEventListener("click", openModal);

    var links = nav.querySelectorAll("a");
    var changelogLink = null;
    links.forEach(function (a) { if (a.textContent.trim() === "Changelog") changelogLink = a; });
    if (changelogLink) changelogLink.insertAdjacentElement("afterend", btn);
    else nav.appendChild(btn);
  }

  function openModal() {
    if (document.getElementById("bsb-pro-modal")) return;
    var current = readLocal();

    var overlay = document.createElement("div");
    overlay.id = "bsb-pro-modal";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;" +
      "display:flex;align-items:center;justify-content:center;padding:20px;";

    var box = document.createElement("div");
    box.style.cssText =
      "background:#14171C;border:1px solid #262B33;border-radius:16px;max-width:420px;width:100%;" +
      "padding:28px;color:#E8EAED;font-family:Inter,system-ui,sans-serif;";

    box.innerHTML =
      '<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
      'color:#3a2c00;background:linear-gradient(135deg,#FFD866,#F2B84B);padding:5px 11px;border-radius:20px;margin-bottom:14px;">\u26A1 Pro Feature</div>' +
      '<h2 style="font-family:\'Space Grotesk\',sans-serif;font-size:20px;margin:0 0 8px;">Custom Background</h2>' +
      '<p style="color:#8A93A1;font-size:13.5px;line-height:1.6;margin:0 0 20px;">Set a background color or image across the site. Cosmetic only \u2014 doesn\u2019t change how any tool works.</p>' +
      '<div style="margin-bottom:14px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Solid color</label>' +
      '<input type="color" id="bsb-pro-color" value="' + (current && current.color ? current.color : "#0B0D10") + '" ' +
      'style="width:100%;height:40px;border:1px solid #262B33;border-radius:8px;background:none;cursor:pointer;"></div>' +
      '<div style="margin-bottom:20px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Or image URL</label>' +
      '<input type="text" id="bsb-pro-image" placeholder="https://..." value="' + (current && current.url ? current.url : "") + '" ' +
      'style="width:100%;padding:9px 11px;border:1px solid #262B33;border-radius:8px;background:#1B1F26;color:#E8EAED;font-size:13px;box-sizing:border-box;"></div>' +
      '<div style="display:flex;gap:10px;">' +
      '<button id="bsb-pro-apply" style="flex:1;padding:10px;border:none;border-radius:8px;background:#34D6C4;color:#04211D;font-weight:700;font-size:13px;cursor:pointer;">Apply</button>' +
      '<button id="bsb-pro-reset" style="padding:10px 14px;border:1px solid #262B33;border-radius:8px;background:none;color:#8A93A1;font-size:13px;cursor:pointer;">Reset</button>' +
      '<button id="bsb-pro-close" style="padding:10px 14px;border:1px solid #262B33;border-radius:8px;background:none;color:#8A93A1;font-size:13px;cursor:pointer;">Close</button>' +
      '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.getElementById("bsb-pro-close").addEventListener("click", close);
    document.getElementById("bsb-pro-reset").addEventListener("click", function () {
      applyBackground(null);
      persist(null);
    });
    document.getElementById("bsb-pro-apply").addEventListener("click", function () {
      var img = document.getElementById("bsb-pro-image").value.trim();
      var color = document.getElementById("bsb-pro-color").value;
      var val = img ? { type: "image", url: img } : { type: "color", color: color };
      applyBackground(val);
      persist(val);
    });
  }
})();

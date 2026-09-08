/* BiteSterxBeast — Pro features (cosmetic only)
   Injects a glowing "Pro" nav button that opens a panel of color tints.
   Picking a tint recolors the site's accent (--teal, used by buttons,
   badges, the live-dot, link hovers) to a lighter shade of that color,
   and recolors the background gradient to match. A custom image URL is
   also available as a secondary option. Purely cosmetic — no tool
   behavior is affected. Not gated by boost status yet; see worker.js
   for where that would hook in later.

   Include on every page, after auth-config.js and whichever of
   auth-gate.js / auth-home.js that page uses:
     <script src="/assets/auth-config.js"></script>
     <script src="/assets/auth-gate.js"></script>  (or auth-home.js)
     <script src="/assets/pro-features.js"></script> */
(function () {
  var CFG = window.BSB_AUTH || {};
  var LOCAL_KEY = "bsb_pro_bg";
  var SESSION_KEY = "bsb_session";

  // Preset tints: "swatch" is the circle's own color, "gradient" is the
  // dark blob color used in the page background, "accent" replaces
  // --teal (a lighter shade of the tint), "text" is the dark text color
  // used on top of the accent (matches how --teal buttons already work).
  var TINTS = [
    { key: "orange", swatch: "#F2934A", gradient: "#3a2308", accent: "#FFA552", text: "#2b1706" },
    { key: "green",  swatch: "#2E8B3D", gradient: "#102a14", accent: "#5FD37A", text: "#08210d" },
    { key: "blue",   swatch: "#1F6FB2", gradient: "#0b1f33", accent: "#59A8E8", text: "#04182b" },
    { key: "purple", swatch: "#A93FCB", gradient: "#2a1233", accent: "#D07AEE", text: "#260a30" },
    { key: "peach",  swatch: "#F2C29A", gradient: "#33241a", accent: "#F7D5B0", text: "#3a2413" }
  ];

  // Apply whatever's saved locally immediately, before DOMContentLoaded,
  // to avoid a flash of the wrong theme.
  applyState(readLocal());

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
          if (j && j.ok && j.value !== undefined) {
            applyState(j.value);
            saveLocal(j.value);
            refreshActiveMarks();
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

  // Applies via an injected <style> rule rather than touching
  // document.body directly — this script runs from <head>, before
  // <body> exists, so touching document.body here would throw and kill
  // the rest of the script before the button ever gets created.
  function applyState(val) {
    var css = "";
    if (val && val.type === "tint") {
      var t = findTint(val.key);
      if (t) {
        css =
          "body{background:radial-gradient(ellipse at 20% -10%, " + t.gradient + " 0%, transparent 55%), #0B0D10 !important;}" +
          ":root{--teal:" + t.accent + " !important;}";
      }
    } else if (val && val.type === "image" && val.url) {
      var safeUrl = String(val.url).replace(/["'\\]/g, "");
      css = "body{background:url('" + safeUrl + "') center center / cover no-repeat fixed, #0B0D10 !important;}";
    }
    var style = document.getElementById("bsb-pro-bg-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "bsb-pro-bg-style";
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  function findTint(key) {
    for (var i = 0; i < TINTS.length; i++) if (TINTS[i].key === key) return TINTS[i];
    return null;
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

  function isActive(val, kind, key) {
    if (kind === "default") return !val;
    return !!(val && val.type === "tint" && val.key === key);
  }

  function refreshActiveMarks() {
    var wrap = document.getElementById("bsb-pro-swatches");
    if (!wrap) return;
    var current = readLocal();
    wrap.querySelectorAll(".bsb-swatch").forEach(function (el) {
      var active = isActive(current, el.dataset.kind, el.dataset.key);
      el.querySelector(".bsb-swatch-check").style.display = active ? "flex" : "none";
      el.style.boxShadow = active ? "0 0 0 3px #34D6C4" : "0 0 0 2px #262B33";
    });
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
      "background:#14171C;border:1px solid #262B33;border-radius:16px;max-width:440px;width:100%;" +
      "padding:28px;color:#E8EAED;font-family:Inter,system-ui,sans-serif;";

    var header = document.createElement("div");
    header.innerHTML =
      '<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
      'color:#3a2c00;background:linear-gradient(135deg,#FFD866,#F2B84B);padding:5px 11px;border-radius:20px;margin-bottom:14px;">\u26A1 Pro Feature</div>' +
      '<h2 style="font-family:\'Space Grotesk\',sans-serif;font-size:20px;margin:0 0 8px;">Custom Background</h2>' +
      '<p style="color:#8A93A1;font-size:13.5px;line-height:1.6;margin:0 0 22px;">Pick a tint to recolor the site\u2019s background and accent color together. Cosmetic only \u2014 doesn\u2019t change how any tool works.</p>' +
      '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:10px;">Color Tints</label>';
    box.appendChild(header);

    var swatchWrap = document.createElement("div");
    swatchWrap.id = "bsb-pro-swatches";
    swatchWrap.style.cssText = "display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;";

    function makeSwatch(kind, key, color) {
      var cell = document.createElement("div");
      cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px;";

      var circle = document.createElement("button");
      circle.type = "button";
      circle.className = "bsb-swatch";
      circle.dataset.kind = kind;
      if (key) circle.dataset.key = key;
      circle.style.cssText =
        "width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;position:relative;" +
        "background:" + color + ";box-shadow:0 0 0 2px #262B33;transition:box-shadow .15s;";

      var check = document.createElement("div");
      check.className = "bsb-swatch-check";
      check.textContent = "\u2713";
      check.style.cssText =
        "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
        "color:#34D6C4;font-size:18px;font-weight:700;background:rgba(0,0,0,.35);border-radius:50%;";
      circle.appendChild(check);

      circle.addEventListener("click", function () {
        var val = kind === "default" ? null : { type: "tint", key: key };
        applyState(val);
        persist(val);
        refreshActiveMarks();
      });

      cell.appendChild(circle);
      swatchWrap.appendChild(cell);
    }

    TINTS.forEach(function (t) { makeSwatch("tint", t.key, t.swatch); });
    makeSwatch("default", null, "#0B0D10");

    box.appendChild(swatchWrap);

    var imageSection = document.createElement("div");
    imageSection.style.cssText = "margin-bottom:20px;";
    imageSection.innerHTML =
      '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Or use your own image</label>' +
      '<div style="display:flex;gap:8px;">' +
      '<input type="text" id="bsb-pro-image" placeholder="https://..." value="' + (current && current.type === "image" ? current.url : "") + '" ' +
      'style="flex:1;padding:9px 11px;border:1px solid #262B33;border-radius:8px;background:#1B1F26;color:#E8EAED;font-size:13px;box-sizing:border-box;">' +
      '<button id="bsb-pro-image-apply" style="padding:9px 14px;border:none;border-radius:8px;background:#34D6C4;color:#04211D;font-weight:700;font-size:13px;cursor:pointer;">Set</button>' +
      '</div>';
    box.appendChild(imageSection);

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.style.cssText =
      "width:100%;padding:10px;border:1px solid #262B33;border-radius:8px;background:none;color:#8A93A1;font-size:13px;cursor:pointer;";
    box.appendChild(closeBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    refreshActiveMarks();

    function close() { overlay.remove(); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    closeBtn.addEventListener("click", close);
    document.getElementById("bsb-pro-image-apply").addEventListener("click", function () {
      var url = document.getElementById("bsb-pro-image").value.trim();
      if (!url) return;
      var val = { type: "image", url: url };
      applyState(val);
      persist(val);
      refreshActiveMarks();
    });
  }
})();

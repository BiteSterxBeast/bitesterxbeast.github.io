/* BiteSterxBeast — Pro features (cosmetic only)
   Injects a glowing "Pro" nav button that opens a panel with:
     - Color Tints: recolors the site accent (--teal) + background blob
     - Background Style: animated CSS background patterns, drawn using
       whichever tint is active (or the site's default teal if none)
     - a custom image URL as a manual override for the background
   Purely cosmetic — no tool behavior is affected. Not gated by boost
   status yet; see worker.js for where that would hook in later.

   Include on every page, after auth-config.js and whichever of
   auth-gate.js / auth-home.js that page uses:
     <script src="/assets/auth-config.js"></script>
     <script src="/assets/auth-gate.js"></script>  (or auth-home.js)
     <script src="/assets/pro-features.js"></script> */
(function () {
  var CFG = window.BSB_AUTH || {};
  var LOCAL_KEY = "bsb_pro_bg";
  var SESSION_KEY = "bsb_session";

  var DEFAULT_COLORS = { accent: "#34D6C4", gradient: "#1a1d24" };

  var TINTS = [
    { key: "orange", swatch: "#F2934A", gradient: "#3a2308", accent: "#FFA552" },
    { key: "green",  swatch: "#2E8B3D", gradient: "#102a14", accent: "#5FD37A" },
    { key: "blue",   swatch: "#1F6FB2", gradient: "#0b1f33", accent: "#59A8E8" },
    { key: "purple", swatch: "#A93FCB", gradient: "#2a1233", accent: "#D07AEE" },
    { key: "peach",  swatch: "#F2C29A", gradient: "#33241a", accent: "#F7D5B0" }
  ];

  var STYLES = [
    { key: "none",     label: "Plain" },
    { key: "neon",     label: "Neon Retro" },
    { key: "waves",    label: "Moving Waves" },
    { key: "flare",    label: "Animated Flare" },
    { key: "abstract", label: "Abstract Gradient" },
    { key: "lines",    label: "Glowing Lines" },
    { key: "tunnel",   label: "Light Tunnel" },
    { key: "aurora",   label: "Aurora Drift" }
  ];

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return r + "," + g + "," + b;
  }

  function findTint(key) {
    for (var i = 0; i < TINTS.length; i++) if (TINTS[i].key === key) return TINTS[i];
    return null;
  }

  function colorsForState(val) {
    var t = val && val.tint ? findTint(val.tint) : null;
    var accent = t ? t.accent : DEFAULT_COLORS.accent;
    var gradient = t ? t.gradient : DEFAULT_COLORS.gradient;
    return { accent: accent, gradient: gradient, accentRgb: hexToRgb(accent), gradientRgb: hexToRgb(gradient) };
  }

  // Builds the CSS text for a given background style applied to `selector`
  // (either "body" for the real page, or a small thumbnail class for the
  // picker). Every style is pure CSS — gradients + keyframes — so a tiny
  // thumbnail is a 100%-accurate small-scale preview of the real thing.
  function buildStyleCSS(selector, styleKey, c) {
    switch (styleKey) {
      case "neon":
        return (
          selector + "{background:" +
          "radial-gradient(circle at 50% 10%, rgba(" + c.accentRgb + ",0.55) 0%, rgba(" + c.accentRgb + ",0.12) 22%, transparent 46%)," +
          "repeating-linear-gradient(0deg, rgba(" + c.accentRgb + ",0.22) 0px, rgba(" + c.accentRgb + ",0.22) 1px, transparent 1px, transparent 14px)," +
          "linear-gradient(180deg, #0B0D10 0%, " + c.gradient + " 100%) !important;" +
          "background-size:100% 100%,100% 46%,100% 100% !important;" +
          "background-position:center top,center bottom,center !important;" +
          "background-repeat:no-repeat,repeat-x,no-repeat !important;" +
          "animation:bsbNeonPulse 4s ease-in-out infinite !important;}" +
          "@keyframes bsbNeonPulse{0%,100%{filter:brightness(1);}50%{filter:brightness(1.18);}}"
        );
      case "waves":
        return (
          selector + "{background:" +
          "radial-gradient(circle at 50% 120%, rgba(" + c.accentRgb + ",0.4) 0%, transparent 62%)," +
          "linear-gradient(180deg, #0B0D10 0%, " + c.gradient + " 100%) !important;" +
          "background-size:140px 90px,100% 100% !important;" +
          "background-position:0 100%,center !important;" +
          "background-repeat:repeat-x,no-repeat !important;" +
          "animation:bsbWaveShift 9s linear infinite !important;}" +
          "@keyframes bsbWaveShift{from{background-position:0 100%,center;}to{background-position:-140px 100%,center;}}"
        );
      case "flare":
        return (
          selector + "{background:" +
          "radial-gradient(circle at 30% 40%, rgba(" + c.accentRgb + ",0.4) 0%, transparent 38%)," +
          "radial-gradient(circle at 70% 65%, rgba(" + c.gradientRgb + ",0.55) 0%, transparent 42%)," +
          "#0B0D10 !important;" +
          "background-size:150% 150%,170% 170%,100% 100% !important;" +
          "animation:bsbFlareDrift 12s ease-in-out infinite alternate !important;}" +
          "@keyframes bsbFlareDrift{" +
          "0%{background-position:20% 20%,80% 70%,center;}" +
          "50%{background-position:60% 55%,30% 30%,center;}" +
          "100%{background-position:30% 70%,70% 20%,center;}}"
        );
      case "abstract":
        return (
          selector + "{background:linear-gradient(120deg, " + c.gradient + " 0%, " + c.accent + " 50%, " + c.gradient + " 100%) !important;" +
          "background-size:300% 300% !important;" +
          "animation:bsbAbstractShift 14s ease infinite !important;}" +
          "@keyframes bsbAbstractShift{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}"
        );
      case "lines":
        return (
          selector + "{background:" +
          "repeating-linear-gradient(115deg, transparent 0px, transparent 40px, rgba(" + c.accentRgb + ",0.55) 42px, transparent 44px, transparent 90px)," +
          "repeating-linear-gradient(65deg, transparent 0px, transparent 55px, rgba(" + c.accentRgb + ",0.3) 57px, transparent 59px, transparent 110px)," +
          "#0B0D10 !important;" +
          "animation:bsbLinesGlow 5s ease-in-out infinite !important;}" +
          "@keyframes bsbLinesGlow{0%,100%{filter:brightness(1) saturate(1);}50%{filter:brightness(1.35) saturate(1.25);}}"
        );
      case "tunnel":
        return (
          selector + "{background:repeating-radial-gradient(circle at center, " + c.gradient + " 0px, " + c.gradient + " 14px, rgba(" + c.accentRgb + ",0.55) 15px, " + c.gradient + " 16px, " + c.gradient + " 30px) !important;" +
          "background-size:200% 200% !important;" +
          "animation:bsbTunnelZoom 5s linear infinite !important;}" +
          "@keyframes bsbTunnelZoom{0%{background-size:200% 200%;}100%{background-size:100% 100%;}}"
        );
      case "aurora":
        return (
          selector + "{background:" +
          "radial-gradient(ellipse 80% 50% at 30% 0%, rgba(" + c.accentRgb + ",0.4), transparent 60%)," +
          "radial-gradient(ellipse 60% 40% at 70% 10%, rgba(" + c.gradientRgb + ",0.55), transparent 65%)," +
          "#0B0D10 !important;" +
          "animation:bsbAuroraFlow 16s ease-in-out infinite alternate !important;}" +
          "@keyframes bsbAuroraFlow{0%{background-position:0% 0%,100% 0%;}100%{background-position:40% 20%,60% 30%;}}"
        );
      case "none":
      default:
        return selector + "{background:radial-gradient(ellipse at 20% -10%, " + c.gradient + " 0%, transparent 55%), #0B0D10 !important;}";
    }
  }

  function ensureStyleTag(id) {
    var tag = document.getElementById(id);
    if (!tag) {
      tag = document.createElement("style");
      tag.id = id;
      (document.head || document.documentElement).appendChild(tag);
    }
    return tag;
  }

  function isDefaultState(val) {
    return !val || (!val.tint && !val.style && !val.image);
  }

  // Applies via injected <style> rules rather than touching document.body
  // directly — this script runs from <head>, before <body> exists, so
  // touching document.body here would throw and kill the rest of the
  // script before the button ever gets created.
  function applyState(val) {
    var c = colorsForState(val);
    var css;

    if (val && val.image) {
      var safeUrl = String(val.image).replace(/["'\\]/g, "");
      css = "body{background:url('" + safeUrl + "') center center / cover no-repeat fixed, #0B0D10 !important;}";
    } else {
      css = buildStyleCSS("body", (val && val.style) || "none", c);
    }
    if (val && val.tint) css += ":root{--teal:" + c.accent + " !important;}";
    css += "@media (prefers-reduced-motion: reduce){body{animation:none !important;}}";

    ensureStyleTag("bsb-pro-bg-style").textContent = css;
  }

  applyState(readLocal());

  document.addEventListener("DOMContentLoaded", function () {
    injectButton();

    var token = null;
    try { token = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (token && CFG.api) {
      fetch(CFG.api + "/data/pro-background", { headers: { Authorization: "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ok && j.value !== undefined) {
            applyState(j.value);
            saveLocal(j.value);
            refreshPanel();
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
      if (val && !isDefaultState(val)) localStorage.setItem(LOCAL_KEY, JSON.stringify(val));
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

  var current = null; // working copy of the state while the modal is open

  function refreshPanel() {
    current = readLocal() || { tint: null, style: null, image: null };
    var tintWrap = document.getElementById("bsb-pro-tints");
    var styleWrap = document.getElementById("bsb-pro-styles");
    if (!tintWrap || !styleWrap) return;

    tintWrap.querySelectorAll(".bsb-swatch").forEach(function (el) {
      var active = el.dataset.key ? current.tint === el.dataset.key : !current.tint;
      el.querySelector(".bsb-swatch-check").style.display = active ? "flex" : "none";
      el.style.boxShadow = active ? "0 0 0 3px #34D6C4" : "0 0 0 2px #262B33";
    });

    // Full rebuild rather than patching in place — thumbnail colors need
    // to reflect whichever tint is now current, and rebuilding from
    // scratch is simpler and safer than trying to patch existing
    // elements' inline styles piecemeal.
    buildStyleGrid();
  }

  function openModal() {
    if (document.getElementById("bsb-pro-modal")) return;
    current = readLocal() || { tint: null, style: null, image: null };

    var overlay = document.createElement("div");
    overlay.id = "bsb-pro-modal";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;" +
      "display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto;";

    var box = document.createElement("div");
    box.style.cssText =
      "background:#14171C;border:1px solid #262B33;border-radius:16px;max-width:520px;width:100%;" +
      "padding:28px;color:#E8EAED;font-family:Inter,system-ui,sans-serif;max-height:88vh;overflow:auto;";

    box.innerHTML =
      '<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
      'color:#3a2c00;background:linear-gradient(135deg,#FFD866,#F2B84B);padding:5px 11px;border-radius:20px;margin-bottom:14px;">\u26A1 Pro Feature</div>' +
      '<h2 style="font-family:\'Space Grotesk\',sans-serif;font-size:20px;margin:0 0 8px;">Custom Background</h2>' +
      '<p style="color:#8A93A1;font-size:13.5px;line-height:1.6;margin:0 0 22px;">Pick a color tint and a background style \u2014 the style redraws using whichever tint is active. Cosmetic only.</p>' +
      '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:10px;">Color Tints</label>' +
      '<div id="bsb-pro-tints" style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;"></div>' +
      '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:10px;">Background Style</label>' +
      '<div id="bsb-pro-styles" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px;"></div>' +
      '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;">Or use your own image</label>' +
      '<div style="display:flex;gap:8px;margin-bottom:20px;">' +
      '<input type="text" id="bsb-pro-image" placeholder="https://..." value="' + (current.image || "") + '" ' +
      'style="flex:1;padding:9px 11px;border:1px solid #262B33;border-radius:8px;background:#1B1F26;color:#E8EAED;font-size:13px;box-sizing:border-box;">' +
      '<button id="bsb-pro-image-apply" style="padding:9px 14px;border:none;border-radius:8px;background:#34D6C4;color:#04211D;font-weight:700;font-size:13px;cursor:pointer;">Set</button>' +
      '</div>' +
      '<button id="bsb-pro-close" style="width:100%;padding:10px;border:1px solid #262B33;border-radius:8px;background:none;color:#8A93A1;font-size:13px;cursor:pointer;">Close</button>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    buildTintRow();
    buildStyleGrid();
    refreshPanel();

    function close() { overlay.remove(); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.getElementById("bsb-pro-close").addEventListener("click", close);
    document.getElementById("bsb-pro-image-apply").addEventListener("click", function () {
      var url = document.getElementById("bsb-pro-image").value.trim();
      current.image = url || null;
      commit();
    });
  }

  function commit() {
    applyState(current);
    persist(isDefaultState(current) ? null : current);
    refreshPanel();
  }

  function buildTintRow() {
    var wrap = document.getElementById("bsb-pro-tints");
    wrap.innerHTML = "";

    function makeCircle(key, color) {
      var circle = document.createElement("button");
      circle.type = "button";
      circle.className = "bsb-swatch";
      if (key) circle.dataset.key = key;
      circle.style.cssText =
        "width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;position:relative;" +
        "background:" + color + ";box-shadow:0 0 0 2px #262B33;transition:box-shadow .15s;flex-shrink:0;";
      var check = document.createElement("div");
      check.className = "bsb-swatch-check";
      check.textContent = "\u2713";
      check.style.cssText =
        "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
        "color:#fff;font-size:16px;font-weight:700;background:rgba(0,0,0,.35);border-radius:50%;";
      circle.appendChild(check);
      circle.addEventListener("click", function () {
        current.tint = key || null;
        commit();
      });
      wrap.appendChild(circle);
    }

    TINTS.forEach(function (t) { makeCircle(t.key, t.swatch); });
    makeCircle(null, "#0B0D10");
  }

  function buildStyleGrid() {
    var wrap = document.getElementById("bsb-pro-styles");
    wrap.innerHTML = "";
    var c = colorsForState(current);

    STYLES.forEach(function (s) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "bsb-style-thumb";
      cell.dataset.key = s.key;
      cell.style.cssText =
        "display:flex;flex-direction:column;gap:6px;align-items:center;background:none;" +
        "border:2px solid #262B33;border-radius:10px;padding:6px;cursor:pointer;position:relative;";

      var preview = document.createElement("div");
      preview.className = "bsb-thumb-preview";
      preview.style.cssText = "width:100%;height:44px;border-radius:6px;overflow:hidden;position:relative;";
      var innerCss = buildStyleCSS("&", s.key, c);
      var bodyRule = innerCss.split("@keyframes")[0].replace(/^&\{/, "").replace(/\}\s*$/, "");
      preview.style.cssText += ";" + bodyRule;

      var keyframesCss = innerCss.indexOf("@keyframes") >= 0 ? innerCss.slice(innerCss.indexOf("@keyframes")) : "";
      if (keyframesCss && !document.getElementById("bsb-thumb-kf-" + s.key)) {
        var kfTag = document.createElement("style");
        kfTag.id = "bsb-thumb-kf-" + s.key;
        kfTag.textContent = keyframesCss;
        document.head.appendChild(kfTag);
      }

      var check = document.createElement("div");
      check.className = "bsb-thumb-check";
      check.textContent = "\u2713";
      var isActive = (current.style || "none") === s.key && !current.image;
      check.style.cssText =
        "display:" + (isActive ? "flex" : "none") + ";position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;" +
        "background:#34D6C4;color:#04211D;font-size:10px;font-weight:700;align-items:center;justify-content:center;";
      preview.appendChild(check);
      cell.style.borderColor = isActive ? "#34D6C4" : "#262B33";

      var label = document.createElement("span");
      label.textContent = s.label;
      label.style.cssText = "font-size:10.5px;color:#8A93A1;text-align:center;line-height:1.2;";

      cell.appendChild(preview);
      cell.appendChild(label);
      cell.addEventListener("click", function () {
        current.style = s.key;
        current.image = null; // an explicit style choice overrides a custom image
        var imgInput = document.getElementById("bsb-pro-image");
        if (imgInput) imgInput.value = "";
        commit();
      });
      wrap.appendChild(cell);
    });
  }
})();

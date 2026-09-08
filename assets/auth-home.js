/* BiteSterxBeast — soft auth status (public pages, e.g. the home page)
   This does NOT gate the page — it just:
   - Swaps "Open X" buttons to "Sign In to Use" when signed out
   - Shows a user chip + Sign Out menu in the header when signed in
   Include on a public page AFTER auth-config.js:
     <script src="/assets/auth-config.js"></script>
     <script src="/assets/auth-home.js"></script>

   The actual security still lives on each tool's own page (auth-gate.js) —
   this script only changes what buttons say before you click them. */
(function () {
  var CFG = window.BSB_AUTH || {};
  var KEY = "bsb_session";

  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) {}

  document.addEventListener("DOMContentLoaded", function () {
    if (!token) {
      applySignedOutState();
      return;
    }
    fetch(CFG.api + "/me", { headers: { Authorization: "Bearer " + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok) {
          applySignedInState(j.user);
        } else {
          try { localStorage.removeItem(KEY); } catch (e) {}
          applySignedOutState();
        }
      })
      .catch(function () {
        // Worker unreachable — leave buttons as-is rather than falsely
        // telling a signed-in person to sign in again over a network blip.
      });
  });

  function applySignedOutState() {
    var buttons = document.querySelectorAll(".project-cta.live[data-tool]");
    buttons.forEach(function (btn) {
      btn.textContent = "Sign In to Use";
      btn.setAttribute("href", "/sign-in/?next=" + encodeURIComponent("/"));
    });
  }

  function applySignedInState(user) {
    var nav = document.querySelector(".nav-links");
    if (nav && !nav.querySelector(".bsb-user-chip")) renderChip(nav, user);
    // Buttons keep their default "Open X →" markup — nothing to change.
  }

  function renderChip(nav, user) {
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
      fetch(CFG.api + "/logout", { method: "POST", headers: { Authorization: "Bearer " + token } })
        .catch(function () {})
        .then(function () {
          try { localStorage.removeItem(KEY); localStorage.removeItem("bsb_session_checked"); } catch (e) {}
          location.reload();
        });
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
  }
})();

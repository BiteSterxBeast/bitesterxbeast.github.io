// ui.js — shared UI wiring used on every Channel Deck page: settings /
// changelog / API key / add-channel / add-competitor modals, the activity
// log, the pinned-competitor side panel, drag-and-drop for cards, audio,
// and milestone/webhook notifications. Depends on state.js and api.js.

// --- DOM refs (present on every page) ---
const subLogWrapper = document.getElementById('subLogWrapper');
const subLogContainer = document.getElementById('subLogContainer');
const subLogHeader = document.getElementById('subLogHeader');
const logSizeSelect = document.getElementById('logSizeSelect');
const apiStatusIndicator = document.getElementById('apiStatusIndicator');

const sidePanel = document.getElementById('sidePanel');
const sidePanelContent = document.getElementById('sidePanelContent');
const closePanelBtn = document.getElementById('closePanelBtn');

const settingsOverlay = document.getElementById('settingsOverlay');
const volSlider = document.getElementById('volSlider');
const muteBtn = document.getElementById('muteBtn');
const testAudioBtn = document.getElementById('testAudioBtn');
const windowTogglesGrid = document.getElementById('windowTogglesGrid');
const refreshIntervalSlider = document.getElementById('refreshIntervalSlider');
const refreshIntervalLabel = document.getElementById('refreshIntervalLabel');
const webhookInput = document.getElementById('webhookInput');
const webhookInterval = document.getElementById('webhookInterval');
const testWebhookBtn = document.getElementById('testWebhookBtn');

const changelogOverlay = document.getElementById('changelogOverlay');
const keyOverlay = document.getElementById('keyOverlay');

const footnote = document.getElementById('footnote');
if (footnote) {
  footnote.innerHTML = `Video-window figures show videos <b style="color:var(--muted)">published</b> in that trailing window, and the total lifetime view count those specific videos have accumulated so far — not view growth per day. The YouTube Data API doesn't expose day-by-day view deltas without OAuth access to each channel's own YouTube Analytics, so this is the closest live read possible from public data.`;
}

// --- Audio Logic ---
let audioUnlocked = false;
document.addEventListener('click', () => {
  if(!audioUnlocked) {
    ['subGainSound', 'subLossSound', 'milestoneSound'].forEach(id => {
      const audio = document.getElementById(id);
      if(audio) {
        audio.volume = 0;
        audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = appSettings.muted ? 0 : (appSettings.volume / 100);
        }).catch(e => {});
      }
    });
    audioUnlocked = true;
  }
}, { once: true });

function playSound(id) {
  if (appSettings.muted) return;
  const audio = document.getElementById(id);
  if (audio) {
    audio.volume = appSettings.volume / 100;
    audio.currentTime = 0;
    audio.play().catch(e => {});
  }
}

// --- API Status Indicator ---
function updateApiStatusUi() {
  if (!apiStatusIndicator) return;
  if (!hasApiKey()) {
    apiStatusIndicator.style.display = 'none';
    return;
  }
  apiStatusIndicator.style.display = 'block';
  apiStatusIndicator.innerText = `Using ${apiKeys[activeKeyIndex].name || ('API Key ' + (activeKeyIndex + 1))}`;
}

// --- Settings Modal ---
function updateRefreshSliderUI() {
  const val = parseInt(refreshIntervalSlider.value, 10);
  refreshIntervalLabel.innerText = REFRESH_OPTIONS[val].label;

  const colors = ['#FF4B3E', '#FF9800', '#FCE205', '#2ecc71'];
  const color = colors[val];
  const percentage = (val / 3) * 100;

  refreshIntervalSlider.style.setProperty('--track-bg', `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, var(--line) ${percentage}%, var(--line) 100%)`);
}
if (refreshIntervalSlider) refreshIntervalSlider.addEventListener('input', updateRefreshSliderUI);

function updateVolumeSliderUI() {
  const val = parseInt(volSlider.value, 10);
  volSlider.style.setProperty('--track-bg', `linear-gradient(to right, var(--teal) 0%, var(--teal) ${val}%, var(--line) ${val}%, var(--line) 100%)`);
}
if (volSlider) volSlider.addEventListener('input', updateVolumeSliderUI);

function initSettingsUI() {
  volSlider.value = appSettings.volume;
  updateVolumeSliderUI();
  muteBtn.innerText = `Mute SFX: ${appSettings.muted ? 'ON' : 'OFF'}`;
  muteBtn.className = appSettings.muted ? 'primary' : 'ghost';

  if(appSettings.refreshIntervalIndex === undefined) appSettings.refreshIntervalIndex = 0;
  refreshIntervalSlider.value = appSettings.refreshIntervalIndex;
  updateRefreshSliderUI();

  webhookInput.value = appSettings.discordWebhook || '';
  webhookInterval.value = appSettings.discordInterval || 'milestones';

  windowTogglesGrid.innerHTML = '';
  WINDOWS.forEach(w => {
    const lbl = document.createElement('label');
    const checked = appSettings.windows[w.label] !== false; // default true
    lbl.innerHTML = `<input type="checkbox" class="win-toggle" value="${w.label}" ${checked ? 'checked' : ''}> ${w.label}`;
    windowTogglesGrid.appendChild(lbl);
  });
}

const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) settingsBtn.onclick = () => {
  initSettingsUI();
  settingsOverlay.style.display = 'flex';
};

const settingsClose = document.getElementById('settingsClose');
if (settingsClose) settingsClose.onclick = () => {
  appSettings.volume = parseInt(volSlider.value, 10);

  const oldIndex = appSettings.refreshIntervalIndex;
  appSettings.refreshIntervalIndex = parseInt(refreshIntervalSlider.value, 10);

  appSettings.discordWebhook = webhookInput.value.trim();
  appSettings.discordInterval = webhookInterval.value;

  document.querySelectorAll('.win-toggle').forEach(cb => {
    appSettings.windows[cb.value] = cb.checked;
  });

  saveSettings();
  settingsOverlay.style.display = 'none';
  if (typeof window.refreshUI === 'function') window.refreshUI();

  // Restart auto-refresh timers if the interval changed
  if (oldIndex !== appSettings.refreshIntervalIndex) {
     channels.filter(c => c.autoRefresh).forEach(c => startAutoRefresh(c.id));
  }
};

if (muteBtn) muteBtn.onclick = () => {
  appSettings.muted = !appSettings.muted;
  muteBtn.innerText = `Mute SFX: ${appSettings.muted ? 'ON' : 'OFF'}`;
  muteBtn.className = appSettings.muted ? 'primary' : 'ghost';
};

if (testAudioBtn) testAudioBtn.onclick = () => {
  playSound('milestoneSound');
};

if (testWebhookBtn) testWebhookBtn.onclick = async () => {
  const url = webhookInput.value.trim();
  if(!url) return alert('Paste a webhook URL first.');
  testWebhookBtn.innerText = 'Sending...';
  try {
    await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        embeds: [{
          title: "✅ Channel Deck: Webhook works!",
          description: "Your Discord integration is fully connected.",
          color: 3462852
        }]
      })
    });
    testWebhookBtn.innerText = 'Sent!';
    setTimeout(()=> testWebhookBtn.innerText = 'Test Webhook', 2000);
  } catch(e) {
    testWebhookBtn.innerText = 'Error';
    setTimeout(()=> testWebhookBtn.innerText = 'Test Webhook', 2000);
  }
};

// --- Changelog Modal ---
const changelogBtn = document.getElementById('changelogBtn');
if (changelogBtn) changelogBtn.onclick = () => { changelogOverlay.style.display = 'flex'; };
const changelogClose = document.getElementById('changelogClose');
if (changelogClose) changelogClose.onclick = () => { changelogOverlay.style.display = 'none'; };

// --- Webhook Sender ---
function sendDiscordWebhook(title, oldSubs, newSubs) {
  if (!appSettings.discordWebhook) return;
  fetch(appSettings.discordWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: "🎉 Subscriber Alert!",
        description: `**${title}** just went from \`${oldSubs.toLocaleString()}\` to \`${newSubs.toLocaleString()}\` subscribers!`,
        color: 3462852
      }]
    })
  }).catch(e => console.error("Webhook error:", e));
}

// --- Activity Log ---
function renderLogs() {
  if (!subLogContainer) return;
  subLogContainer.innerHTML = '';
  if (activityLogs.length === 0) {
    subLogWrapper.style.display = 'none';
    return;
  }
  subLogWrapper.style.display = 'flex';

  activityLogs.forEach(log => {
    const entryEl = document.createElement('div');
    entryEl.className = 'log-entry';
    entryEl.innerHTML = `
      <div>
        <div class="log-name">${escapeHTML(log.channelTitle)}</div>
        <div class="log-time">${escapeHTML(log.timeStr)}</div>
      </div>
      <div class="log-diff ${log.isGain ? 'gain' : 'loss'}">${escapeHTML(log.exactDiffStr)}</div>
    `;
    subLogContainer.appendChild(entryEl);
  });

  if (subLogContainer.children.length > 50) {
    activityLogs = activityLogs.slice(activityLogs.length - 50);
    saveLogs();
    subLogContainer.firstChild.remove();
  }

  subLogContainer.scrollTop = subLogContainer.scrollHeight;
}

function logSubChange(channelTitle, oldSubs, newSubs) {
  const diff = newSubs - oldSubs;
  if (diff === 0) return;

  const timeStr = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  const isGain = diff > 0;
  const exactDiffStr = (isGain ? '+' : '') + diff.toLocaleString();

  activityLogs.push({
    channelTitle,
    timeStr,
    isGain,
    exactDiffStr,
    timestamp: Date.now()
  });

  saveLogs();
  renderLogs();
}

function checkSubChanges(id, title, prevSubs, newSubs) {
  if (prevSubs !== undefined && prevSubs !== null && newSubs !== null && newSubs !== undefined) {
    if (newSubs > prevSubs) {
      playSound('subGainSound');
    } else if (newSubs < prevSubs) {
      playSound('subLossSound');
    }

    // UI Milestone Logic
    // Walk every milestone crossed in this update (not just the first one),
    // so jumping across multiple milestones in one poll reports the highest
    // one actually reached instead of silently stopping at the lowest.
    let hitMilestone = false;
    let hitValue = 0;

    for (let m of MILESTONES) {
      if (prevSubs < m && newSubs >= m) {
         hitMilestone = true;
         hitValue = m; // keep going — later (higher) milestones should win
      }
    }

    if (hitMilestone) {
      playSound('milestoneSound');

      const ch = channels.find(c => c.id === id);
      if (ch) {
         ch.milestoneReached = true;
         ch.milestoneValue = hitValue;
         saveChannels();
      }
      const comp = competitors.find(c => c.id === id);
      if (comp) {
         comp.milestoneReached = true;
         comp.milestoneValue = hitValue;
         saveCompetitors();
      }
    }

    // Discord Webhook Logic
    let shouldSendWebhook = false;
    const intervalSetting = appSettings.discordInterval || 'milestones';

    if (intervalSetting === 'milestones') {
       shouldSendWebhook = hitMilestone;
    } else {
       const interval = parseInt(intervalSetting, 10);
       if (!isNaN(interval) && interval > 0) {
           if (Math.floor(prevSubs / interval) < Math.floor(newSubs / interval)) {
               shouldSendWebhook = true;
           }
       }
    }

    if (shouldSendWebhook && newSubs > prevSubs) {
       sendDiscordWebhook(title, prevSubs, newSubs);
    }

    logSubChange(title, prevSubs, newSubs);
  }
}

const clearLogBtn = document.getElementById('clearLogBtn');
if (clearLogBtn) clearLogBtn.onclick = () => {
  activityLogs = [];
  saveLogs();
  renderLogs();
};

// --- Drag Logic for Activity Log ---
let isDraggingLog = false;
let logDragStartX, logDragStartY, logInitialX, logInitialY;

if (subLogHeader) subLogHeader.addEventListener('mousedown', (e) => {
  if (e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'select') return;
  isDraggingLog = true;
  logDragStartX = e.clientX;
  logDragStartY = e.clientY;

  const rect = subLogWrapper.getBoundingClientRect();
  logInitialX = rect.left;
  logInitialY = rect.top;

  subLogWrapper.style.bottom = 'auto';
  subLogWrapper.style.right = 'auto';
  subLogWrapper.style.left = logInitialX + 'px';
  subLogWrapper.style.top = logInitialY + 'px';

  document.addEventListener('mousemove', logDragMove);
  document.addEventListener('mouseup', logDragEnd);
});

function logDragMove(e) {
  if (!isDraggingLog) return;
  const dx = e.clientX - logDragStartX;
  const dy = e.clientY - logDragStartY;
  subLogWrapper.style.left = (logInitialX + dx) + 'px';
  subLogWrapper.style.top = (logInitialY + dy) + 'px';
}

function logDragEnd() {
  isDraggingLog = false;
  document.removeEventListener('mousemove', logDragMove);
  document.removeEventListener('mouseup', logDragEnd);
}

// --- Activity Log Message Size Controls ---
if (logSizeSelect) {
  logSizeSelect.addEventListener('mousedown', e => e.stopPropagation());
  logSizeSelect.addEventListener('touchstart', e => e.stopPropagation());
  logSizeSelect.addEventListener('change', e => {
    const v = e.target.value;
    let name = '18px', time = '14px', diff = '18px';

    if (v === 'small') {
      name = '14px'; time = '12px'; diff = '14px';
    } else if (v === 'large') {
      name = '24px'; time = '18px'; diff = '24px';
    } else if (v === 'xlarge') {
      name = '32px'; time = '24px'; diff = '32px';
    }

    document.documentElement.style.setProperty('--log-font-name', name);
    document.documentElement.style.setProperty('--log-font-time', time);
    document.documentElement.style.setProperty('--log-font-diff', diff);
  });
}

// --- Side Panel (pinned competitors) ---
function updateSidePanel() {
  if (!sidePanel) return;
  const pinnedCompetitors = competitors.filter(ch => ch.isPinned);

  if (pinnedCompetitors.length === 0) {
    sidePanel.classList.remove('open');
    document.body.classList.remove('panel-open');
    sidePanelContent.innerHTML = `<div style="color:var(--muted); font-size:12px; text-align:center; margin-top: 20px;">Click a competitor's avatar or name on the competitors grid to pin it here.</div>`;
    return;
  }

  sidePanel.classList.add('open');
  document.body.classList.add('panel-open');
  sidePanelContent.innerHTML = '';

  pinnedCompetitors.forEach(ch => {
    const c = cache[ch.id];
    const d = c && c.data ? c.data : null;

    let bestVideoPanel = `<div style="border-top: 1px dashed var(--line); padding-top: 12px; font-size: 11px; color: var(--muted);">No recent video found</div>`;

    if (d && d.bestVideo) {
      bestVideoPanel = `
        <div style="border-top: 1px dashed var(--line); padding-top: 12px; margin-top: 12px;">
          <div style="font-size: 10px; color: var(--teal); font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">🔥 Best Video (7d)</div>
          <a href="https://www.youtube.com/watch?v=${d.bestVideo.id}" target="_blank">
             <img src="${d.bestVideo.thumb}" style="width: 100%; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--line); transition: outline 0.15s;" onmouseover="this.style.outline='2px solid var(--teal)'" onmouseout="this.style.outline='none'">
          </a>
          <div style="font-size: 12px; font-weight: 500; color: var(--text); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
             <a href="https://www.youtube.com/watch?v=${d.bestVideo.id}" target="_blank" style="color:var(--text); text-decoration:none;" onmouseover="this.style.color='var(--teal)'" onmouseout="this.style.color='var(--text)'">
                ${escapeHTML(d.bestVideo.title)}
             </a>
          </div>
          <div style="font-size: 11px; color: var(--muted); margin-top: 6px; font-family: 'Space Grotesk', monospace;">
             👁 ${fmt(d.bestVideo.views)} views &nbsp;•&nbsp; ⚡ ${fmtVph(d.bestVideo.vph, d.bestVideo.publishedAt)}
          </div>
        </div>
      `;
    }

    const mini = document.createElement('div');
    mini.className = 'mini-card';
    mini.innerHTML = `
      <button class="remove-mini" data-unpin="${ch.id}">✕</button>
      <div class="mini-card-top">
        <a href="https://www.youtube.com/channel/${ch.id}" target="_blank">
          <img class="mini-avatar" src="${d && d.thumb ? d.thumb : ''}" style="transition: opacity 0.15s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
        </a>
        <div class="mini-name">
          <a href="https://www.youtube.com/channel/${ch.id}" target="_blank">${escapeHTML(d ? d.title : ch.addedAs)}</a>
        </div>
      </div>
      <div>
        <span class="mini-subs">${d && d.subs !== null && d.subs !== undefined ? fmt(d.subs) : (d ? 'hidden' : '···')}</span>
        <span class="mini-sub-label">subs</span>
      </div>
      ${bestVideoPanel}
    `;
    sidePanelContent.appendChild(mini);
  });

  sidePanelContent.querySelectorAll('.remove-mini').forEach(btn => {
    btn.onclick = () => togglePin(btn.dataset.unpin);
  });
}

function togglePin(id) {
  const comp = competitors.find(c => c.id === id);
  if (comp) {
    comp.isPinned = !comp.isPinned;
    saveCompetitors();
    if (typeof window.refreshUI === 'function') window.refreshUI();
    updateSidePanel();
  }
}

if (closePanelBtn) closePanelBtn.onclick = () => {
  competitors.forEach(ch => ch.isPinned = false);
  saveCompetitors();
  if (typeof window.refreshUI === 'function') window.refreshUI();
  updateSidePanel();
};

// --- Drag and Drop (Cards) ---
let dragSrcEl = null;

function handleDragStart(e) {
  if(['INPUT', 'BUTTON', 'TEXTAREA', 'A'].includes(e.target.tagName)) {
    e.preventDefault();
    return;
  }
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.index);
  this.style.opacity = '0.4';
  document.body.classList.add('is-dragging');
}

function handleDragOver(e) {
  if (e.preventDefault) e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.style.outline = '2px dashed var(--teal)';
  this.style.outlineOffset = '2px';
  this.style.borderRadius = '12px';
}

function handleDragLeave(e) {
  this.style.outline = 'none';
}

function handleDrop(e) {
  if (e.stopPropagation) e.stopPropagation();
  this.style.outline = 'none';
  dragSrcEl.style.opacity = '1';

  if (dragSrcEl !== this) {
    const srcIndex = dragSrcEl.dataset.index;
    const destIndex = this.dataset.index;

    const isCompetitorCard = dragSrcEl.closest('.competitor-item');
    const targetArr = isCompetitorCard ? competitors : channels;

    const draggedItem = targetArr[srcIndex];
    targetArr.splice(srcIndex, 1);
    targetArr.splice(destIndex, 0, draggedItem);

    if (isCompetitorCard) {
      saveCompetitors();
    } else {
      saveChannels();
    }
    if (typeof window.refreshUI === 'function') window.refreshUI();
  }
  return false;
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.card').forEach(c => {
      c.classList.remove('drag-over');
      c.style.outline = 'none';
  });
}

// --- Remove channel / competitor ---
function removeChannel(id){
  channels = channels.filter(c => c.id !== id);
  if (!competitors.some(c => c.id === id)) {
    delete cache[id];
  }

  if (chartSnapshots.datasets[id]) {
     delete chartSnapshots.datasets[id];
     saveChartSnapshots();
     if (typeof updateChart === 'function') updateChart();
  }

  saveChannels();
  if (typeof window.refreshUI === 'function') window.refreshUI();
  if (typeof renderGraphToggles === 'function') renderGraphToggles();
  updateSidePanel();
}

function removeCompetitor(id){
  competitors = competitors.filter(c => c.id !== id);
  if (!channels.some(c => c.id === id)) {
    delete cache[id];
  }

  saveCompetitors();
  if (typeof window.refreshUI === 'function') window.refreshUI();
}

// --- API Keys Modal ---
function renderApiKeysModal() {
  const container = document.getElementById('apiKeyList');
  container.innerHTML = '';
  apiKeys.forEach((ak, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = ak.name;
    nameInput.placeholder = 'Key Name';
    nameInput.style.width = '120px';
    nameInput.style.marginBottom = '0';

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.value = ak.value;
    valInput.placeholder = 'AIza...';
    valInput.style.flex = '1';
    valInput.style.marginBottom = '0';

    const delBtn = document.createElement('button');
    delBtn.className = 'ghost';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Remove API Key';
    delBtn.style.padding = '8px 10px';
    delBtn.style.margin = '0';
    delBtn.style.color = 'var(--dim)';
    delBtn.style.border = 'none';
    delBtn.onmouseover = () => delBtn.style.color = 'var(--live)';
    delBtn.onmouseout = () => delBtn.style.color = 'var(--dim)';

    delBtn.onclick = () => {
       apiKeys.splice(idx, 1);
       renderApiKeysModal();
    };

    if (apiKeys.length === 1) delBtn.style.visibility = 'hidden';

    row.appendChild(nameInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });

  document.getElementById('addApiKeyBtn').style.display = apiKeys.length >= 7 ? 'none' : 'block';
}

function openKeyModal(){
  renderApiKeysModal();
  keyOverlay.style.display = 'flex';
}

const addApiKeyBtn = document.getElementById('addApiKeyBtn');
if (addApiKeyBtn) addApiKeyBtn.onclick = () => {
   if (apiKeys.length < 7) {
      apiKeys.push({name: `API Key ${apiKeys.length + 1}`, value: ''});
      renderApiKeysModal();
   }
};

const apiKeyBtn = document.getElementById('apiKeyBtn');
if (apiKeyBtn) apiKeyBtn.onclick = openKeyModal;
const keyCancel = document.getElementById('keyCancel');
if (keyCancel) keyCancel.onclick = () => { keyOverlay.style.display = 'none'; };
const keySave = document.getElementById('keySave');
if (keySave) keySave.onclick = async () => {
  const container = document.getElementById('apiKeyList');
  const rows = container.children;
  for(let i = 0; i < rows.length; i++) {
     apiKeys[i].name = rows[i].children[0].value.trim() || `API Key ${i+1}`;
     apiKeys[i].value = rows[i].children[1].value.trim();
  }

  saveApiKeys();

  activeKeyIndex = apiKeys.findIndex(k => k.value && k.value.trim() !== '');
  if (activeKeyIndex === -1) activeKeyIndex = 0;
  updateApiStatusUi();

  keyOverlay.style.display = 'none';
  if(channels.length || competitors.length) refreshAll();
};

const refreshAllBtn = document.getElementById('refreshAllBtn');
if (refreshAllBtn) refreshAllBtn.onclick = refreshAll;

// --- Add Channel / Add Competitor modal wiring ---
// Both list.html and graph.html use wireAddChannelModal(); competitors.html
// uses wireAddCompetitorModal(). Each pushes into the relevant array and
// kicks off a full data fetch, then lets the page re-render via window.refreshUI.
//
// IMPORTANT: this must NOT capture `channels` / `competitors` by reference.
// loadState() runs later (inside initCommonPage) and *reassigns* those globals
// to freshly-parsed arrays. A captured reference would then point at the
// original, now-orphaned array, so pushes would silently vanish and the
// duplicate check would always miss. We resolve the live array on every call.
function wireAddModal(kind){
  const isCompetitor = kind === 'competitor';
  const getTargetArray = () => (isCompetitor ? competitors : channels);
  const saveFn = () => (isCompetitor ? saveCompetitors() : saveChannels());
  const existsMessage = isCompetitor
    ? 'That competitor is already on your deck.'
    : 'That channel is already on your deck.';

  const addBtn = document.getElementById('addBtn');
  const addOverlay = document.getElementById('addOverlay');
  const channelInput = document.getElementById('channelInput');
  const addError = document.getElementById('addError');
  const addConfirm = document.getElementById('addConfirm');
  const addCancel = document.getElementById('addCancel');
  if (!addBtn || !addOverlay) return;

  addBtn.onclick = () => {
    if(!hasApiKey()){ openKeyModal(); return; }
    addError.style.display = 'none';
    channelInput.value = '';
    addOverlay.style.display = 'flex';
    setTimeout(()=>channelInput.focus(), 30);
  };
  addCancel.onclick = () => { addOverlay.style.display = 'none'; };

  async function confirmAdd(){
    const raw = channelInput.value.trim();
    if(!raw) return;
    const parsed = extractHandleOrId(raw);
    addError.style.display = 'none';
    addConfirm.textContent = 'Adding…';
    addConfirm.disabled = true;
    try{
      const id = await resolveChannelId(parsed);
      const targetArray = getTargetArray();

      if(targetArray.some(c => c.id === id)){
        addError.textContent = existsMessage;
        addError.style.display = 'block';
        return;
      }

      if (isCompetitor) {
        targetArray.push({id, addedAs: raw, notes: "", vidView: 'best', milestoneReached: false, isPinned: false});
      } else {
        targetArray.push({id, addedAs: raw, autoRefresh:false, showOnGraph: true, notes: "", milestoneReached: false});
      }
      saveFn();
      addOverlay.style.display = 'none';
      if (typeof window.refreshUI === 'function') window.refreshUI();
      if (typeof renderGraphToggles === 'function') renderGraphToggles();

      await fetchAllDataFor(id, isCompetitor);

      if (!isCompetitor) {
        if (chartSnapshots.labels.length === 0) {
          recordChartSnapshot();
        } else if (typeof updateChart === 'function') {
          updateChart();
        }
      }

    }catch(e){
      addError.textContent = e.message || 'Could not find that channel.';
      addError.style.display = 'block';
    }finally{
      addConfirm.textContent = 'Add';
      addConfirm.disabled = false;
    }
  }
  addConfirm.onclick = confirmAdd;
  channelInput.addEventListener('keydown', e => { if(e.key==='Enter') confirmAdd(); });
}

function wireAddChannelModal(){
  const addOverlayTitle = document.getElementById('addOverlayTitle');
  if (addOverlayTitle) addOverlayTitle.innerText = 'Add a channel';
  wireAddModal('channel');
}

function wireAddCompetitorModal(){
  const addOverlayTitle = document.getElementById('addOverlayTitle');
  if (addOverlayTitle) addOverlayTitle.innerText = 'Add a competitor';
  wireAddModal('competitor');
}

// --- Page bootstrap ---
// Every page calls this once, passing a callback that renders its own view.
function initCommonPage(pageRenderFn){
  loadState();
  updateApiStatusUi();
  renderLogs();
  updateSidePanel();
  if (typeof pageRenderFn === 'function') pageRenderFn();

  if(hasApiKey()){
    refreshAll();
    channels.filter(c => c.autoRefresh).forEach(c => startAutoRefresh(c.id));
  }
}

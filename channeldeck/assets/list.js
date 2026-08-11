// list.js — Tab List page only. Depends on state.js, api.js, ui.js.

const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');

function renderList(){
  emptyState.style.display = channels.length ? 'none' : 'block';
  grid.innerHTML = '';
  channels.forEach(ch => {
    const c = cache[ch.id] || {status:'idle'};
    const card = document.createElement('div');

    let cardClasses = 'card';
    if(c.status==='loading') cardClasses += ' loading';
    if(c.status==='error') cardClasses += ' error';
    if(ch.isPinned) cardClasses += ' selected-for-panel';
    if(ch.milestoneReached) cardClasses += ' milestone';
    card.className = cardClasses;

    card.draggable = true;
    card.dataset.index = channels.indexOf(ch);
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragenter', handleDragEnter);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);

    if(c.status === 'error'){
      card.innerHTML = `
        <div class="card-top">
          <div class="avatar"></div>
          <div class="card-title">
            <div class="name"><a href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener noreferrer">${escapeHTML(ch.addedAs)}</a></div>
            <div class="handle">channel ID: ${escapeHTML(ch.id)}</div>
          </div>
          <button class="remove-btn" data-remove="${ch.id}" title="Remove">✕</button>
        </div>
        <div class="error-msg">Couldn't load this channel: ${escapeHTML(c.error)}</div>
        <button class="ghost" data-retry="${ch.id}">Retry</button>
      `;
      grid.appendChild(card);
      return;
    }

    const d = c.data;
    const syncedText = d ? new Date(d.syncedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
    const isStale = d && d.syncError;
    const tagColor = isStale ? 'var(--amber)' : 'var(--live)';
    const tagText = isStale ? 'sync failed' : 'live';
    const dotStyle = isStale ? 'animation:none; box-shadow:none; background:var(--amber);' : 'width:6px;height:6px;';
    const safeNote = escapeHTML(ch.notes);

    let bestVideoHtml = '';
    if (d && d.bestVideo) {
      bestVideoHtml = `
        <div class="best-video">
          <div class="best-video-header">🔥 Best Video (Past 7d)</div>
          <div class="best-video-title">
            <a href="https://www.youtube.com/watch?v=${d.bestVideo.id}" target="_blank" rel="noopener noreferrer">
              ${escapeHTML(d.bestVideo.title)}
            </a>
          </div>
          <div class="best-video-stats">
            <span>👁 ${fmt(d.bestVideo.views)} views</span>
            <span>⚡ ${fmtVph(d.bestVideo.vph, d.bestVideo.publishedAt)}</span>
          </div>
        </div>
      `;
    } else if (d && !d.bestVideo) {
       bestVideoHtml = `
        <div class="best-video">
          <div class="best-video-header" style="color:var(--muted)">No videos posted in last 7 days</div>
        </div>
      `;
    }

    let milestoneAckHtml = '';
    if (ch.milestoneReached) {
      milestoneAckHtml = `
        <div style="margin-top:14px;">
          <button class="primary" style="width:100%; font-size:14px; padding: 12px;" data-ack="${ch.id}">🎉 Acknowledge ${fmt(ch.milestoneValue)} Subs!</button>
        </div>
      `;
    }

    const activeWindows = WINDOWS.filter(w => appSettings.windows[w.label] !== false);
    let windowsTableHtml = '';
    if (activeWindows.length > 0) {
      windowsTableHtml = `
        <table class="windows">
          <thead><tr><th>Window</th><th>Videos posted</th><th>Views on those</th></tr></thead>
          <tbody>
            ${activeWindows.map(w => {
              const windowIndex = WINDOWS.findIndex(win => win.label === w.label);
              const wd = d ? d.windows[windowIndex] : null;
              return `<tr><td>${w.label}</td><td class="num">${wd ? wd.count : '···'}</td><td class="num">${wd ? fmt(wd.views) : '···'}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    const currentIntervalText = REFRESH_OPTIONS[appSettings.refreshIntervalIndex || 0].text;

    card.innerHTML = `
      <div class="card-top">
        <img class="avatar" src="${d && d.thumb ? d.thumb : ''}" alt="">
        <div class="card-title">
          <div class="name"><a href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener noreferrer">${escapeHTML(d ? d.title : ch.addedAs)}</a></div>
          <div class="handle">${escapeHTML(d && d.handle ? d.handle : ch.addedAs)}</div>
        </div>
        <button class="remove-btn" data-remove="${ch.id}" title="Remove channel">✕</button>
      </div>
      <div class="live-tag" style="color: ${tagColor}">
          <span class="live-dot" style="${dotStyle}"></span> ${tagText}
      </div>
      <div class="sub-row">
        <span class="sub-count num">${d && d.subs !== null && d.subs !== undefined ? fmt(d.subs) : (d ? 'hidden' : '···')}</span>
        <span class="sub-label">subscribers</span>
      </div>
      <div class="totals">
        <div>Total views<b>${d ? fmt(d.totalViews) : '···'}</b></div>
        <div>Total videos<b>${d ? fmt(d.totalVideos) : '···'}</b></div>
      </div>

      ${windowsTableHtml}
      ${bestVideoHtml}

      <div class="card-notes">
        <div class="notes-display" style="display: ${ch.notes ? 'flex' : 'none'}">
          <span class="notes-text">${safeNote}</span>
          <button class="ghost notes-edit-btn" data-edit-note="${ch.id}">✎</button>
        </div>
        <div class="notes-input-area" style="display: ${ch.notes ? 'none' : 'flex'}">
          <input type="text" class="notes-input" placeholder="Add a note..." value="${safeNote}">
          <button class="primary notes-save-btn" data-save-note="${ch.id}">Save</button>
        </div>
      </div>

      ${milestoneAckHtml}

      <div class="card-footer">
        <span>${d ? 'synced ' + syncedText : 'not synced yet'}</span>
        <button class="refresh-icon-btn" data-retry="${ch.id}" title="Refresh this channel">⟳ refresh</button>
      </div>
      <div class="autorefresh-row">
        <span>Auto-refresh subs every ${currentIntervalText}</span>
        <label class="switch">
          <input type="checkbox" data-autorefresh="${ch.id}" ${ch.autoRefresh ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-remove]').forEach(btn => {
    btn.onclick = () => removeChannel(btn.dataset.remove);
  });
  grid.querySelectorAll('[data-retry]').forEach(btn => {
    btn.onclick = () => {
      if(!hasApiKey()){ openKeyModal(); return; }
      fetchAllDataFor(btn.dataset.retry);
    };
  });
  grid.querySelectorAll('[data-autorefresh]').forEach(box => {
    box.onchange = () => {
      const id = box.dataset.autorefresh;
      const ch = channels.find(c => c.id === id);
      if(!ch) return;
      ch.autoRefresh = box.checked;
      saveChannels();
      if(ch.autoRefresh) startAutoRefresh(id); else stopAutoRefresh(id);
    };
  });
  grid.querySelectorAll('.notes-edit-btn').forEach(btn => {
    if (!btn.dataset.editNote) return;
    btn.onclick = (e) => {
      const wrapper = e.target.closest('.card-notes');
      wrapper.querySelector('.notes-display').style.display = 'none';
      wrapper.querySelector('.notes-input-area').style.display = 'flex';
    };
  });
  grid.querySelectorAll('.notes-save-btn').forEach(btn => {
    if (!btn.dataset.saveNote) return;
    btn.onclick = (e) => {
      const id = e.target.dataset.saveNote;
      const input = e.target.closest('.notes-input-area').querySelector('.notes-input');
      const ch = channels.find(c => c.id === id);
      if(ch) {
        ch.notes = input.value;
        saveChannels();
        renderList();
      }
    };
  });
  grid.querySelectorAll('[data-ack]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.ack;
      const ch = channels.find(c => c.id === id);
      if(ch) {
        ch.milestoneReached = false;
        saveChannels();
        renderList();
      }
    };
  });
}

window.refreshUI = renderList;

wireAddChannelModal();
initCommonPage(renderList);

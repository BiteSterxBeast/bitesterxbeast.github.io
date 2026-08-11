// competitors.js — Competitors page only. Depends on state.js, api.js, ui.js.

const competitorsGrid = document.getElementById('competitorsGrid');
const emptyStateCompetitors = document.getElementById('emptyStateCompetitors');

function renderCompetitors(){
  emptyStateCompetitors.style.display = competitors.length ? 'none' : 'block';
  competitorsGrid.innerHTML = '';

  const compRows = [];
  for (let i = 0; i < competitors.length; i += 3) {
    compRows.push(competitors.slice(i, i + 3));
  }

  compRows.forEach((rowComps, rowIndex) => {
    const rowWrapper = document.createElement('div');
    rowWrapper.className = 'comp-row-wrapper';

    rowComps.forEach(ch => {
      const c = cache[ch.id] || {status:'idle'};
      const itemContainer = document.createElement('div');
      itemContainer.className = 'competitor-item';

      // 1. Build Card
      let cardClasses = 'card';
      if(c.status==='loading') cardClasses += ' loading';
      if(c.status==='error') cardClasses += ' error';
      if(ch.isPinned) cardClasses += ' selected-for-panel';
      if(ch.milestoneReached) cardClasses += ' milestone';

      let cardHtml = '';
      if(c.status === 'error'){
        cardHtml = `
          <div class="${cardClasses}">
            <div class="card-top">
              <div class="avatar"></div>
              <div class="card-title">
                <div class="name"><a href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener noreferrer">${escapeHTML(ch.addedAs)}</a></div>
                <div class="handle">channel ID: ${escapeHTML(ch.id)}</div>
              </div>
              <button class="remove-btn" data-remove-comp="${ch.id}" title="Remove">✕</button>
            </div>
            <div class="error-msg">Couldn't load this channel: ${escapeHTML(c.error)}</div>
            <button class="ghost" data-retry-comp="${ch.id}">Retry</button>
          </div>
        `;
      } else {
        const d = c.data;
        const syncedText = d ? new Date(d.syncedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
        const safeNote = escapeHTML(ch.notes);

        let milestoneAckHtml = '';
        if (ch.milestoneReached) {
          milestoneAckHtml = `
            <div style="margin-top:14px;">
              <button class="primary" style="width:100%; font-size:14px; padding: 12px;" data-ack-comp="${ch.id}">🎉 Acknowledge ${fmt(ch.milestoneValue)} Subs!</button>
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

        cardHtml = `
          <div class="${cardClasses}" draggable="true" data-index="${competitors.indexOf(ch)}">
            <div class="card-top">
              <img class="avatar click-to-pin" data-pin="${ch.id}" src="${d && d.thumb ? d.thumb : ''}" alt="" title="Click to pin to side panel">
              <div class="card-title">
                <div class="name click-to-pin" data-pin="${ch.id}" title="Click to pin to side panel">
                  <a href="https://www.youtube.com/channel/${ch.id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHTML(d ? d.title : ch.addedAs)}</a>
                </div>
                <div class="handle">${escapeHTML(d && d.handle ? d.handle : ch.addedAs)}</div>
              </div>
              <button class="remove-btn" data-remove-comp="${ch.id}" title="Remove competitor">✕</button>
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

            <div class="card-notes">
              <div class="notes-display" style="display: ${ch.notes ? 'flex' : 'none'}">
                <span class="notes-text">${safeNote}</span>
                <button class="ghost notes-edit-btn" data-edit-note-comp="${ch.id}">✎</button>
              </div>
              <div class="notes-input-area" style="display: ${ch.notes ? 'none' : 'flex'}">
                <input type="text" class="notes-input" placeholder="Add a note..." value="${safeNote}">
                <button class="primary notes-save-btn" data-save-note-comp="${ch.id}">Save</button>
              </div>
            </div>

            ${milestoneAckHtml}

            <div class="card-footer">
              <span>${d ? 'synced ' + syncedText : 'not synced yet'}</span>
              <button class="refresh-icon-btn" data-retry-comp="${ch.id}" title="Refresh this channel">⟳ refresh</button>
            </div>
          </div>
        `;
      }

      // 2. Build Video Panel with Arrow Toggles
      const d = c.data;
      let vidHtml = '';

      if (!ch.vidView) ch.vidView = 'best';

      if (d && (d.bestVideo || d.newestVideo)) {
         let targetVid = null;
         let headerTitle = '';
         let showLeft = false;
         let showRight = false;

         if (ch.vidView === 'best') {
           targetVid = d.bestVideo || d.newestVideo;
           headerTitle = '🔥 Best Performing (7d)';
           showRight = true;
         } else {
           targetVid = d.newestVideo || d.bestVideo;
           headerTitle = '✨ Newest Upload';
           showLeft = true;
         }

         let contentHtml = '';
         if (targetVid) {
           const dateStr = targetVid.publishedAt ? new Date(targetVid.publishedAt).toLocaleDateString() : 'Unknown';
           contentHtml = `
               <a href="https://www.youtube.com/watch?v=${targetVid.id}" target="_blank">
                 <img class="comp-vid-thumb" src="${targetVid.thumb || ''}" alt="">
               </a>
               <div class="comp-vid-title">
                 <a href="https://www.youtube.com/watch?v=${targetVid.id}" target="_blank">
                   ${escapeHTML(targetVid.title)}
                 </a>
               </div>
               <div class="comp-vid-meta">
                 <div>Views<span>${fmt(targetVid.views)}</span></div>
                 <div>VPH<span>${fmtVph(targetVid.vph, targetVid.publishedAt)}</span></div>
                 <div>Date<span>${dateStr}</span></div>
               </div>
           `;
         } else {
           contentHtml = `
             <div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--muted); text-align:center;">
               No video found for this category.
             </div>
           `;
         }

         vidHtml = `
            <div class="competitor-video-panel">
               <div class="comp-vid-header-row">
                 <button class="comp-vid-arrow ${showLeft ? '' : 'invisible'}" data-vid-toggle="${ch.id}" data-view="best" title="Best Performing">‹</button>
                 <h3 class="comp-vid-header">${headerTitle}</h3>
                 <button class="comp-vid-arrow ${showRight ? '' : 'invisible'}" data-vid-toggle="${ch.id}" data-view="newest" title="Newest Upload">›</button>
               </div>
               ${contentHtml}
            </div>
         `;
      } else {
         vidHtml = `
            <div class="competitor-video-panel" style="justify-content:center; align-items:center; color:var(--muted);">
               No recent video data available.
            </div>
         `;
      }

      itemContainer.innerHTML = cardHtml + `<div class="competitor-connector">⋮</div>` + vidHtml;

      const compCard = itemContainer.querySelector('.card');
      if (compCard) {
        compCard.addEventListener('dragstart', handleDragStart);
        compCard.addEventListener('dragover', handleDragOver);
        compCard.addEventListener('dragenter', handleDragEnter);
        compCard.addEventListener('dragleave', handleDragLeave);
        compCard.addEventListener('drop', handleDrop);
        compCard.addEventListener('dragend', handleDragEnd);
      }

      rowWrapper.appendChild(itemContainer);
    });

    competitorsGrid.appendChild(rowWrapper);

    if (rowIndex < compRows.length - 1) {
      const hr = document.createElement('hr');
      hr.className = 'comp-separator';
      competitorsGrid.appendChild(hr);
    }
  });

  competitorsGrid.querySelectorAll('.click-to-pin').forEach(el => {
    el.onclick = (e) => {
      if (e.target.tagName === 'A') return;
      e.preventDefault();
      togglePin(el.dataset.pin);
    };
  });
  competitorsGrid.querySelectorAll('[data-remove-comp]').forEach(btn => {
    btn.onclick = () => removeCompetitor(btn.dataset.removeComp);
  });
  competitorsGrid.querySelectorAll('[data-retry-comp]').forEach(btn => {
    btn.onclick = () => {
      if(!hasApiKey()){ openKeyModal(); return; }
      fetchAllDataFor(btn.dataset.retryComp, true);
    };
  });
  competitorsGrid.querySelectorAll('.notes-edit-btn').forEach(btn => {
    if (!btn.dataset.editNoteComp) return;
    btn.onclick = (e) => {
      const wrapper = e.target.closest('.card-notes');
      wrapper.querySelector('.notes-display').style.display = 'none';
      wrapper.querySelector('.notes-input-area').style.display = 'flex';
    };
  });
  competitorsGrid.querySelectorAll('.notes-save-btn').forEach(btn => {
    if (!btn.dataset.saveNoteComp) return;
    btn.onclick = (e) => {
      const id = e.target.dataset.saveNoteComp;
      const input = e.target.closest('.notes-input-area').querySelector('.notes-input');
      const ch = competitors.find(c => c.id === id);
      if(ch) {
        ch.notes = input.value;
        saveCompetitors();
        renderCompetitors();
      }
    };
  });
  competitorsGrid.querySelectorAll('.comp-vid-arrow').forEach(btn => {
    btn.onclick = (e) => {
      const id = btn.dataset.vidToggle;
      const view = btn.dataset.view;
      const comp = competitors.find(c => c.id === id);
      if(comp) {
        comp.vidView = view;
        saveCompetitors();
        renderCompetitors();
      }
    };
  });
  competitorsGrid.querySelectorAll('[data-ack-comp]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.ackComp;
      const ch = competitors.find(c => c.id === id);
      if(ch) {
        ch.milestoneReached = false;
        saveCompetitors();
        renderCompetitors();
      }
    };
  });
}

window.refreshUI = renderCompetitors;

wireAddCompetitorModal();
initCommonPage(renderCompetitors);

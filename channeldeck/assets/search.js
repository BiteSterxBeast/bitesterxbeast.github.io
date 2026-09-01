// search.js — Search page only. Depends on state.js, api.js, ui.js.
//
// Quota model this page is built around:
//   search.list  = 100 units per call   (the expensive one)
//   videos.list  = 1 unit per call      (up to 50 ids at once)
//
// So a single "Search" press costs ~101 units out of a 10,000/day key. To get
// the most out of that, every search pulls the API's full 50-result page in one
// go and keeps it in a local pool. "Show me more" then reveals 10 more results
// from that pool for FREE, and only spends another ~101 units once the pool is
// actually exhausted. Local-only filters (content type, minimum views, live
// stream exclusion) re-filter that same pool instantly without touching the API
// at all — only the filters YouTube itself has to apply (sort order, time range,
// region, language) require a fresh paid search.

window.CD_PAGE = 'search';

const SEARCH_COST = 100;   // search.list
const DETAIL_COST = 1;     // videos.list
const REVEAL_SIZE = 10;    // results revealed per "Show me more"
const FETCH_SIZE  = 50;    // results pulled from the API per paid search
const SHORT_MAX_SECONDS = 180; // YouTube Shorts cap out at 3 minutes

// Width used when asking the API for the embed player markup. The returned
// height is derived from the video's real aspect ratio, which is how
// orientation gets detected — see classifyShort() below.
const PLAYER_PROBE_WIDTH = 500;

// --- DOM refs ---
const searchInput      = document.getElementById('searchInput');
const tagInput         = document.getElementById('tagInput');
const tagChips         = document.getElementById('tagChips');
const searchBtn        = document.getElementById('searchBtn');
const searchResults    = document.getElementById('searchResults');
const searchStatus     = document.getElementById('searchStatus');
const searchEmpty      = document.getElementById('searchEmpty');
const showMoreWrap     = document.getElementById('showMoreWrap');
const showMoreBtn      = document.getElementById('showMoreBtn');
const showMoreNote     = document.getElementById('showMoreNote');
const filtersToggle    = document.getElementById('filtersToggle');
const filtersPanel     = document.getElementById('filtersPanel');
const filtersDirtyNote = document.getElementById('filtersDirtyNote');
const quotaMeter       = document.getElementById('quotaMeter');
const resetFiltersBtn  = document.getElementById('resetFiltersBtn');

const fOrder    = document.getElementById('fOrder');
const fTime     = document.getElementById('fTime');
const fType     = document.getElementById('fType');
const fMinViews = document.getElementById('fMinViews');
const fRegion   = document.getElementById('fRegion');
const fLanguage = document.getElementById('fLanguage');
const fNoLive   = document.getElementById('fNoLive');

const quotaOverlay  = document.getElementById('quotaOverlay');
const quotaCancel   = document.getElementById('quotaCancel');
const quotaConfirm  = document.getElementById('quotaConfirm');
const quotaDontShow = document.getElementById('quotaDontShow');

// --- Persisted search state ---
const DEFAULT_FILTERS = {
  order: 'viewCount',
  time: 'any',
  type: 'both',
  minViews: 0,
  region: 'any',
  language: 'any',
  noLive: true
};

// Filters YouTube applies server-side. Changing any of these means the current
// pool is stale and a new paid search is required.
const API_FILTERS = ['order', 'time', 'region', 'language'];

let searchFilters = { ...DEFAULT_FILTERS };
let searchTags = [];
let pool = [];             // every result fetched so far, in display order
let seenIds = new Set();   // dedupe across pages
let shownCount = 0;        // how many of the filtered pool are on screen
let nextPageToken = null;
let filtersDirty = false;
let searching = false;
let lastRunQuery = '';

function saveSearchFilters(){
  try { localStorage.setItem('channelDeck_searchFilters', JSON.stringify(searchFilters)); } catch(e){}
}
function saveSearchTags(){
  try { localStorage.setItem('channelDeck_searchTags', JSON.stringify(searchTags)); } catch(e){}
}
function loadSearchState(){
  try {
    const f = localStorage.getItem('channelDeck_searchFilters');
    if (f) searchFilters = Object.assign({ ...DEFAULT_FILTERS }, JSON.parse(f));
  } catch(e){}

  try {
    const t = localStorage.getItem('channelDeck_searchTags');
    if (t) {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) searchTags = parsed.filter(x => typeof x === 'string');
    }
  } catch(e){}

}

// --- Tag chips ---
// Tags are just query fragments. A tag typed with a leading "-" becomes an
// exclusion, and a tag containing spaces is quoted so YouTube treats it as one
// exact phrase instead of loose words.
function renderTags(){
  tagChips.innerHTML = '';
  searchTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    const isExclude = tag.startsWith('-');
    chip.className = 'tag-chip' + (isExclude ? ' exclude' : '');
    chip.innerHTML = `<span>${escapeHTML(tag)}</span><button class="tag-chip-x" data-tag-remove="${i}" title="Remove tag" aria-label="Remove tag ${escapeHTML(tag)}">✕</button>`;
    tagChips.appendChild(chip);
  });
  tagChips.style.display = searchTags.length ? 'flex' : 'none';

  tagChips.querySelectorAll('[data-tag-remove]').forEach(btn => {
    btn.onclick = () => {
      searchTags.splice(Number(btn.dataset.tagRemove), 1);
      saveSearchTags();
      renderTags();
      markFiltersDirty();
    };
  });
}

function addTagsFromInput(){
  const raw = tagInput.value;
  if (!raw.trim()) return;
  raw.split(',').forEach(part => {
    const tag = part.trim();
    if (!tag) return;
    if (tag === '-' ) return;
    if (searchTags.some(t => t.toLowerCase() === tag.toLowerCase())) return;
    if (searchTags.length >= 12) return;
    searchTags.push(tag);
  });
  tagInput.value = '';
  saveSearchTags();
  renderTags();
  markFiltersDirty();
}

function buildQuery(){
  const parts = [];
  const base = searchInput.value.trim();
  if (base) parts.push(base);
  searchTags.forEach(tag => {
    if (tag.startsWith('-')) {
      const body = tag.slice(1).trim();
      if (!body) return;
      parts.push(body.includes(' ') ? `-"${body}"` : `-${body}`);
    } else {
      parts.push(tag.includes(' ') ? `"${tag}"` : tag);
    }
  });
  return parts.join(' ').trim();
}

// --- Filters ---
function readFiltersFromUI(){
  searchFilters.order    = fOrder.value;
  searchFilters.time     = fTime.value;
  searchFilters.type     = fType.value;
  searchFilters.minViews = Number(fMinViews.value) || 0;
  searchFilters.region   = fRegion.value;
  searchFilters.language = fLanguage.value;
  searchFilters.noLive   = fNoLive.checked;
  saveSearchFilters();
}

function writeFiltersToUI(){
  fOrder.value    = searchFilters.order;
  fTime.value     = searchFilters.time;
  fType.value     = searchFilters.type;
  fMinViews.value = String(searchFilters.minViews);
  fRegion.value   = searchFilters.region;
  fLanguage.value = searchFilters.language;
  fNoLive.checked = searchFilters.noLive !== false;
}

function markFiltersDirty(){
  if (!pool.length) return;
  filtersDirty = true;
  filtersDirtyNote.style.display = 'block';
  searchBtn.classList.add('needs-rerun');
}

function clearFiltersDirty(){
  filtersDirty = false;
  filtersDirtyNote.style.display = 'none';
  searchBtn.classList.remove('needs-rerun');
}

// --- Helpers ---
// The Data API has no "this is a Short" flag, so duration alone can't tell a
// Short from a regular two-minute upload — that's what made short long-form
// videos leak into the Shorts filter. Orientation is the missing signal:
// Shorts are vertical (or square), regular uploads are landscape.
//
// Asking videos.list for the `player` part returns the embed iframe markup,
// and its width/height reflect the video's actual aspect ratio rather than a
// fixed 16:9 box. Parsing those two numbers gives us orientation for free —
// videos.list still costs a flat 1 unit no matter how many parts are requested.
function parsePlayerAspect(player){
  if (!player || !player.embedHtml) return null;
  const w = /width\s*=\s*["'](\d+)["']/i.exec(player.embedHtml);
  const h = /height\s*=\s*["'](\d+)["']/i.exec(player.embedHtml);
  if (!w || !h) return null;
  const width = Number(w[1]), height = Number(h[1]);
  if (!width || !height) return null;
  return { width, height };
}

// Returns true only when a video is genuinely a Short: short enough AND
// vertical. A 2-minute landscape video now correctly reads as long-form.
//
// If the aspect ratio is unavailable for some reason, this falls back to the
// old duration-only guess rather than dropping the video entirely — but that
// path should effectively never run, since every search requests the player
// part. `aspectKnown` records which path was taken so the UI can be honest
// about it.
function classifyShort(duration, aspect){
  if (!duration || duration > SHORT_MAX_SECONDS) {
    return { isShort: false, aspectKnown: !!aspect };
  }
  if (aspect) {
    // Portrait or square counts as a Short; landscape does not.
    return { isShort: aspect.height >= aspect.width, aspectKnown: true };
  }
  return { isShort: true, aspectKnown: false };
}

// Spells out why a video landed in the bucket it did, so a wrong call is
// possible to spot rather than being a black box.
function badgeTitle(r){
  const dur = fmtDuration(r.duration);
  if (!r.aspectKnown) {
    return `Orientation unavailable — classified by duration alone (${dur}), so this one may be wrong.`;
  }
  const orient = r.aspect
    ? (r.aspect.height > r.aspect.width ? 'vertical'
      : r.aspect.height === r.aspect.width ? 'square' : 'landscape')
    : 'unknown';
  if (r.isShort) return `Short: ${dur} and ${orient}.`;
  if (r.duration > SHORT_MAX_SECONDS) return `Long-form: ${dur}, over the 3-minute Shorts limit.`;
  return `Long-form: ${dur} but ${orient}, so it is a regular upload rather than a Short.`;
}

function parseISODuration(iso){
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (Number(m[1]) || 0) * 86400
       + (Number(m[2]) || 0) * 3600
       + (Number(m[3]) || 0) * 60
       + (Number(m[4]) || 0);
}

function fmtDuration(sec){
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function timeAgo(iso){
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff) || diff < 0) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const TIME_RANGE_DAYS = {
  any: null, '1': 1, '7': 7, '30': 30, '90': 90, '365': 365
};

// Local-only filters. These never trigger an API call — they just narrow the
// pool that's already been paid for.
function passesLocalFilters(r){
  if (searchFilters.type === 'short' && !r.isShort) return false;
  if (searchFilters.type === 'long'  && r.isShort) return false;
  if (searchFilters.minViews && r.views < searchFilters.minViews) return false;
  if (searchFilters.noLive !== false && r.isLive) return false;
  return true;
}

function filteredPool(){
  return pool.filter(passesLocalFilters);
}

// --- Rendering ---
function renderResults(){
  const results = filteredPool();

  if (!results.length) {
    searchResults.innerHTML = '';
    showMoreWrap.style.display = 'none';
    if (pool.length) {
      searchEmpty.style.display = 'block';
      searchEmpty.innerHTML = `
        <h2>Nothing matched your filters</h2>
        <p>${pool.length} result${pool.length === 1 ? '' : 's'} came back, but the content type / minimum views filters ruled them all out. Loosening those is free — it won't cost any quota.</p>`;
    } else {
      searchEmpty.style.display = 'none';
    }
    return;
  }

  searchEmpty.style.display = 'none';
  const visible = results.slice(0, Math.max(REVEAL_SIZE, shownCount));

  // Clamp the counter to what's actually on screen. Without this it can drift
  // ahead of the list whenever a local filter shrinks the pool, and the next
  // "show me more" would then reveal more than 10 rows at once.
  shownCount = visible.length;

  searchResults.innerHTML = visible.map((r, i) => {
    const tracked = competitors.some(c => c.id === r.channelId);
    return `
      <div class="search-result">
        <div class="search-rank num">${i + 1}</div>
        <a class="search-thumb" href="https://www.youtube.com/watch?v=${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">
          <img src="${escapeHTML(r.thumb)}" alt="" loading="lazy">
          <span class="search-dur num">${fmtDuration(r.duration)}</span>
        </a>
        <div class="search-body">
          <div class="search-title">
            <a href="https://www.youtube.com/watch?v=${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">${escapeHTML(r.title)}</a>
          </div>
          <div class="search-channel">
            <a href="https://www.youtube.com/channel/${encodeURIComponent(r.channelId)}" target="_blank" rel="noopener noreferrer">${escapeHTML(r.channelTitle)}</a>
          </div>
          <div class="search-meta">
            <span class="num">${fmt(r.views)} views</span>
            <span class="num">${fmt(r.likes)} likes</span>
            <span class="num">${fmt(r.comments)} comments</span>
            <span>${escapeHTML(timeAgo(r.publishedAt))}</span>
            <span class="badge ${r.isShort ? 'short' : 'long'}${r.aspectKnown ? '' : ' guessed'}" title="${escapeHTML(badgeTitle(r))}">${r.isShort ? 'Short' : 'Long-form'}${r.aspectKnown ? '' : '?'}</span>
            ${r.isLive ? '<span class="badge live">Live</span>' : ''}
          </div>
        </div>
        <div class="search-actions">
          <button class="ghost search-track-btn" data-track="${escapeHTML(r.channelId)}" data-track-name="${escapeHTML(r.channelTitle)}" ${tracked ? 'disabled' : ''}>
            ${tracked ? '✓ Tracked' : '+ Competitor'}
          </button>
        </div>
      </div>`;
  }).join('');

  searchResults.querySelectorAll('[data-track]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.track;
      if (competitors.some(c => c.id === id)) return;
      btn.disabled = true;
      btn.textContent = 'Adding…';
      competitors.push({
        id,
        addedAs: btn.dataset.trackName || id,
        notes: '',
        vidView: 'best',
        milestoneReached: false,
        isPinned: false
      });
      saveCompetitors();
      try {
        await fetchAllDataFor(id, true);
      } catch(e){}
      renderResults();
    };
  });

  // "Show me more" is free while there are already-paid-for results sitting in
  // the pool, and only costs quota once that pool runs dry.
  const hasLocalMore = results.length > shownCount;
  if (hasLocalMore) {
    showMoreWrap.style.display = 'block';
    showMoreBtn.textContent = 'Show me more';
    showMoreBtn.disabled = false;
    showMoreNote.textContent = `${results.length - shownCount} more already loaded — free, no quota used.`;
  } else if (nextPageToken) {
    showMoreWrap.style.display = 'block';
    showMoreBtn.textContent = 'Load more from YouTube';
    showMoreBtn.disabled = false;
    showMoreNote.textContent = `Out of loaded results. Fetching the next page costs about ${SEARCH_COST + DETAIL_COST} quota units.`;
  } else {
    showMoreWrap.style.display = 'block';
    showMoreBtn.textContent = 'No more results';
    showMoreBtn.disabled = true;
    showMoreNote.textContent = 'YouTube has no further pages for this query.';
  }
}

function setStatus(html, tone){
  if (!html) { searchStatus.style.display = 'none'; return; }
  searchStatus.style.display = 'block';
  searchStatus.className = 'search-status' + (tone ? ' ' + tone : '');
  searchStatus.innerHTML = html;
}

// --- The actual search ---
async function executeSearch(append){
  if (searching) return;

  const q = buildQuery();
  if (!q) {
    setStatus('Type a search term, or add at least one tag, before searching.', 'error');
    return;
  }
  if (!hasApiKey()) { openKeyModal(); return; }

  searching = true;
  searchBtn.disabled = true;
  showMoreBtn.disabled = true;
  setStatus('Searching YouTube…', 'busy');

  if (!append) {
    pool = [];
    seenIds = new Set();
    shownCount = 0;
    nextPageToken = null;
    searchResults.innerHTML = '';
    showMoreWrap.style.display = 'none';
    searchEmpty.style.display = 'none';
    lastRunQuery = q;
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: String(FETCH_SIZE),
      order: searchFilters.order,
      q
    });

    const days = TIME_RANGE_DAYS[searchFilters.time];
    if (days) params.set('publishedAfter', new Date(Date.now() - days * 86400000).toISOString());
    if (searchFilters.region !== 'any') params.set('regionCode', searchFilters.region);
    if (searchFilters.language !== 'any') params.set('relevanceLanguage', searchFilters.language);
    if (append && nextPageToken) params.set('pageToken', nextPageToken);

    const data = await fetchWithFallback(key =>
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}&key=${key}`);
    nextPageToken = data.nextPageToken || null;

    const ids = (data.items || [])
      .map(i => i.id && i.id.videoId)
      .filter(id => id && !seenIds.has(id));

    if (ids.length) {
      const det = await fetchWithFallback(key =>
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,player&id=${ids.join(',')}&maxWidth=${PLAYER_PROBE_WIDTH}&key=${key}`);
      const fresh = (det.items || []).map(v => {
        const t = v.snippet.thumbnails || {};
        const thumb = (t.maxres && t.maxres.url) || (t.high && t.high.url)
                   || (t.medium && t.medium.url) || (t.default && t.default.url) || '';
        const duration = parseISODuration(v.contentDetails && v.contentDetails.duration);
        const aspect = parsePlayerAspect(v.player);
        const cls = classifyShort(duration, aspect);
        return {
          id: v.id,
          title: v.snippet.title,
          channelId: v.snippet.channelId,
          channelTitle: v.snippet.channelTitle,
          publishedAt: v.snippet.publishedAt,
          thumb,
          duration,
          isShort: cls.isShort,
          aspectKnown: cls.aspectKnown,
          aspect,
          isLive: v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none',
          views: Number(v.statistics.viewCount || 0),
          likes: v.statistics.likeCount === undefined ? null : Number(v.statistics.likeCount),
          comments: v.statistics.commentCount === undefined ? null : Number(v.statistics.commentCount)
        };
      });

      fresh.forEach(r => seenIds.add(r.id));

      // videos.list doesn't preserve the search's ranking, so re-apply the
      // chosen sort to just the newly-arrived batch. Already-visible results
      // keep their position instead of reshuffling under the reader.
      if (searchFilters.order === 'viewCount')  fresh.sort((a, b) => b.views - a.views);
      else if (searchFilters.order === 'date')  fresh.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      pool = pool.concat(fresh);
    }

    clearFiltersDirty();
    shownCount = Math.min(filteredPool().length, (append ? shownCount : 0) + REVEAL_SIZE);

    const total = filteredPool().length;
    if (!total && !pool.length) {
      searchEmpty.style.display = 'block';
      searchEmpty.innerHTML = `<h2>No results</h2><p>YouTube returned nothing for <b>${escapeHTML(q)}</b>. Try broader wording or fewer tags.</p>`;
      setStatus('', '');
    } else {
      setStatus(`Searched for <b>${escapeHTML(q)}</b> — ${pool.length} result${pool.length === 1 ? '' : 's'} loaded, ${total} matching your filters.`, 'ok');
    }
    renderResults();

  } catch(e) {
    setStatus(`Search failed: ${escapeHTML(e.message || 'Something went wrong.')}`, 'error');
    // Re-render so a failed "load more" leaves the already-loaded results and
    // their button in a usable state rather than stuck on disabled.
    if (pool.length) renderResults();
  } finally {
    searching = false;
    searchBtn.disabled = false;
  }
}

// --- Quota warning gate ---
// Shown once per browser, the first time a search is run. Consent is stored in
// localStorage so it never nags after that.
let pendingSearchAction = null;

function hasBeenWarned(){
  try { return localStorage.getItem('channelDeck_searchQuotaWarned') === '1'; }
  catch(e){ return false; }
}

function requestSearch(append){
  if (hasBeenWarned()) { executeSearch(append); return; }
  pendingSearchAction = append;
  quotaDontShow.checked = false;
  quotaOverlay.style.display = 'flex';
}

quotaCancel.onclick = () => {
  quotaOverlay.style.display = 'none';
  pendingSearchAction = null;
};

quotaConfirm.onclick = () => {
  if (quotaDontShow.checked) {
    try { localStorage.setItem('channelDeck_searchQuotaWarned', '1'); } catch(e){}
  }
  quotaOverlay.style.display = 'none';
  const append = pendingSearchAction;
  pendingSearchAction = null;
  executeSearch(append);
};

quotaOverlay.addEventListener('click', e => {
  if (e.target === quotaOverlay) { quotaOverlay.style.display = 'none'; pendingSearchAction = null; }
});

// --- Wiring ---
searchBtn.onclick = () => requestSearch(false);

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') requestSearch(false);
});
searchInput.addEventListener('input', markFiltersDirty);

tagInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTagsFromInput();
  } else if (e.key === 'Backspace' && !tagInput.value && searchTags.length) {
    searchTags.pop();
    saveSearchTags();
    renderTags();
    markFiltersDirty();
  }
});
tagInput.addEventListener('blur', addTagsFromInput);

showMoreBtn.onclick = () => {
  const results = filteredPool();
  if (results.length > shownCount) {
    // Free reveal — these are already in the pool.
    shownCount += REVEAL_SIZE;
    renderResults();
  } else if (nextPageToken) {
    requestSearch(true);
  }
};

filtersToggle.onclick = () => {
  const open = filtersPanel.style.display !== 'none';
  filtersPanel.style.display = open ? 'none' : 'grid';
  filtersToggle.textContent = open ? 'Filters ▾' : 'Filters ▴';
};

[fOrder, fTime, fType, fMinViews, fRegion, fLanguage, fNoLive].forEach(el => {
  el.addEventListener('change', () => {
    const before = { ...searchFilters };
    readFiltersFromUI();
    // Only the server-side filters invalidate the pool. Everything else
    // re-renders instantly at zero cost.
    const needsRefetch = API_FILTERS.some(k => before[k] !== searchFilters[k]);
    if (needsRefetch) {
      markFiltersDirty();
    } else {
      renderResults();
    }
  });
});

resetFiltersBtn.onclick = () => {
  searchFilters = { ...DEFAULT_FILTERS };
  saveSearchFilters();
  writeFiltersToUI();
  markFiltersDirty();
  renderResults();
};

// --- Boot ---
// Deliberately does NOT kick off refreshAll(): landing on the Search page
// shouldn't silently spend quota on channel refreshes before the reader has
// searched for anything.
window.refreshUI = () => {};

loadSearchState();
writeFiltersToUI();
renderTags();
initCommonPage(null, { autoRefresh: false });
searchInput.focus();

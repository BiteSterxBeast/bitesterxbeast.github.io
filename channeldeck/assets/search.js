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

// --- Creators mode ---
// Up to three seed creators. One is the sweet spot: the profile stays tight and
// recognisably that creator's niche. Adding more broadens it, because a term
// only survives if it's shared, so three very different creators produce a
// vague profile rather than a richer one.
const MAX_CREATORS = 3;
const PROFILE_VIDEOS_PER_CREATOR = 15; // recent uploads sampled per creator
const PROFILE_TERM_COUNT = 5;          // derived terms fed into the query

// Words that say nothing about a creator's niche. Without this the profile
// fills up with "the", "video", "new", "official" and matches everything.
const PROFILE_STOPWORDS = new Set(('a об the and or but if then than that this these those there here what which who whom whose when where why how all any both each few more most other some such no nor not only own same so too very can will just don should now i me my we our you your he him his she her it its they them their am is are was were be been being have has had having do does did doing would could shall may might must of at by for with about against between into through during before after above below to from up down in out on off over under again further once video videos new official full hd 4k part ep episode vs feat ft featuring the best top get make made makes making how why what when who does did you your my our this that with without like just really very more most all every some any thing things stuff really actually literally basically going gonna want wanted need needed let lets going im ive dont doesnt didnt cant wont isnt arent wasnt werent one two three first last next final live stream vlog shorts short subscribe channel watch watching').split(' '));

// The four search modes. They differ in which bars feed the query:
//   search_tags — main term AND tags, tags expanded to similar ones
//   search_only — main term alone, tag bar hidden
//   tags_only   — tags alone, expanded to similar ones, main box hidden
//   creators    — model up to three creators and find others like them
const MODES = [
  { id: 'search_tags', label: 'Search + Tags' },
  { id: 'search_only', label: 'Search' },
  { id: 'tags_only',   label: 'Tags' },
  { id: 'creators',    label: 'Creators' }
];

function modeUsesSearchBox(m){ return m !== 'tags_only'; }
function modeUsesSecondBar(m){ return m !== 'search_only'; }
function modeIsCreators(m){ return m === 'creators'; }
// Tag expansion only makes sense where the user actually supplied tags.
function modeCanExpandTags(m){ return m === 'search_tags' || m === 'tags_only'; }

let searchMode = 'search_tags';

// Tags harvested from the first page of results, used to widen the search to
// videos carrying similar tags rather than only the exact ones typed.
let relatedTags = null;

// Each paid search.list call the current query fans out into. Tag expansion
// produces two: one for the exact tags, one for the similar ones. "Show me
// more" pages whichever still has results left.
let searchSources = [];
let searchCreators = [];       // raw strings the user typed
let creatorResolveCache = {};  // raw -> {id, title} (avoids paying to resolve twice)
let creatorProfile = null;     // derived style profile, reused while paging

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
const modeSwitch       = document.getElementById('modeSwitch');
const modeHint         = document.getElementById('modeHint');
const tagField         = document.getElementById('tagField');
const creatorProfileEl = document.getElementById('creatorProfile');
const searchRow        = document.getElementById('searchRow');
const tagRow           = document.getElementById('tagRow');
const fExpandTags      = document.getElementById('fExpandTags');

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
  noLive: true,
  expandTags: true
};

// Filters YouTube applies server-side. Changing any of these means the current
// pool is stale and a new paid search is required.
const API_FILTERS = ['order', 'time', 'region', 'language', 'expandTags'];

let searchFilters = { ...DEFAULT_FILTERS };
let searchTags = [];
let pool = [];             // every result fetched so far, in display order
let seenIds = new Set();   // dedupe across pages
let shownCount = 0;        // how many of the filtered pool are on screen
let filtersDirty = false;
let searching = false;
let lastRunQuery = '';

function saveSearchFilters(){
  try { localStorage.setItem('channelDeck_searchFilters', JSON.stringify(searchFilters)); } catch(e){}
}
function saveSearchTags(){
  try { localStorage.setItem('channelDeck_searchTags', JSON.stringify(searchTags)); } catch(e){}
}
function saveSearchCreators(){
  try { localStorage.setItem('channelDeck_searchCreators', JSON.stringify(searchCreators)); } catch(e){}
}
function saveSearchMode(){
  try { localStorage.setItem('channelDeck_searchMode', searchMode); } catch(e){}
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

  try {
    const c = localStorage.getItem('channelDeck_searchCreators');
    if (c) {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) searchCreators = parsed.filter(x => typeof x === 'string').slice(0, MAX_CREATORS);
    }
  } catch(e){}

  try {
    const m = localStorage.getItem('channelDeck_searchMode');
    // 'tags' was the old combined term-plus-tags mode, which is now
    // 'search_tags'. The new 'tags_only' is a different thing.
    if (m === 'tags') searchMode = 'search_tags';
    else if (MODES.some(x => x.id === m)) searchMode = m;
  } catch(e){}

}

// --- Tag chips ---
// Tags are just query fragments. A tag typed with a leading "-" becomes an
// exclusion, and a tag containing spaces is quoted so YouTube treats it as one
// exact phrase instead of loose words.
// The second bar renders either tags or creators depending on the mode switch.
// Both lists are kept in storage, so flipping between modes doesn't lose what
// was typed in the other one.
function renderTags(){
  const items = modeIsCreators(searchMode) ? searchCreators : searchTags;
  tagChips.innerHTML = '';

  items.forEach((val, i) => {
    const chip = document.createElement('span');
    if (modeIsCreators(searchMode)) {
      const pricey = !isCheapCreatorLookup(val);
      chip.className = 'tag-chip creator' + (pricey ? ' pricey' : '');
      chip.title = pricey
        ? 'A bare name has no cheap lookup, so resolving this costs about 100 extra quota units. An @handle or channel URL costs 1.'
        : 'Resolves for 1 quota unit.';
    } else {
      chip.className = 'tag-chip' + (val.startsWith('-') ? ' exclude' : '');
    }
    chip.innerHTML = `<span>${escapeHTML(val)}</span><button class="tag-chip-x" data-tag-remove="${i}" title="Remove" aria-label="Remove ${escapeHTML(val)}">✕</button>`;
    tagChips.appendChild(chip);
  });

  tagChips.style.display = items.length ? 'flex' : 'none';

  tagChips.querySelectorAll('[data-tag-remove]').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.tagRemove);
      if (modeIsCreators(searchMode)) {
        searchCreators.splice(idx, 1);
        saveSearchCreators();
        creatorProfile = null;           // profile no longer matches the seeds
        renderCreatorProfile();
      } else {
        searchTags.splice(idx, 1);
        saveSearchTags();
      }
      renderTags();
      renderModeUI();
      markFiltersDirty();
    };
  });
}

// Which bars are shown, what they're labelled, and the explanatory hint all
// follow the selected mode.
function renderModeUI(){
  modeSwitch.querySelectorAll('.mode-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === searchMode);
  });

  searchRow.style.display = modeUsesSearchBox(searchMode) ? 'flex' : 'none';
  tagRow.style.display    = modeUsesSecondBar(searchMode) ? 'flex' : 'none';
  tagField.classList.toggle('creators-mode', modeIsCreators(searchMode));

  if (modeIsCreators(searchMode)) {
    const full = searchCreators.length >= MAX_CREATORS;
    searchInput.placeholder = 'Optional — narrow to a subject within their niche';
    tagInput.placeholder = full
      ? `Maximum ${MAX_CREATORS} creators — remove one to add another.`
      : '@handle, channel URL or name — press Enter after each.';
    tagInput.disabled = full;
    modeHint.innerHTML = `Finds other creators making content like these. One creator gives the sharpest results; adding more widens the net, since only traits they <b>share</b> survive. Videos from the seeds themselves are excluded. Use an @handle or URL — a bare name costs ~100 extra units to look up.`;
  } else {
    searchInput.placeholder = 'Search a word or term…';
    tagInput.placeholder = 'Tags — press Enter after each. Prefix with “-” to exclude.';
    tagInput.disabled = false;

    if (searchMode === 'search_only') {
      modeHint.innerHTML = `Plain search on the term above. Tags are ignored in this mode, so nothing is widened and a search costs about <b>${SEARCH_COST + DETAIL_COST}</b> quota units.`;
    } else if (searchMode === 'tags_only') {
      modeHint.innerHTML = `Searches by tags alone. Results carry the tags you type, and with <b>Widen to similar tags</b> on it also pulls videos tagged with terms that appear alongside yours.`;
    } else {
      modeHint.innerHTML = `Term and tags together — tags narrow the term above. Prefix a tag with <b>-</b> to exclude it, and multi-word tags are matched as exact phrases.`;
    }
  }
  modeHint.style.display = 'block';
}

function addTagsFromInput(){
  const raw = tagInput.value;
  if (!raw.trim()) return;

  if (modeIsCreators(searchMode)) {
    let rejected = false;
    raw.split(',').forEach(part => {
      const name = part.trim();
      if (!name) return;
      if (searchCreators.some(c => c.toLowerCase() === name.toLowerCase())) return;
      if (searchCreators.length >= MAX_CREATORS) { rejected = true; return; }
      searchCreators.push(name);
    });
    tagInput.value = '';
    saveSearchCreators();
    creatorProfile = null;
    renderCreatorProfile();
    renderTags();
    renderModeUI();
    markFiltersDirty();
    if (rejected) setStatus(`You can search up to ${MAX_CREATORS} creators at once. Remove one to add another.`, 'error');
    return;
  }

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


// --- Tag expansion ---
// Same idea as creator profiling, applied to tags instead of channels: read the
// tags that real videos carry and use them to widen the net.
//
// When a search runs on tags, the first page of results is already paid for and
// every one of those videos carries its own tag list. Harvesting those gives a
// set of tags that co-occur with what was typed — "sourdough" surfaces "artisan
// bread", "baking", "no knead". Searching that second set finds videos tagged
// similarly rather than only the exact words entered.
const RELATED_TAG_COUNT = 6;

function harvestRelatedTags(videos, seedTerms){
  // The seeds themselves aren't "related" — they're what was already searched.
  const banned = new Set();
  seedTerms.forEach(s => {
    const n = normaliseTerm(s.replace(/^-/, ''));
    if (n) banned.add(n);
    n.split(' ').forEach(w => { if (w) banned.add(w); });
  });

  const counts = {};
  const docs = {};
  videos.forEach(v => {
    const seen = new Set();
    (v.snippet && v.snippet.tags || []).forEach(tag => {
      const term = normaliseTerm(tag);
      // Counted once per video so one keyword-stuffed upload can't dominate.
      if (!term || seen.has(term)) return;
      if (!usefulTerm(term, banned)) return;
      seen.add(term);
      counts[term] = (counts[term] || 0) + 1;
      docs[term] = (docs[term] || 0) + 1;
    });
  });

  // A tag appearing on only one video out of fifty is noise, not a pattern.
  const ranked = Object.keys(counts)
    .filter(term => docs[term] >= 2)
    .sort((a, b) => counts[b] - counts[a]);

  // Prefer descriptive phrases, and skip near-duplicates of what's picked.
  const phrases = ranked.filter(x => x.includes(' '));
  const singles = ranked.filter(x => !x.includes(' '));
  const picked = [];
  const usedWords = new Set();
  [...phrases, ...singles].forEach(term => {
    if (picked.length >= RELATED_TAG_COUNT) return;
    const words = term.split(' ');
    if (words.every(w => usedWords.has(w))) return;
    words.forEach(w => usedWords.add(w));
    picked.push(term);
  });

  return picked;
}

function renderRelatedTags(){
  const el = document.getElementById('relatedTags');
  if (!el) return;
  if (!relatedTags || !relatedTags.related.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="creator-profile-head">Also searched these similar tags
      <span class="creator-profile-sub">found on ${relatedTags.sampled} videos matching your tags</span>
    </div>
    <div class="creator-profile-terms">
      ${relatedTags.related.map(term => `<span class="profile-term related">${escapeHTML(term)}</span>`).join('')}
    </div>
    <div class="creator-profile-note">Turn off "Widen to similar tags" in Filters to search only the exact tags you typed, which costs half as much quota.</div>
  `;
}

// --- Creators mode: resolution and style profiling ---

// Resolves a typed creator to a channel id. Handles and URLs resolve via
// forHandle/forUsername for 1 unit. A bare name has no cheap lookup and falls
// through to search.list, which costs 100 — so the UI warns about that rather
// than quietly spending it.
async function resolveCreator(raw){
  const key = raw.trim().toLowerCase();
  if (creatorResolveCache[key]) return creatorResolveCache[key];

  const parsed = extractHandleOrId(raw);
  const id = await resolveChannelId(parsed);
  const core = await fetchChannelCore(id);
  const entry = { id, title: core.snippet.title, thumb: (core.snippet.thumbnails || {}).default?.url || '' };
  creatorResolveCache[key] = entry;
  return entry;
}

// True when a typed creator can be looked up cheaply. A bare name can't.
function isCheapCreatorLookup(raw){
  const s = raw.trim();
  return s.startsWith('@') || /youtube\.com\//i.test(s) || /^UC[\w-]{10,}$/.test(s);
}

function normaliseTerm(s){
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usefulTerm(term, banned){
  if (term.length < 3 || term.length > 24) return false;
  if (PROFILE_STOPWORDS.has(term)) return false;
  if (/^\d+$/.test(term)) return false;
  if (banned.has(term)) return false;
  return true;
}

// Builds a "what kind of content is this" profile from the seed creators'
// recent uploads.
//
// The signal comes mostly from each video's own tags, which are the creator's
// own keywords and far more descriptive than title words — so tags are weighted
// heavier. Terms are counted once per video so one keyword-stuffed upload can't
// dominate, and when several creators are seeded a term's score is multiplied
// by how many of them use it, which is what surfaces the shared niche instead
// of any single channel's quirks.
async function buildCreatorProfile(){
  const resolved = [];
  for (const raw of searchCreators) {
    setStatus(`Looking up ${escapeHTML(raw)}…`, 'busy');
    resolved.push(await resolveCreator(raw));
  }
  if (!resolved.length) throw new Error('Add at least one creator first.');

  setStatus('Reading recent uploads to model their content…', 'busy');

  // One batched channels.list for every seed at once — 1 unit total.
  const ids = resolved.map(r => r.id);
  const chData = await fetchWithFallback(key =>
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,brandingSettings&id=${ids.join(',')}&key=${key}`);

  const uploadsByChannel = {};
  (chData.items || []).forEach(c => {
    const up = c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads;
    if (up) uploadsByChannel[c.id] = up;
  });

  // Channel-level keywords, when the creator has set any.
  const channelKeywords = [];
  (chData.items || []).forEach(c => {
    const kw = c.brandingSettings && c.brandingSettings.channel && c.brandingSettings.channel.keywords;
    if (kw) {
      (kw.match(/"[^"]+"|\S+/g) || []).forEach(k => channelKeywords.push({
        channelId: c.id, term: normaliseTerm(k.replace(/"/g, ''))
      }));
    }
  });

  // Recent uploads per creator — 1 unit each.
  const videoIdsByChannel = {};
  for (const r of resolved) {
    const playlist = uploadsByChannel[r.id];
    if (!playlist) { videoIdsByChannel[r.id] = []; continue; }
    const pl = await fetchWithFallback(key =>
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${playlist}&maxResults=${PROFILE_VIDEOS_PER_CREATOR}&key=${key}`);
    videoIdsByChannel[r.id] = (pl.items || [])
      .map(i => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
  }

  // One batched videos.list for every sampled video — 1 unit per 50.
  const allVideoIds = Object.values(videoIdsByChannel).flat();
  const videos = [];
  for (let i = 0; i < allVideoIds.length; i += 50) {
    const chunk = allVideoIds.slice(i, i + 50);
    if (!chunk.length) break;
    const vd = await fetchWithFallback(key =>
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(',')}&key=${key}`);
    (vd.items || []).forEach(v => videos.push(v));
  }

  // Don't let the creators' own names become the search terms — that would just
  // find them again rather than finding creators like them.
  const banned = new Set();
  resolved.forEach(r => {
    normaliseTerm(r.title).split(' ').forEach(w => { if (w) banned.add(w); });
  });
  searchCreators.forEach(raw => {
    normaliseTerm(raw.replace(/^@/, '')).split(' ').forEach(w => { if (w) banned.add(w); });
  });

  const scores = {};                 // term -> weighted score
  const creatorsUsing = {};          // term -> Set of channel ids
  const categoryCount = {};

  function add(term, weight, channelId){
    if (!usefulTerm(term, banned)) return;
    scores[term] = (scores[term] || 0) + weight;
    (creatorsUsing[term] = creatorsUsing[term] || new Set()).add(channelId);
  }

  videos.forEach(v => {
    const cid = v.snippet.channelId;
    if (v.snippet.categoryId) {
      categoryCount[v.snippet.categoryId] = (categoryCount[v.snippet.categoryId] || 0) + 1;
    }
    // Counted once per video so a single keyword-stuffed upload can't dominate.
    const seen = new Set();
    (v.snippet.tags || []).forEach(tag => {
      const term = normaliseTerm(tag);
      if (!term || seen.has(term)) return;
      seen.add(term);
      add(term, 3, cid);
    });
    normaliseTerm(v.snippet.title).split(' ').forEach(w => {
      if (!w || seen.has(w)) return;
      seen.add(w);
      add(w, 1, cid);
    });
  });

  channelKeywords.forEach(k => { if (k.term) add(k.term, 2, k.channelId); });

  // When several creators are seeded, the interesting terms are the ones they
  // have in common — that's the shared niche. A term only one of them uses is
  // that channel's own quirk and would drag the search toward them specifically
  // rather than toward the style, so shared terms always outrank private ones.
  // Private terms are still kept as filler in case there aren't enough shared
  // ones to fill the profile.
  const minCreators = resolved.length > 1 ? 2 : 1;
  const ranked = Object.keys(scores)
    .map(term => ({
      term,
      shared: creatorsUsing[term].size >= minCreators,
      score: scores[term] * creatorsUsing[term].size
    }))
    .sort((a, b) => (b.shared - a.shared) || (b.score - a.score));

  // With multiple creators, private terms are dropped outright rather than
  // used as filler. A short profile of genuinely shared traits beats a full one
  // padded with a single channel's quirks — padding is exactly what would pull
  // the results back toward that one creator. The only exception is seeds with
  // nothing at all in common, where falling back beats returning nothing.
  const shared = ranked.filter(r => r.shared);
  const sharedOnly = minCreators === 1 || shared.length > 0;
  const candidates = shared.length ? shared : ranked;

  // Prefer descriptive multi-word phrases over single words.
  const byScore = (a, b) => b.score - a.score;
  const phrases = candidates.filter(r => r.term.includes(' ')).sort(byScore);
  const singles = candidates.filter(r => !r.term.includes(' ')).sort(byScore);

  const picked = [];
  const usedWords = new Set();
  [...phrases, ...singles].forEach(r => {
    if (picked.length >= PROFILE_TERM_COUNT) return;
    // Skip a term whose words are already covered, to avoid near-duplicates.
    const words = r.term.split(' ');
    if (words.every(w => usedWords.has(w))) return;
    words.forEach(w => usedWords.add(w));
    picked.push(r.term);
  });

  let categoryId = null, best = 0;
  for (const c in categoryCount) {
    if (categoryCount[c] > best) { best = categoryCount[c]; categoryId = c; }
  }

  if (!picked.length) {
    throw new Error('Could not model these creators — their recent uploads had too little descriptive text. Try a different creator, or use Tags mode.');
  }

  return {
    creators: resolved,
    seedIds: new Set(resolved.map(r => r.id)),
    terms: picked,
    categoryId,
    sampled: videos.length,
    // False when the seeds had nothing in common and the profile had to fall
    // back to traits only some of them share.
    sharedOnly: minCreators === 1 ? true : sharedOnly
  };
}

function renderCreatorProfile(){
  if (!creatorProfileEl) return;
  if (!modeIsCreators(searchMode) || !creatorProfile) {
    creatorProfileEl.style.display = 'none';
    return;
  }
  creatorProfileEl.style.display = 'block';
  creatorProfileEl.innerHTML = `
    <div class="creator-profile-head">Modelled on ${creatorProfile.creators.map(c => escapeHTML(c.title)).join(', ')}
      <span class="creator-profile-sub">${creatorProfile.sampled} recent uploads sampled</span>
    </div>
    <div class="creator-profile-terms">
      ${creatorProfile.terms.map(term => `<span class="profile-term">${escapeHTML(term)}</span>`).join('')}
    </div>
    ${creatorProfile.sharedOnly === false ? '<div class="creator-profile-warn">These creators had little in common, so the profile fell back to traits only some of them share. One creator at a time usually gives sharper results.</div>' : ''}
    <div class="creator-profile-note">These are the traits pulled from their uploads and used as the search. Videos from the seed creators themselves are filtered out, so what's left is other creators making similar content.</div>
  `;
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
  searchFilters.expandTags = fExpandTags.checked;
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
  fExpandTags.checked = searchFilters.expandTags !== false;
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
  // The whole point of Creators mode is finding *other* people making similar
  // content, so the seed creators' own uploads are dropped.
  if (modeIsCreators(searchMode) && creatorProfile && creatorProfile.seedIds.has(r.channelId)) return false;
  return true;
}

function filteredPool(){
  return pool.filter(passesLocalFilters);
}

// True while any of the current query's sources still has a page left.
function hasMoreFromApi(){
  return searchSources.some(s => s.pageToken);
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
  } else if (hasMoreFromApi()) {
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
// The query built from the bars the current mode actually uses.
function buildPrimaryQuery(){
  const parts = [];
  const base = searchInput.value.trim();

  if (modeIsCreators(searchMode)) {
    if (base) parts.push(base);
    if (creatorProfile) parts.push(...creatorProfile.terms);
    return parts.join(' ').trim();
  }

  if (modeUsesSearchBox(searchMode) && base) parts.push(base);

  if (modeUsesSecondBar(searchMode) && !modeIsCreators(searchMode)) {
    searchTags.forEach(tag => {
      if (tag.startsWith('-')) {
        const body = tag.slice(1).trim();
        if (!body) return;
        parts.push(body.includes(' ') ? `-"${body}"` : `-${body}`);
      } else {
        parts.push(tag.includes(' ') ? `"${tag}"` : tag);
      }
    });
  }

  return parts.join(' ').trim();
}

// Kept for compatibility with anything still calling buildQuery().
function buildQuery(){ return buildPrimaryQuery(); }

function whatIsMissing(){
  if (modeIsCreators(searchMode) && !searchCreators.length) {
    return 'Add at least one creator to model, or switch to another mode.';
  }
  if (searchMode === 'tags_only' && !searchTags.length) {
    return 'Add at least one tag. Switch to Search or Search + Tags if you want to type a term instead.';
  }
  if (searchMode === 'search_only' && !searchInput.value.trim()) {
    return 'Type a search term. Switch to Tags if you want to search by tags instead.';
  }
  if (searchMode === 'search_tags' && !searchInput.value.trim() && !searchTags.length) {
    return 'Type a search term or add at least one tag before searching.';
  }
  return null;
}

// Turns one search.list response plus its videos.list detail into pool entries.
// Returns the raw API video items too, so tag expansion can read their tags
// without paying for a second lookup.
async function runSearchSource(source){
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(FETCH_SIZE),
    order: searchFilters.order,
    q: source.q
  });

  const days = TIME_RANGE_DAYS[searchFilters.time];
  if (days) params.set('publishedAfter', new Date(Date.now() - days * 86400000).toISOString());
  if (searchFilters.region !== 'any') params.set('regionCode', searchFilters.region);
  if (searchFilters.language !== 'any') params.set('relevanceLanguage', searchFilters.language);
  // Creator searches stay inside the category the seeds actually publish in,
  // which stops the derived terms drifting into an unrelated niche.
  if (source.categoryId) params.set('videoCategoryId', source.categoryId);
  if (source.pageToken) params.set('pageToken', source.pageToken);

  const data = await fetchWithFallback(key =>
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}&key=${key}`);

  source.pageToken = data.nextPageToken || null;

  const ids = (data.items || [])
    .map(i => i.id && i.id.videoId)
    .filter(id => id && !seenIds.has(id));

  if (!ids.length) return [];

  const det = await fetchWithFallback(key =>
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,player&id=${ids.join(',')}&maxWidth=${PLAYER_PROBE_WIDTH}&key=${key}`);

  const items = det.items || [];
  const fresh = items.map(v => {
    const th = v.snippet.thumbnails || {};
    const thumb = (th.maxres && th.maxres.url) || (th.high && th.high.url)
               || (th.medium && th.medium.url) || (th.default && th.default.url) || '';
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
      comments: v.statistics.commentCount === undefined ? null : Number(v.statistics.commentCount),
      via: source.label
    };
  });

  fresh.forEach(r => seenIds.add(r.id));

  // videos.list doesn't preserve the search's ranking, so re-apply the chosen
  // sort to just the newly-arrived batch. Already-visible results keep their
  // position instead of reshuffling under the reader.
  if (searchFilters.order === 'viewCount')  fresh.sort((a, b) => b.views - a.views);
  else if (searchFilters.order === 'date')  fresh.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  pool = pool.concat(fresh);
  return items;
}

async function executeSearch(append){
  if (searching) return;

  const missing = whatIsMissing();
  if (missing) { setStatus(missing, 'error'); return; }
  if (!hasApiKey()) { openKeyModal(); return; }

  searching = true;
  searchBtn.disabled = true;
  showMoreBtn.disabled = true;
  setStatus('Searching YouTube…', 'busy');

  // The creator profile is derived once and reused while paging, so "load more"
  // doesn't pay to re-read the creators' uploads every time.
  if (modeIsCreators(searchMode) && (!append || !creatorProfile)) {
    try {
      creatorProfile = await buildCreatorProfile();
      renderCreatorProfile();
    } catch(e) {
      setStatus(`Couldn't model those creators: ${escapeHTML(e.message || 'unknown error')}`, 'error');
      searching = false;
      searchBtn.disabled = false;
      return;
    }
  }

  if (!append) {
    pool = [];
    seenIds = new Set();
    shownCount = 0;
    searchSources = [];
    relatedTags = null;
    renderRelatedTags();
    searchResults.innerHTML = '';
    showMoreWrap.style.display = 'none';
    searchEmpty.style.display = 'none';
  }

  try {
    if (!append) {
      const q = buildPrimaryQuery();
      if (!q) {
        setStatus('Nothing to search for yet.', 'error');
        searching = false;
        searchBtn.disabled = false;
        return;
      }
      lastRunQuery = q;

      const primary = {
        label: modeCanExpandTags(searchMode) ? 'your tags' : 'your search',
        q,
        categoryId: (modeIsCreators(searchMode) && creatorProfile) ? creatorProfile.categoryId : null,
        pageToken: null
      };
      searchSources = [primary];

      const primaryItems = await runSearchSource(primary);

      // Widen to similar tags using the tags those first results carry. The
      // harvest is free — those videos were already fetched for display — so
      // the only extra cost is the second search itself.
      if (modeCanExpandTags(searchMode) && searchFilters.expandTags && searchTags.length) {
        setStatus('Looking for videos with similar tags…', 'busy');
        const related = harvestRelatedTags(primaryItems, searchTags);
        if (related.length) {
          relatedTags = { seeds: [...searchTags], related, sampled: primaryItems.length };
          renderRelatedTags();
          const widened = { label: 'similar tags', q: related.join(' '), categoryId: null, pageToken: null };
          searchSources.push(widened);
          await runSearchSource(widened);
        }
      }
    } else {
      // Page whichever source still has results left.
      const src = searchSources.find(s => s.pageToken);
      if (src) await runSearchSource(src);
    }

    clearFiltersDirty();
    shownCount = Math.min(filteredPool().length, (append ? shownCount : 0) + REVEAL_SIZE);

    const total = filteredPool().length;
    if (!total && !pool.length) {
      searchEmpty.style.display = 'block';
      searchEmpty.innerHTML = `<h2>No results</h2><p>YouTube returned nothing for <b>${escapeHTML(lastRunQuery)}</b>. Try broader wording or fewer tags.</p>`;
      setStatus('', '');
    } else if (modeIsCreators(searchMode) && creatorProfile) {
      const names = creatorProfile.creators.map(c => escapeHTML(c.title)).join(', ');
      setStatus(`Creators like <b>${names}</b> — ${pool.length} result${pool.length === 1 ? '' : 's'} loaded, ${total} after filtering out their own uploads.`, 'ok');
    } else {
      const widened = relatedTags && relatedTags.related.length
        ? `, widened to ${relatedTags.related.length} similar tag${relatedTags.related.length === 1 ? '' : 's'}` : '';
      setStatus(`Searched for <b>${escapeHTML(lastRunQuery)}</b>${widened} — ${pool.length} result${pool.length === 1 ? '' : 's'} loaded, ${total} matching your filters.`, 'ok');
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
  } else if (e.key === 'Backspace' && !tagInput.value) {
    if (modeIsCreators(searchMode) && searchCreators.length) {
      searchCreators.pop();
      saveSearchCreators();
      creatorProfile = null;
      renderCreatorProfile();
      renderTags();
      renderModeUI();
      markFiltersDirty();
    } else if (searchMode === 'tags' && searchTags.length) {
      searchTags.pop();
      saveSearchTags();
      renderTags();
      markFiltersDirty();
    }
  }
});
tagInput.addEventListener('blur', addTagsFromInput);

showMoreBtn.onclick = () => {
  const results = filteredPool();
  if (results.length > shownCount) {
    // Free reveal — these are already in the pool.
    shownCount += REVEAL_SIZE;
    renderResults();
  } else if (hasMoreFromApi()) {
    requestSearch(true);
  }
};

modeSwitch.querySelectorAll('.mode-opt').forEach(btn => {
  btn.onclick = () => {
    const next = btn.dataset.mode;
    if (next === searchMode) return;
    searchMode = next;
    saveSearchMode();
    tagInput.value = '';
    renderTags();
    renderModeUI();
    renderCreatorProfile();
    renderRelatedTags();
    markFiltersDirty();
    setStatus('', '');
  };
});

filtersToggle.onclick = () => {
  const open = filtersPanel.style.display !== 'none';
  filtersPanel.style.display = open ? 'none' : 'grid';
  filtersToggle.textContent = open ? 'Filters ▾' : 'Filters ▴';
};

[fOrder, fTime, fType, fMinViews, fRegion, fLanguage, fNoLive, fExpandTags].forEach(el => {
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
renderModeUI();
renderCreatorProfile();
renderRelatedTags();
initCommonPage(null, { autoRefresh: false });
searchInput.focus();

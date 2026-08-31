// api.js — YouTube Data API access, refresh orchestration, chart snapshot
// recording. Depends on state.js. Calls into ui.js hooks (checkSubChanges,
// updateSidePanel, openKeyModal) and an optional page-defined window.refreshUI()
// so it can stay agnostic of which page (list/graph/competitors) is open.

// --- Core API Auth ---
function hasApiKey() {
  return apiKeys.some(k => k.value && k.value.trim() !== '');
}

function switchKey() {
  for (let i = 1; i <= apiKeys.length; i++) {
    let nextIdx = (activeKeyIndex + i) % apiKeys.length;
    if (apiKeys[nextIdx].value && apiKeys[nextIdx].value.trim() !== '') {
       activeKeyIndex = nextIdx;
       if (typeof updateApiStatusUi === 'function') updateApiStatusUi();
       return;
    }
  }
}

async function fetchWithFallback(urlBuilderFn) {
  let attempts = 0;
  let validKeysCount = apiKeys.filter(k => k.value && k.value.trim() !== '').length;
  if (validKeysCount === 0) throw new Error('No API keys provided.');

  while(attempts < validKeysCount) {
    const key = apiKeys[activeKeyIndex].value;
    if (!key || key.trim() === '') {
      switchKey();
      continue;
    }

    const res = await fetch(urlBuilderFn(key));
    const data = await res.json();

    if (data.error) {
      if (data.error.code === 403 || (data.error.message && data.error.message.toLowerCase().includes('quota'))) {
        switchKey();
        attempts++;
        continue;
      } else {
        throw new Error(data.error.message);
      }
    }
    return data;
  }
  throw new Error('All provided API keys have exceeded their quota or are invalid.');
}

// --- Channel resolution ---
function extractHandleOrId(raw){
  raw = raw.trim();
  if(!raw) return null;
  let m = raw.match(/youtube\.com\/(channel\/(UC[\w-]{10,})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i);
  if(m){
    if(m[2]) return {type:'id', value:m[2]};
    if(m[3]) return {type:'handle', value:'@'+m[3]};
    if(m[4]) return {type:'legacy', value:m[4]};
    if(m[5]) return {type:'legacy', value:m[5]};
  }
  if(/^UC[\w-]{10,}$/.test(raw)) return {type:'id', value:raw};
  if(raw.startsWith('@')) return {type:'handle', value:raw};
  return {type:'handle', value:'@'+raw};
}

async function resolveChannelId(parsed){
  const base = 'https://www.googleapis.com/youtube/v3/channels';
  if(parsed.type === 'id'){
    return parsed.value;
  }
  if(parsed.type === 'handle'){
    const data = await fetchWithFallback(key => `${base}?part=id&forHandle=${encodeURIComponent(parsed.value.replace(/^@/,''))}&key=${key}`);
    if(data.items && data.items.length) return data.items[0].id;
    return await searchChannel(parsed.value);
  }
  if(parsed.type === 'legacy'){
    // Legacy /c/ and /user/ URLs are usually (but not always) YouTube
    // "usernames" — try an exact forUsername lookup first since it's
    // unambiguous, and only fall back to fuzzy search if that misses.
    const data = await fetchWithFallback(key => `${base}?part=id&forUsername=${encodeURIComponent(parsed.value)}&key=${key}`);
    if(data.items && data.items.length) return data.items[0].id;
    return await searchChannel(parsed.value);
  }
  return await searchChannel(parsed.value);
}

async function searchChannel(q){
  const data = await fetchWithFallback(key => `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=1&key=${key}`);
  if(!data.items || !data.items.length) throw new Error('Channel not found');
  return data.items[0].id.channelId;
}

async function fetchChannelCore(channelId){
  const data = await fetchWithFallback(key => `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${key}`);
  if(!data.items || !data.items.length) throw new Error('Channel not found');
  return data.items[0];
}

async function fetchUploadsWithinDays(uploadsPlaylistId, maxDays){
  const cutoff = Date.now() - maxDays*24*60*60*1000;
  let videos = [];
  let pageToken = '';
  let guard = 0;
  while(guard < 20){
    guard++;
    const data = await fetchWithFallback(key => `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50&key=${key}${pageToken ? '&pageToken='+pageToken : ''}`);
    const items = data.items || [];
    let hitCutoff = false;
    for(const it of items){
      const publishedAt = it.contentDetails.videoPublishedAt;
      const t = new Date(publishedAt).getTime();
      if(t < cutoff){ hitCutoff = true; continue; }
      videos.push({id: it.contentDetails.videoId, publishedAt: t});
    }
    if(hitCutoff || !data.nextPageToken){ break; }
    pageToken = data.nextPageToken;
  }
  return videos;
}

async function fetchVideoStats(videoIds){
  const stats = {};
  const now = Date.now();
  for(let i=0;i<videoIds.length;i+=50){
    const chunk = videoIds.slice(i, i+50);
    const data = await fetchWithFallback(key => `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${chunk.join(',')}&key=${key}`);
    for(const v of (data.items||[])){
      const t = v.snippet.thumbnails;
      const bestThumb = (t && t.maxres && t.maxres.url) || (t && t.high && t.high.url) || (t && t.medium && t.medium.url) || (t && t.default && t.default.url) || '';

      const views = Number(v.statistics.viewCount || 0);

      if (!videoHistory[v.id]) {
          videoHistory[v.id] = [{t: now, v: views}];
      } else {
          let pts = videoHistory[v.id];
          const lastPt = pts[pts.length - 1];
          if (now - lastPt.t >= 300000) {
              pts.push({t: now, v: views});
          }
          videoHistory[v.id] = pts.filter(p => now - p.t <= 3600000);
      }

      let pts = videoHistory[v.id];
      let vph = 0;
      if (pts.length > 0) {
          let oldest = pts[0];
          let hoursDiff = (now - oldest.t) / (1000 * 60 * 60);
          if (hoursDiff >= 0.005) {
              vph = (views - oldest.v) / hoursDiff;
          } else {
              const publishedAt = new Date(v.snippet.publishedAt).getTime();
              const hoursSincePub = Math.max(1, (now - publishedAt) / (1000 * 60 * 60));
              vph = views / hoursSincePub;
          }
      }

      stats[v.id] = {
        views: views,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumb: bestThumb,
        vph: vph
      };
    }
  }
  saveVideoHistory();
  return stats;
}

function computeWindows(videos, viewStats){
  const now = Date.now();
  return WINDOWS.map(w => {
    const cutoff = now - w.days*24*60*60*1000;
    const inWindow = videos.filter(v => v.publishedAt >= cutoff);
    const views = inWindow.reduce((sum,v) => sum + (viewStats[v.id]?.views || 0), 0);
    return {label:w.label, count:inWindow.length, views};
  });
}

function findBestRecentVideo(videos, viewStats, maxDays = 7) {
  const cutoff = Date.now() - maxDays*24*60*60*1000;
  const recentVideos = videos.filter(v => v.publishedAt >= cutoff);

  if (recentVideos.length === 0) return null;

  let bestVideo = null;
  let maxViews = -1;

  for (const v of recentVideos) {
    const stat = viewStats[v.id];
    if (stat && stat.views > maxViews) {
      maxViews = stat.views;
      bestVideo = {
        id: v.id,
        title: stat.title,
        views: stat.views,
        vph: stat.vph,
        thumb: stat.thumb,
        publishedAt: stat.publishedAt
      };
    }
  }
  return bestVideo;
}

// --- Chart snapshot recording (data-layer only; rendering the canvas is
// graph.js's job via the optional window.updateChart hook) ---
//
// One point per clock hour. Three cases:
//   - Same hour as the last point  -> overwrite it, so the newest reading wins.
//   - Next hour                    -> append.
//   - Gap (page was closed)        -> backfill every missed hour with the last
//                                     known value, then append. That repetition
//                                     is what draws a flat line across downtime
//                                     instead of a diagonal guess between two
//                                     distant readings.
function recordChartSnapshot() {
  if (channels.length === 0) return;
  const now = Date.now();
  const slot = hourBucket(now);

  if (!chartSnapshots.timestamps) chartSnapshots.timestamps = [];
  if (!chartSnapshots.labels) chartSnapshots.labels = [];

  const lastSlot = chartSnapshots.timestamps.length
    ? chartSnapshots.timestamps[chartSnapshots.timestamps.length - 1]
    : null;

  const overwriting = lastSlot === slot;

  // Hours to add: the missed ones (flatline) plus the current one.
  const newSlots = [];
  if (!overwriting) {
    if (lastSlot !== null) {
      for (let t = lastSlot + HOUR_MS; t < slot; t += HOUR_MS) newSlots.push(t);
    }
    newSlots.push(slot);
  }

  newSlots.forEach(t => {
    chartSnapshots.timestamps.push(t);
    chartSnapshots.labels.push(formatSnapshotLabel(t, 7));
  });

  channels.forEach((ch, idx) => {
    if (!chartSnapshots.datasets[ch.id]) {
      chartSnapshots.datasets[ch.id] = {
        label: cache[ch.id]?.data?.title || ch.addedAs,
        subsData: [],
        viewsData: [],
        vphData: [],
        color: palette[idx % palette.length]
      };
    }
    const ds = chartSnapshots.datasets[ch.id];

    // A channel added partway through gets nulls for the hours before it
    // existed, so it starts where it was actually added rather than being
    // stretched back across the whole history.
    const targetLen = chartSnapshots.timestamps.length;
    while (ds.subsData.length < targetLen - (overwriting ? 0 : newSlots.length)) {
      ds.subsData.push(null);
      ds.viewsData.push(null);
      ds.vphData.push(null);
    }

    const lastReal = ds.subsData.length ? {
      subs:  ds.subsData[ds.subsData.length - 1],
      views: ds.viewsData[ds.viewsData.length - 1]
    } : { subs: null, views: null };

    if (!overwriting) {
      // Flatline the skipped hours at the last known reading.
      for (let i = 0; i < newSlots.length - 1; i++) {
        ds.subsData.push(lastReal.subs);
        ds.viewsData.push(lastReal.views);
        ds.vphData.push(lastReal.views === null ? null : 0);
      }
    }

    const subs  = cache[ch.id]?.data?.subs;
    const views = cache[ch.id]?.data?.totalViews;

    // VPH is derived from the delta against the most recent real (non-null,
    // non-backfilled) views reading.
    let vph = null;
    if (views !== undefined && views !== null) {
      let lastViews = null, lastTime = null;
      const searchEnd = overwriting ? ds.viewsData.length - 1 : ds.viewsData.length;
      for (let i = searchEnd - 1; i >= 0; i--) {
        if (ds.viewsData[i] !== null && ds.viewsData[i] !== undefined) {
          lastViews = ds.viewsData[i];
          lastTime = chartSnapshots.timestamps[i];
          break;
        }
      }
      if (lastViews !== null && lastTime !== null) {
        const hours = (slot - lastTime) / HOUR_MS;
        if (hours > 0) vph = Math.max(0, (views - lastViews) / hours);
      }
    }

    const subsVal  = subs  !== undefined ? subs  : null;
    const viewsVal = views !== undefined ? views : null;

    if (overwriting && ds.subsData.length === chartSnapshots.timestamps.length) {
      const last = ds.subsData.length - 1;
      ds.subsData[last]  = subsVal;
      ds.viewsData[last] = viewsVal;
      ds.vphData[last]   = vph;
    } else {
      ds.subsData.push(subsVal);
      ds.viewsData.push(viewsVal);
      ds.vphData.push(vph);
    }

    ds.label = cache[ch.id]?.data?.title || ch.addedAs;
  });

  // Trim to the retention window.
  const overflow = chartSnapshots.timestamps.length - CHART_MAX_POINTS;
  if (overflow > 0) {
    chartSnapshots.timestamps.splice(0, overflow);
    chartSnapshots.labels.splice(0, overflow);
    for (const id in chartSnapshots.datasets) {
      const ds = chartSnapshots.datasets[id];
      ds.subsData.splice(0, overflow);
      ds.viewsData.splice(0, overflow);
      ds.vphData.splice(0, overflow);
    }
  }

  saveChartSnapshots();
  if (typeof updateChart === 'function') updateChart();
}

// Fire at the top of each hour rather than an hour after page load, so points
// from different sessions land on the same grid.
(function scheduleHourlySnapshots(){
  const msToNextHour = HOUR_MS - (Date.now() % HOUR_MS);
  setTimeout(() => {
    recordChartSnapshot();
    setInterval(recordChartSnapshot, HOUR_MS);
  }, msToNextHour + 1000);
})();

// --- Data fetch orchestration ---
async function fetchAllDataFor(id, isCompetitor = false){
  const prev = cache[id] && cache[id].data ? cache[id].data : null;
  cache[id] = {status:'loading', data: prev};
  if (typeof window.refreshUI === 'function') window.refreshUI();
  try{
    const core = await fetchChannelCore(id);
    const uploadsId = core.contentDetails.relatedPlaylists.uploads;
    const videos = await fetchUploadsWithinDays(uploadsId, 365);
    const viewStats = await fetchVideoStats(videos.map(v=>v.id));
    pruneVideoHistory(videos.map(v=>v.id));
    const windows = computeWindows(videos, viewStats);
    const bestVideo = findBestRecentVideo(videos, viewStats, 7);

    let newestVideo = null;
    if(videos.length > 0) {
       const nv = videos[0];
       const nvStats = viewStats[nv.id];
       if(nvStats) {
         newestVideo = {
           id: nv.id,
           title: nvStats.title,
           views: nvStats.views,
           vph: nvStats.vph,
           thumb: nvStats.thumb,
           publishedAt: nvStats.publishedAt
         };
       }
    }

    const newSubs = core.statistics.hiddenSubscriberCount ? null : Number(core.statistics.subscriberCount);

    if (!isCompetitor && typeof checkSubChanges === 'function') {
       checkSubChanges(id, core.snippet.title, prev ? prev.subs : undefined, newSubs);
    }

    cache[id] = {
      status:'ok',
      data:{
        title: core.snippet.title,
        handle: core.snippet.customUrl || '',
        thumb: core.snippet.thumbnails && (core.snippet.thumbnails.default||{}).url,
        subs: newSubs,
        totalViews: Number(core.statistics.viewCount || 0),
        totalVideos: Number(core.statistics.videoCount || 0),
        windows,
        bestVideo,
        newestVideo,
        syncedAt: Date.now(),
        syncError: false
      }
    };
    if (typeof updateSidePanel === 'function') updateSidePanel();
  }catch(e){
    cache[id] = {status:'error', error: e.message || 'Something went wrong'};
  }
  if (typeof window.refreshUI === 'function') window.refreshUI();
}

async function refreshAll(){
  if(!hasApiKey()){ if (typeof openKeyModal === 'function') openKeyModal(); return; }

  const allIds = [...channels, ...competitors].map(c => c.id);
  const uniqueIds = [...new Set(allIds)];

  await Promise.all(uniqueIds.map(id => {
      const isCompOnly = !channels.some(c => c.id === id);
      return fetchAllDataFor(id, isCompOnly);
  }));

  // Always record — recordChartSnapshot() buckets by hour, so this either
  // fills the current hour's slot or updates it in place. This is what makes
  // "every hour the page was open" get logged.
  recordChartSnapshot();
  if (typeof updateChart === 'function') updateChart();
}

// --- Lightweight per-card auto-refresh (subs/views/videos only) ---
const autoRefreshTimers = {};
function startAutoRefresh(id){
  stopAutoRefresh(id);
  const intervalMs = REFRESH_OPTIONS[appSettings.refreshIntervalIndex || 0].ms;
  autoRefreshTimers[id] = setInterval(() => refreshLiveStatsOnly(id), intervalMs);
}
function stopAutoRefresh(id){
  if(autoRefreshTimers[id]){ clearInterval(autoRefreshTimers[id]); delete autoRefreshTimers[id]; }
}
async function refreshLiveStatsOnly(id){
  // This is intentionally lightweight — it only re-fetches the channel's
  // core stats (subs/views/videos), NOT the full upload list + per-video
  // stats. That heavier refresh happens via fetchAllDataFor() on manual
  // "Refresh all" / per-card refresh instead, so this per-card auto-refresh
  // toggle doesn't silently burn a full refresh's worth of API quota
  // every tick just to keep subscriber counts current.
  if(!hasApiKey()) return;
  try{
    const core = await fetchChannelCore(id);
    const prev = cache[id] && cache[id].data ? cache[id].data : {};

    const newSubs = core.statistics.hiddenSubscriberCount ? null : Number(core.statistics.subscriberCount);

    if (typeof checkSubChanges === 'function') checkSubChanges(id, core.snippet.title, prev.subs, newSubs);

    cache[id] = {
      status:'ok',
      data:{
        ...prev,
        title: core.snippet.title,
        thumb: core.snippet.thumbnails && (core.snippet.thumbnails.default||{}).url,
        subs: newSubs,
        totalViews: Number(core.statistics.viewCount || 0),
        totalVideos: Number(core.statistics.videoCount || 0),
        syncedAt: Date.now(),
        syncError: false
      }
    };
    if (typeof window.refreshUI === 'function') window.refreshUI();
    if (typeof updateSidePanel === 'function') updateSidePanel();
  }catch(e){
    if(cache[id] && cache[id].data) {
        cache[id].data.syncError = true;
    }
    if (typeof window.refreshUI === 'function') window.refreshUI();
  }
}

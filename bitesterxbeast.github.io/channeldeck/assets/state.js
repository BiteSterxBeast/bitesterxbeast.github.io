// state.js — data model, constants, persistence, and formatting helpers.
// Loaded by every Channel Deck page before api.js / ui.js / page scripts.

const REFRESH_OPTIONS = [
  { ms: 15000, text: '15s', label: '15s - Rapid (Not Recommended With 4+ Channels)' },
  { ms: 30000, text: '30s', label: '30s - Intermediate' },
  { ms: 45000, text: '45s', label: '45s - Decent' },
  { ms: 60000, text: '1m', label: '1m - Basic' }
];

const WINDOWS = [
  {label:'1d', days:1},
  {label:'7d', days:7},
  {label:'28d', days:28},
  {label:'90d', days:90},
  {label:'365d', days:365},
];

const MILESTONES = [
  500, 1000, 5000, 10000, 25000, 50000, 100000, 250000,
  500000, 1000000, 2000000, 3000000, 4000000, 5000000,
  6000000, 7000000, 8000000, 9000000, 10000000
];

const palette = ['#34D6C4', '#F2B84B', '#FF4B3E', '#9b59b6', '#3498db', '#e67e22', '#2ecc71', '#e74c3c'];

let appSettings = {
  volume: 100,
  muted: false,
  windows: { '1d': true, '7d': true, '28d': true, '90d': true, '365d': true },
  refreshIntervalIndex: 0,
  discordWebhook: '',
  discordInterval: 'milestones'
};

let apiKeys = [{name: 'API Key 1', value: ''}];
let activeKeyIndex = 0;
let channels = [];
let competitors = [];
let cache = {};
let activityLogs = [];
let videoHistory = {};
let chartSnapshots = {
  labels: [],
  timestamps: [],
  datasets: {}
};

// --- Formatting Helpers ---
function escapeHTML(str) {
  return (str || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

function fmt(n){
  if(n === null || n === undefined) return '—';
  n = Number(n);
  if(n >= 1e9) return (n/1e9).toFixed(2).replace(/\.00$/,'') + 'B';
  if(n >= 1e6) return (n/1e6).toFixed(2).replace(/\.00$/,'') + 'M';
  if(n >= 1e3) return (n/1e3).toFixed(2).replace(/\.00$/,'') + 'K';
  return String(Math.round(n));
}

function fmtVph(n, publishedAt){
  if(n === null || n === undefined) return '—';
  n = Number(n);
  let r = Math.round(n);
  if(r === 0){
    // Only call it "dead" once the video has had enough time to accumulate
    // meaningful hourly view data. Brand-new uploads with 0 VPH just haven't
    // had a chance to register growth yet.
    if(publishedAt){
      const hoursSincePub = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
      if(hoursSincePub < 2) return '0/hr';
    }
    return 'Dead Video';
  }
  if(n >= 1e9) return (n/1e9).toFixed(2).replace(/\.00$/,'') + 'B/hr';
  if(n >= 1e6) return (n/1e6).toFixed(2).replace(/\.00$/,'') + 'M/hr';
  if(n >= 1e3) return (n/1e3).toFixed(2).replace(/\.00$/,'') + 'K/hr';
  return r + '/hr';
}

function hexToRgb(hex) {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : {r:52, g:214, b:196};
}

// --- Persistence ---
function saveChannels(){
  try{ localStorage.setItem('channelDeck_channels', JSON.stringify(channels)); }catch(e){}
}
function saveCompetitors(){
  try{ localStorage.setItem('channelDeck_competitors', JSON.stringify(competitors)); }catch(e){}
}
function saveApiKeys(){
  try{ localStorage.setItem('channelDeck_apiKeys', JSON.stringify(apiKeys)); }catch(e){}
}
function saveSettings(){
  try{ localStorage.setItem('channelDeck_settings', JSON.stringify(appSettings)); }catch(e){}
}
function saveVideoHistory() {
  try { localStorage.setItem('channelDeck_videoHistory', JSON.stringify(videoHistory)); } catch(e){}
}
function saveLogs() {
  try { localStorage.setItem('channelDeck_logs', JSON.stringify(activityLogs)); } catch(e){}
}
function saveChartSnapshots() {
  try { localStorage.setItem('channelDeck_chart', JSON.stringify(chartSnapshots)); } catch(e){}
}

// Removes videoHistory entries for videos that are no longer part of any
// tracked channel's upload/video set, so the history object doesn't grow
// forever in localStorage as channels post new videos over time.
function pruneVideoHistory(activeVideoIds) {
  const activeSet = new Set(activeVideoIds);
  let changed = false;
  for (const vid in videoHistory) {
    if (!activeSet.has(vid)) {
      delete videoHistory[vid];
      changed = true;
    }
  }
  if (changed) saveVideoHistory();
}

// Loads all persisted state from localStorage into the in-memory variables
// above. Deliberately does NOT touch the DOM or call any render functions —
// each page's script decides what to render after this runs.
function loadState(){
  try {
    const s = localStorage.getItem('channelDeck_settings');
    if (s) {
      appSettings = Object.assign({ refreshIntervalIndex: 0 }, JSON.parse(s));
      if(!appSettings.windows) appSettings.windows = { '1d': true, '7d': true, '28d': true, '90d': true, '365d': true };
    }
  } catch(e){}

  try {
    const savedKeys = localStorage.getItem('channelDeck_apiKeys');
    if (savedKeys) {
       let parsed = JSON.parse(savedKeys);
       if (parsed && parsed.length > 0) {
          if (typeof parsed[0] === 'string') {
             // Migrate from old ['key1', 'key2'] structure to new [{name, value}] structure safely
             apiKeys = parsed.filter(k => typeof k === 'string' && k.trim() !== '').map((k, i) => ({name: `API Key ${i+1}`, value: k}));
          } else {
             apiKeys = parsed;
          }
       }
    }
  } catch(e){}

  if (!apiKeys || apiKeys.length === 0) {
     apiKeys = [{name: 'API Key 1', value: ''}];
  }

  activeKeyIndex = apiKeys.findIndex(k => k && k.value && typeof k.value === 'string' && k.value.trim() !== '');
  if (activeKeyIndex === -1) activeKeyIndex = 0;

  try {
    const c = localStorage.getItem('channelDeck_channels');
    if(c) channels = JSON.parse(c);
  } catch(e){}

  try {
    const comps = localStorage.getItem('channelDeck_competitors');
    if(comps) competitors = JSON.parse(comps);
  } catch(e){}

  const now = Date.now();
  const ONE_DAY = 86400000;

  try {
    const storedLogs = localStorage.getItem('channelDeck_logs');
    if(storedLogs) {
      activityLogs = JSON.parse(storedLogs);
      activityLogs = activityLogs.filter(log => now - log.timestamp < ONE_DAY);
    }
  } catch(e){}

  try {
    const chrt = localStorage.getItem('channelDeck_chart');
    if(chrt) {
      chartSnapshots = JSON.parse(chrt);
      if (!chartSnapshots.timestamps) {
         chartSnapshots.timestamps = chartSnapshots.labels.map(() => now);
      }

      const validIndices = chartSnapshots.timestamps.map((ts, i) => now - ts < ONE_DAY ? i : -1).filter(i => i !== -1);

      chartSnapshots.timestamps = validIndices.map(i => chartSnapshots.timestamps[i]);
      chartSnapshots.labels = validIndices.map(i => chartSnapshots.labels[i]);

      for (let id in chartSnapshots.datasets) {
         let ds = chartSnapshots.datasets[id];
         if (ds.data) {
             ds.subsData = ds.data;
             ds.viewsData = ds.data.map(()=>null);
             ds.vphData = ds.data.map(()=>null);
             ds.color = ds.borderColor || ds.color || palette[0];
             delete ds.data;
             delete ds.borderColor;
             delete ds.backgroundColor;
         }
         if (!ds.subsData) ds.subsData = [];
         if (!ds.viewsData) ds.viewsData = ds.subsData.map(()=>null);
         if (!ds.vphData) ds.vphData = ds.subsData.map(()=>null);
         if (!ds.color) ds.color = palette[0];

         if (ds.subsData) {
             ds.subsData = validIndices.map(i => ds.subsData[i]);
             ds.viewsData = validIndices.map(i => ds.viewsData[i]);
             ds.vphData = validIndices.map(i => ds.vphData[i]);
         }
      }
    }
  } catch(e){}

  try {
    const vh = localStorage.getItem('channelDeck_videoHistory');
    if (vh) videoHistory = JSON.parse(vh);
  } catch(e){}
}

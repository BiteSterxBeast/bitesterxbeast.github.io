// graph.js — Graph View page only. Depends on state.js, api.js, ui.js.

window.CD_PAGE = 'graph';

let subChart;
const chartCtx = document.getElementById('subChart').getContext('2d');

let currentGraphMetric = 'subs'; // 'subs' or 'views'
let currentViewsSubMetric = 'vph'; // 'vph' or 'total'
let currentRangeDays = 7; // 7 | 28 | 90

const rangeToggles = document.getElementById('rangeToggles');

function renderRangeToggles(){
  if (!rangeToggles) return;
  rangeToggles.innerHTML = '';
  GRAPH_RANGES.forEach(r => {
    const btn = document.createElement('button');
    btn.className = currentRangeDays === r.days ? 'primary' : 'ghost';
    btn.style.fontSize = '11px';
    btn.style.padding = '6px 12px';
    btn.innerText = r.label;
    btn.onclick = () => {
      currentRangeDays = r.days;
      if (subChart) subChart.resetZoom();
      renderRangeToggles();
      updateChart();
    };
    rangeToggles.appendChild(btn);
  });
}

const metricSubsBtn = document.getElementById('metricSubsBtn');
const metricViewsBtn = document.getElementById('metricViewsBtn');
const subMetricVphBtn = document.getElementById('subMetricVphBtn');
const subMetricTotalViewsBtn = document.getElementById('subMetricTotalViewsBtn');
const viewsSubToggles = document.getElementById('viewsSubToggles');

metricSubsBtn.onclick = () => {
    currentGraphMetric = 'subs';
    metricSubsBtn.className = 'primary';
    metricViewsBtn.className = 'ghost';
    viewsSubToggles.style.display = 'none';
    updateChart();
};
metricViewsBtn.onclick = () => {
    currentGraphMetric = 'views';
    metricViewsBtn.className = 'primary';
    metricSubsBtn.className = 'ghost';
    viewsSubToggles.style.display = 'flex';
    updateChart();
};

subMetricVphBtn.onclick = () => {
    currentViewsSubMetric = 'vph';
    subMetricVphBtn.className = 'primary';
    subMetricTotalViewsBtn.className = 'ghost';
    updateChart();
};

subMetricTotalViewsBtn.onclick = () => {
    currentViewsSubMetric = 'total';
    subMetricTotalViewsBtn.className = 'primary';
    subMetricVphBtn.className = 'ghost';
    updateChart();
};

function renderGraphToggles() {
  const container = document.getElementById('graphToggles');
  if (!container) return;
  container.innerHTML = '';

  channels.forEach(ch => {
    if (ch.showOnGraph === undefined) ch.showOnGraph = true;

    const btn = document.createElement('button');
    btn.className = ch.showOnGraph ? 'primary' : 'ghost';
    btn.innerText = cache[ch.id]?.data?.title || ch.addedAs;

    btn.onclick = () => {
      ch.showOnGraph = !ch.showOnGraph;
      saveChannels();
      renderGraphToggles();
      updateChart();
    };
    container.appendChild(btn);
  });
}

document.getElementById('resetZoomBtn').onclick = () => {
  if (subChart) subChart.resetZoom();
};

// Snapshots only exist for hours the page was actually open. A run of nulls
// means "nobody was watching", not "the count dropped to nothing" — so for
// cumulative metrics the last known reading is carried forward across the gap.
// That draws a flat line through downtime and a step at the next real reading,
// instead of chopping the series into disconnected islands. Nulls before a
// channel's first ever reading stay null so it isn't stretched backwards.
function carryForwardGaps(arr){
  const values = arr.slice();
  const filled = new Array(values.length).fill(false);
  let last = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      values[i] = last;            // stays null until the first real reading
      filled[i] = last !== null;
    } else {
      last = v;
    }
  }
  return { values, filled };
}

function updateChart() {
  // Slice the stored history down to the selected range. Everything outside it
  // stays in localStorage — this only changes what's drawn.
  const cutoff = Date.now() - currentRangeDays * 86400000;
  const stamps = chartSnapshots.timestamps || [];
  const visible = [];
  for (let i = 0; i < stamps.length; i++) {
    if (stamps[i] >= cutoff) visible.push(i);
  }

  const labels = visible.map(i => formatSnapshotLabel(stamps[i], currentRangeDays));

  const activeDatasets = channels
    .filter(ch => ch.showOnGraph !== false)
    .map(ch => {
        const ds = chartSnapshots.datasets[ch.id];
        if(!ds) return null;
        const rgb = hexToRgb(ds.color || '#34D6C4');

        let targetData;
        if (currentGraphMetric === 'subs') targetData = ds.subsData;
        else if (currentGraphMetric === 'views' && currentViewsSubMetric === 'total') targetData = ds.viewsData;
        else targetData = ds.vphData;

        const sliced = visible.map(i => (targetData && targetData[i] !== undefined) ? targetData[i] : null);

        // Subs and total views only ever move forward, so a gap can be held
        // flat at the last known value. VPH is a rate, not a running total —
        // holding a stale rate across downtime would invent views that were
        // never measured, so it just gets a straight connecting line instead.
        const isCumulative = currentGraphMetric === 'subs'
          || (currentGraphMetric === 'views' && currentViewsSubMetric === 'total');
        const { values: drawn, filled } = isCumulative
          ? carryForwardGaps(sliced)
          : { values: sliced, filled: new Array(sliced.length).fill(false) };

        // 28d/90d can hold hundreds of hourly points — drawing a marker on
        // each one turns the line into a solid band, so markers only appear
        // on hover at the wider ranges. Carried-forward hours never get a
        // marker: there was no reading there to point at.
        const baseRadius = currentRangeDays <= 7 ? 2 : 0;

        return {
           label: ds.label,
           data: drawn,
           borderColor: ds.color || '#34D6C4',
           backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
           fill: true,
           tension: 0,
           borderWidth: 2,
           pointRadius: filled.map(f => f ? 0 : baseRadius),
           pointHoverRadius: 5,
           pointHitRadius: 15,
           spanGaps: !isCumulative
        };
    }).filter(Boolean);

  if (!subChart) {
    subChart = new Chart(chartCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: activeDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          y: { type: 'linear', ticks: { color: '#8A93A1' }, grid: { color: '#262B33' } },
          x: {
            ticks: { color: '#8A93A1', maxTicksLimit: 12, autoSkip: true },
            grid: { color: '#262B33' }
          }
        },
        plugins: {
          legend: { labels: { color: '#E8EAED', font: { family: 'Inter' } } },
          tooltip: { mode: 'index', intersect: false },
          zoom: {
            pan: {
              enabled: true,
              mode: 'x'
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x'
            }
          }
        }
      }
    });
  } else {
    subChart.data.labels = labels;
    subChart.data.datasets = activeDatasets;
    subChart.update();
  }
}

// --- Reset Graph ---
const resetGraphBtn = document.getElementById('resetGraphBtn');
const resetGraphOverlay = document.getElementById('resetGraphOverlay');
const resetGraphCancel = document.getElementById('resetGraphCancel');
const resetGraphConfirm = document.getElementById('resetGraphConfirm');

if (resetGraphBtn) resetGraphBtn.onclick = () => {
  resetGraphOverlay.style.display = 'flex';
};
if (resetGraphCancel) resetGraphCancel.onclick = () => {
  resetGraphOverlay.style.display = 'none';
};
if (resetGraphConfirm) resetGraphConfirm.onclick = () => {
  clearChartSnapshots();
  if (subChart) subChart.resetZoom();
  recordChartSnapshot(); // start a fresh series from the current hour
  updateChart();
  resetGraphOverlay.style.display = 'none';
};

window.refreshUI = () => { renderGraphToggles(); updateChart(); };

wireAddChannelModal();
renderRangeToggles();
initCommonPage(() => { renderGraphToggles(); updateChart(); });

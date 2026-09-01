// graph.js — Graph View page only. Depends on state.js, api.js, ui.js.

let subChart;
const chartCtx = document.getElementById('subChart').getContext('2d');

let currentGraphMetric = 'subs'; // 'subs' or 'views'
let currentViewsSubMetric = 'vph'; // 'vph' or 'total'

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

function updateChart() {
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

        return {
           label: ds.label,
           data: targetData,
           borderColor: ds.color || '#34D6C4',
           backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
           fill: true,
           tension: 0,
           borderWidth: 2,
           pointRadius: 2,
           pointHoverRadius: 5,
           pointHitRadius: 15,
           spanGaps: true
        };
    }).filter(Boolean);

  if (!subChart) {
    subChart = new Chart(chartCtx, {
      type: 'line',
      data: {
        labels: chartSnapshots.labels,
        datasets: activeDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { type: 'linear', ticks: { color: '#8A93A1' }, grid: { color: '#262B33' } },
          x: { ticks: { color: '#8A93A1' }, grid: { color: '#262B33' } }
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
    subChart.data.labels = chartSnapshots.labels;
    subChart.data.datasets = activeDatasets;
    subChart.update();
  }
}

window.refreshUI = () => { renderGraphToggles(); updateChart(); };

wireAddChannelModal();
initCommonPage(() => { renderGraphToggles(); updateChart(); });

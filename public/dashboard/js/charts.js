/**
 * Chart.js Wrappers
 * Consistent, themed chart factory functions for the analytics dashboard.
 */

const Charts = (() => {
  // ── Default Chart.js Globals ──────────────────────────────
  const DEFAULTS = {
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#9b9bbb',
    primaryColor: '#6366f1',
    accentColor: '#06b6d4',
    successColor: '#10b981',
    warningColor: '#f59e0b',
    dangerColor: '#ef4444',
    gridColor: 'rgba(255,255,255,0.04)',
    colors: [
      '#6366f1', '#06b6d4', '#10b981', '#f59e0b',
      '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
      '#f97316', '#a78bfa', '#34d399', '#fb7185',
    ],
  };

  function getGlobalDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          labels: {
            color: '#9b9bbb',
            font: { family: DEFAULTS.fontFamily, size: 12 },
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
        tooltip: {
          backgroundColor: '#1c1c28',
          titleColor: '#f1f1f8',
          bodyColor: '#9b9bbb',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: { family: DEFAULTS.fontFamily, weight: '600' },
          bodyFont: { family: DEFAULTS.fontFamily },
        },
      },
      scales: {
        x: {
          grid: { color: DEFAULTS.gridColor, drawBorder: false },
          ticks: { color: '#60607a', font: { family: DEFAULTS.fontFamily, size: 11 } },
          border: { color: 'transparent' },
        },
        y: {
          grid: { color: DEFAULTS.gridColor, drawBorder: false },
          ticks: { color: '#60607a', font: { family: DEFAULTS.fontFamily, size: 11 } },
          border: { color: 'transparent' },
          beginAtZero: true,
        },
      },
    };
  }

  const _instances = {};

  function destroy(id) {
    if (_instances[id]) {
      _instances[id].destroy();
      delete _instances[id];
    }
  }

  function create(id, type, data, options = {}) {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const merged = Chart.helpers.merge(getGlobalDefaults(), options);
    const instance = new Chart(ctx, { type, data, options: merged });
    _instances[id] = instance;
    return instance;
  }

  // ── Gradient Helper ───────────────────────────────────────
  function createGradient(ctx, color, alpha1 = 0.3, alpha2 = 0) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, color.replace(')', `,${alpha1})`).replace('rgb', 'rgba'));
    gradient.addColorStop(1, color.replace(')', `,${alpha2})`).replace('rgb', 'rgba'));
    return gradient;
  }

  // ── Chart Types ───────────────────────────────────────────

  /**
   * Area Chart (line with gradient fill)
   */
  function area(id, labels, datasets, options = {}) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');

    const styledDatasets = datasets.map((ds, i) => {
      const color = ds.color || DEFAULTS.colors[i];
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, color + '40');
      gradient.addColorStop(1, color + '00');

      return {
        ...ds,
        fill: true,
        backgroundColor: gradient,
        borderColor: color,
        borderWidth: 2,
        pointBackgroundColor: color,
        pointBorderColor: 'transparent',
        pointRadius: 3,
        pointHoverRadius: 6,
        tension: 0.4,
      };
    });

    return create(id, 'line', { labels, datasets: styledDatasets }, {
      plugins: { legend: { display: datasets.length > 1 } },
      ...options,
    });
  }

  /**
   * Bar Chart
   */
  function bar(id, labels, datasets, options = {}) {
    const styledDatasets = datasets.map((ds, i) => ({
      ...ds,
      backgroundColor: ds.color || DEFAULTS.colors[i],
      borderRadius: 6,
      borderSkipped: false,
    }));
    return create(id, 'bar', { labels, datasets: styledDatasets }, options);
  }

  /**
   * Horizontal Bar Chart
   */
  function horizontalBar(id, labels, data, color, options = {}) {
    return create(id, 'bar', {
      labels,
      datasets: [{ data, backgroundColor: color || DEFAULTS.primaryColor + 'cc', borderRadius: 4 }],
    }, {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      ...options,
    });
  }

  /**
   * Donut / Pie Chart
   */
  function donut(id, labels, data, options = {}) {
    return create(id, 'doughnut', {
      labels,
      datasets: [{
        data,
        backgroundColor: DEFAULTS.colors.slice(0, data.length).map(c => c + 'cc'),
        borderColor: DEFAULTS.colors.slice(0, data.length),
        borderWidth: 1,
        hoverOffset: 8,
      }],
    }, {
      cutout: '68%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#9b9bbb',
            font: { size: 11 },
            padding: 12,
          },
        },
        ...options.plugins,
      },
      ...options,
    });
  }

  /**
   * Line Chart
   */
  function line(id, labels, datasets, options = {}) {
    const styledDatasets = datasets.map((ds, i) => ({
      ...ds,
      borderColor: ds.color || DEFAULTS.colors[i],
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      fill: false,
      tension: 0.3,
    }));
    return create(id, 'line', { labels, datasets: styledDatasets }, options);
  }

  /**
   * Radial Gauge (using doughnut)
   */
  function gauge(id, value, max, color) {
    const remaining = Math.max(0, max - value);
    return create(id, 'doughnut', {
      datasets: [{
        data: [value, remaining],
        backgroundColor: [color || DEFAULTS.primaryColor, '#1c1c28'],
        borderWidth: 0,
      }],
    }, {
      cutout: '75%',
      rotation: -90,
      circumference: 180,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    });
  }

  /**
   * Update chart data without full re-create
   */
  function update(id, labels, datasets) {
    const chart = _instances[id];
    if (!chart) return;
    if (labels) chart.data.labels = labels;
    if (datasets) {
      datasets.forEach((ds, i) => {
        if (chart.data.datasets[i]) {
          Object.assign(chart.data.datasets[i], ds);
        }
      });
    }
    chart.update('active');
  }

  return { area, bar, horizontalBar, donut, line, gauge, update, destroy, create, DEFAULTS };
})();

window.Charts = Charts;

// Library-wide scheduling summaries, rendered only from the backend snapshot.
const states = [['new', 'New'], ['learning', 'Learning'], ['review', 'Review'], ['relearning', 'Relearning']];
const svgNamespace = 'http://www.w3.org/2000/svg';
const count = value => Number.isFinite(value) && value > 0 ? value : 0;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function dateLabels(day) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!parts) return { weekday: '', date: day || '', full: day || '' };
  // Day keys are civil dates, not UTC timestamps. Local noon also avoids DST gaps.
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    full: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}
function computeStreak(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let streak = 0;
  let i = rows.length - 1;
  // Allow an ongoing streak if yesterday had reviews even before today's first review.
  if (count(rows[i]?.count) === 0) i--;
  for (; i >= 0; i--) {
    if (count(rows[i]?.count) > 0) streak++;
    else break;
  }
  return streak;
}
function heatLevel(value, max) {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function mountDashboard({ container, signal }) {
  const root = element('section', 'fc-dashboard'); root.setAttribute('aria-label', 'Spaced repetition');
  const head = element('div', 'fc-dashboard-head');
  const heading = element('h2', 'fc-dashboard-heading', 'Spaced repetition');
  const loading = element('p', 'fc-muted fc-dashboard-loading', 'Loading statistics…'); loading.setAttribute('role', 'status');
  head.append(heading, loading);

  // Row 1 inside dashboard: Full-width Onigiri ACTIVITY heatmap card (pure HTML, zero SVG, zero interactive controls).
  const heatCard = element('div', 'fc-bento-card fc-heatmap-card');
  heatCard.setAttribute('aria-hidden', 'true');
  const heatHead = element('div', 'fc-card-head');
  const heatTitle = element('span', 'fc-card-eyebrow', 'Activity');
  const heatControls = element('div', 'fc-heat-controls');
  const streakChip = element('span', 'fc-streak-chip');
  const streakDot = element('span', 'fc-streak-dot');
  const streakText = element('span', 'fc-streak-text', '0 day streak');
  streakChip.append(streakDot, streakText);
  const rangeChip = element('span', 'fc-range-chip', '14 days');
  heatControls.append(streakChip, rangeChip);
  heatHead.append(heatTitle, heatControls);
  const heatCells = element('div', 'fc-heatmap-cells');
  const heatFoot = element('div', 'fc-heatmap-foot');
  const heatSummary = element('span', 'fc-heat-summary', '0 reviews');
  const heatScale = element('div', 'fc-heatmap-scale');
  heatScale.append(element('span', '', 'Less'));
  for (let level = 0; level <= 4; level++) {
    const swatch = element('span', 'fc-heatmap-swatch');
    swatch.dataset.level = String(level);
    heatScale.append(swatch);
  }
  heatScale.append(element('span', '', 'More'));
  heatFoot.append(heatSummary, heatScale);
  heatCard.append(heatHead, heatCells, heatFoot);

  // Row 2 inside dashboard: Lower Bento grid (Left: Onigiri STATS card; Right: 2 required SVG charts).
  const lowerGrid = element('div', 'fc-bento-lower');

  // Onigiri STATS card (CSS donut + In Progress/Mastered legend + proportional bar + tinted pill tiles + Unseen/Total footer).
  const stateCard = element('div', 'fc-bento-card fc-state-card');
  const stateHead = element('div', 'fc-card-head');
  const stateTitle = element('h3', '', 'Stats');
  const scopePill = element('span', 'fc-scope-pill', 'All Decks');
  scopePill.setAttribute('aria-hidden', 'true');
  stateHead.append(stateTitle, scopePill);

  const donutTop = element('div', 'fc-donut-top');
  donutTop.setAttribute('aria-hidden', 'true');
  const donutWrap = element('div', 'fc-donut-wrap');
  const donutRing = element('div', 'fc-donut-ring');
  const donutCore = element('div', 'fc-donut-core');
  donutWrap.append(donutRing, donutCore);

  const donutMeta = element('div', 'fc-donut-meta');
  const donutHeadline = element('div', 'fc-donut-headline');
  const donutTotal = element('strong', 'fc-donut-total', '0');
  const donutUnit = element('span', 'fc-donut-unit', 'total');
  donutHeadline.append(donutTotal, donutUnit);
  const donutLegend = element('div', 'fc-donut-legend');
  const inProgItem = element('span', 'fc-donut-leg-item');
  inProgItem.append(element('span', 'fc-donut-dot is-progress'), element('span', '', 'In Progress'));
  const masteredItem = element('span', 'fc-donut-leg-item');
  masteredItem.append(element('span', 'fc-donut-dot is-mastered'), element('span', '', 'Mastered'));
  donutLegend.append(inProgItem, masteredItem);
  donutMeta.append(donutHeadline, donutLegend);
  donutTop.append(donutWrap, donutMeta);

  const stateBar = element('div', 'fc-state-bar'); stateBar.setAttribute('aria-hidden', 'true');
  const legend = element('ul', 'fc-state-legend');
  const statsFooter = element('div', 'fc-stats-footer');
  statsFooter.setAttribute('aria-hidden', 'true');
  const unseenMeta = element('span', 'fc-stats-foot-item');
  const unseenVal = element('strong', '', '0');
  unseenMeta.append(document.createTextNode('Unseen '), unseenVal);
  const totalMeta = element('span', 'fc-stats-foot-item is-total');
  const totalVal = element('strong', '', '0');
  totalMeta.append(document.createTextNode('Total '), totalVal);
  statsFooter.append(unseenMeta, totalMeta);
  const stateCaption = element('p', 'fc-chart-caption', 'Active propositions with at least one cue.');
  stateCard.append(stateHead, donutTop, stateBar, legend, statsFooter, stateCaption);

  const charts = element('div', 'fc-chart-grid');
  lowerGrid.append(stateCard, charts);
  root.append(head, heatCard, lowerGrid);

  const stateNodes = states.map(([key, label]) => {
    const segment = element('span', 'fc-state-segment'); segment.dataset.state = key; stateBar.append(segment);
    const item = element('li'); item.dataset.state = key;
    const name = element('span', 'fc-state-name', label), value = element('strong', 'fc-state-val', '0');
    item.append(name, document.createTextNode(' '), value); legend.append(item);
    return { key, label, segment, value };
  });
  function chart(kind, title, caption) {
    const figure = element('figure', 'fc-chart fc-bento-card');
    figure.dataset.chart = kind;
    const header = element('div', 'fc-card-head');
    const chartTitle = element('h3', '', title);
    const kpi = element('span', 'fc-card-kpi', '0');
    kpi.setAttribute('aria-hidden', 'true');
    header.append(chartTitle, kpi);
    const scroll = element('div', 'fc-chart-scroll');
    const svg = svgElement('svg', { class: 'fc-chart-svg', role: 'img', width: '100%', preserveAspectRatio: 'xMidYMid meet' });
    scroll.append(svg); figure.append(header, scroll, element('figcaption', 'fc-chart-caption', caption)); charts.append(figure);
    return { title, svg, kpi };
  }
  const due = chart('due', 'Scheduled due', 'Current scheduled due dates.');
  const activity = chart('activity', 'Scheduled reviews', 'Scheduled review ratings recorded each day.');
  let disposed = false;

  function renderDonut(counts, total) {
    const unseen = count(counts?.new);
    const inProgress = count(counts?.learning) + count(counts?.relearning);
    const mastered = count(counts?.review);
    donutTotal.textContent = String(total);
    unseenVal.textContent = String(unseen);
    totalVal.textContent = String(total);
    if (!total) {
      donutRing.style.background = 'var(--fc-donut-empty)';
      return;
    }
    const stops = [];
    let cursor = 0;
    const segments = [
      [mastered, 'var(--fc-green)'],
      [inProgress, 'var(--fc-blue)'],
      [unseen, 'var(--fc-donut-empty)'],
    ];
    for (const [value, color] of segments) {
      if (!value) continue;
      const start = (cursor / total) * 360;
      cursor += value;
      const end = (cursor / total) * 360;
      stops.push(`${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
    }
    donutRing.style.background = stops.length ? `conic-gradient(${stops.join(', ')})` : 'var(--fc-donut-empty)';
  }

  function renderHeatmap(values) {
    const rows = Array.isArray(values) ? values : [];
    const total = rows.reduce((sum, row) => sum + count(row.count), 0);
    const max = Math.max(1, ...rows.map(row => count(row.count)));
    const streak = computeStreak(rows);
    heatSummary.textContent = `${total} ${total === 1 ? 'review' : 'reviews'} in 14 days`;
    streakText.textContent = `${streak} day streak`;
    streakChip.dataset.active = streak > 0 ? 'true' : 'false';
    heatCells.replaceChildren();
    rows.forEach((row, index) => {
      const val = count(row.count);
      const isToday = index === rows.length - 1;
      const labels = dateLabels(row.day);
      const cell = element('div', `fc-heatmap-cell${isToday ? ' is-today' : ''}`);
      cell.dataset.level = String(heatLevel(val, max));
      cell.dataset.tooltip = `${isToday ? 'Today' : labels.full} · ${val} ${val === 1 ? 'review' : 'reviews'}`;
      const shape = element('span', 'fc-heatmap-shape');
      const dayLabel = element('span', 'fc-heatmap-day', isToday ? 'Today' : labels.weekday.replace(/\.$/, ''));
      cell.append(shape, dayLabel);
      heatCells.append(cell);
    });
  }

  function renderChart(chart, values, kind, width) {
    const rows = Array.isArray(values) ? values : [];
    const total = rows.reduce((sum, row) => sum + count(row.count), 0);
    chart.kpi.textContent = String(total);
    const step = width / Math.max(rows.length, 1), baseline = 138;
    const maximum = Math.max(1, ...rows.map(row => count(row.count)));
    chart.svg.replaceChildren(); chart.svg.setAttribute('viewBox', `0 0 ${width} 196`);
    // Subtle dotted gridlines placed outside <g> bar groups to preserve bar-group contracts.
    for (const y of [28, 64, 101, baseline]) {
      chart.svg.append(svgElement('line', { class: y === baseline ? 'fc-chart-baseline' : 'fc-chart-gridline', x1: 8, x2: width - 8, y1: y, y2: y }));
    }
    const descriptions = [];
    for (const [index, row] of rows.entries()) {
      const labels = dateLabels(row.day);
      const special = kind === 'due' && row.day === null ? 'Overdue' : (kind === 'due' && index === 1) || (kind === 'activity' && index === rows.length - 1) ? 'Today' : '';
      const label = special || (kind === 'due' ? labels.weekday : labels.date);
      const detail = special || labels.full, value = count(row.count);
      descriptions.push(`${detail}: ${value}`);
      const group = svgElement('g', { 'data-day': row.day ?? 'overdue', class: 'fc-chart-col' });
      const x = step * (index + .5), height = Math.max(1, value / maximum * 108);
      const bucket = kind === 'activity' ? 'activity' : special === 'Overdue' ? 'overdue' : special === 'Today' ? 'today' : 'future';
      const barWidth = Math.min(30, step * .56);
      // Palette hooks belong to bars, never their groups or foreground labels.
      group.append(svgElement('rect', { class: 'fc-chart-bar', 'data-bucket': bucket, 'data-zero': value === 0 ? 'true' : 'false', x: x - barWidth / 2, y: baseline - height, width: barWidth, height, fill: 'currentColor', opacity: value === 0 ? '.25' : '.85', rx: value === 0 ? 1 : 6 }));
      group.append(svgElement('text', { class: 'fc-chart-count', x, y: baseline - height - 8, 'text-anchor': 'middle', 'font-size': 12.5, fill: 'currentColor' }, String(value)));
      const dateText = svgElement('text', { class: 'fc-chart-label', x, y: 160, 'text-anchor': 'middle', 'font-size': kind === 'activity' ? 10.5 : 11.5, fill: 'currentColor' });
      dateText.append(svgElement('tspan', { x }, label));
      if (kind === 'due' && !special) dateText.append(svgElement('tspan', { class: 'fc-chart-date', x, dy: 15 }, labels.date));
      group.append(dateText); chart.svg.append(group);
    }
    const accessible = `${chart.title}: ${descriptions.length ? descriptions.join('; ') : 'No data available.'}`;
    chart.svg.setAttribute('aria-label', accessible);
  }
  function update(statistics) {
    if (disposed || signal.aborted) return;
    loading.hidden = statistics != null;
    const total = states.reduce((sum, [key]) => sum + count(statistics?.states?.[key]), 0);
    for (const node of stateNodes) {
      const value = count(statistics?.states?.[node.key]);
      node.value.textContent = String(value); node.segment.style.width = `${total ? value / total * 100 : 0}%`;
      node.segment.title = `${node.label}: ${value}`;
    }
    renderDonut(statistics?.states, total);
    renderHeatmap(statistics?.activity);
    // Equal-width cards must share SVG proportions so baselines and captions align.
    const bucketCount = Math.max(14, Array.isArray(statistics?.due) ? statistics.due.length : 0, Array.isArray(statistics?.activity) ? statistics.activity.length : 0);
    const width = bucketCount * 60;
    renderChart(due, statistics?.due, 'due', width); renderChart(activity, statistics?.activity, 'activity', width);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; signal.removeEventListener('abort', dispose); root.remove();
  }
  if (signal.aborted) dispose();
  else { container.append(root); signal.addEventListener('abort', dispose, { once: true }); update(); }
  return { update, dispose };
}

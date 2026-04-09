// ── Constants ─────────────────────────────────────────────────
const ROW_H    = 52;
const HEADER_H = 56;
const COL_W    = 100;
const BAR_H    = 30;
const BAR_R    = 6;
const BAR_PAD  = (ROW_H - BAR_H) / 2;
const HANDLE_W = 10;
const MIN_DAYS = 7;

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const COLORS = [
  '#4F8EF7','#9B6CF7','#6BC47A','#F7756C',
  '#F7C46C','#6CC8F7','#F79B6C','#F76CAF',
];

// ── Date helpers ──────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function dateToPixel(date, tl) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const dim = new Date(y, m + 1, 0).getDate();
  const off = (y - tl.startYear) * 12 + (m - tl.startMonth);
  return (off + (d - 1) / dim) * COL_W;
}
function pixelToDate(px, tl) {
  const fm = px / COL_W;
  const totalM = tl.startYear * 12 + tl.startMonth + fm;
  const y = Math.floor(totalM / 12);
  const m = ((Math.floor(totalM) % 12) + 12) % 12;
  const frac = fm - Math.floor(fm);
  const dim = new Date(y, m + 1, 0).getDate();
  const day = Math.max(1, Math.min(dim, Math.round(frac * dim) + 1));
  return new Date(y, m, day);
}
// Returns {sx, ex, w} — start pixel, end pixel (inclusive of last day), width
function barPx(task, tl) {
  const sx = dateToPixel(parseDate(task.startDate), tl);
  const ex = dateToPixel(addDays(parseDate(task.endDate), 1), tl);
  return { sx, ex, w: ex - sx };
}
function monthDiff(s, e) {
  return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}

// ── State ─────────────────────────────────────────────────────
let tasks       = loadTasks();
let checkpoints = loadCheckpoints();
let editingId   = null;
let selColor    = COLORS[0];
let showToday   = true;
let drag        = null;

function loadTasks() {
  const raw = JSON.parse(localStorage.getItem('ganttflow') || '[]');
  return raw.map(t => {
    if (t.startDate && t.endDate) return t;
    // Migrate old month-based format
    const s = new Date(t.startYear, t.startMonth, 1);
    const e = new Date(t.startYear, t.startMonth + t.duration, 0);
    return { id: t.id, name: t.name, startDate: fmtDate(s), endDate: fmtDate(e), color: t.color };
  });
}

function loadCheckpoints() {
  return JSON.parse(localStorage.getItem('ganttflow_checkpoints') || '[]');
}
function saveCheckpoints() {
  localStorage.setItem('ganttflow_checkpoints', JSON.stringify(checkpoints));
}

// ── DOM refs ──────────────────────────────────────────────────
const emptyState     = document.getElementById('emptyState');
const ganttWrapper   = document.getElementById('ganttWrapper');
const taskList       = document.getElementById('taskList');
const svgContainer   = document.getElementById('svgContainer');
const ganttChartArea = document.getElementById('ganttChartArea');
const fName          = document.getElementById('fName');
const fMonth         = document.getElementById('fMonth');
const fYear          = document.getElementById('fYear');
const fDuration      = document.getElementById('fDuration');
const colorPicker    = document.getElementById('colorPicker');
const submitBtn      = document.getElementById('submitBtn');
const cancelBtn      = document.getElementById('cancelBtn');
const formMsg        = document.getElementById('formMsg');
const exportBtn      = document.getElementById('exportBtn');
const copyBtn        = document.getElementById('copyBtn');
const todayBtn       = document.getElementById('todayBtn');
const toastEl        = document.getElementById('toast');

// Checkpoint modal refs
const addCheckpointBtn = document.getElementById('addCheckpointBtn');
const cpOverlay      = document.getElementById('cpOverlay');
const cpCloseBtn     = document.getElementById('cpCloseBtn');
const cpName         = document.getElementById('cpName');
const cpMsg          = document.getElementById('cpMsg');
const cpSubmitBtn    = document.getElementById('cpSubmitBtn');
const cpCancelBtn    = document.getElementById('cpCancelBtn');

// Checkpoint placement state
let cpPlacing   = null;   // { name } when in placement mode
let cpDragging  = null;   // { id, tl, chartRect } when dragging a checkpoint

// ── Init ──────────────────────────────────────────────────────
function init() {
  const now = new Date();
  fYear.value  = now.getFullYear();
  fMonth.value = now.getMonth();

  COLORS.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    s.style.background = c;
    s.style.setProperty('--sw', c);
    s.addEventListener('click', () => pickColor(c));
    colorPicker.appendChild(s);
  });

  submitBtn.addEventListener('click', handleSubmit);
  cancelBtn.addEventListener('click', cancelEdit);
  exportBtn.addEventListener('click', exportPNG);
  copyBtn.addEventListener('click', copyChart);
  todayBtn.addEventListener('click', () => {
    showToday = !showToday;
    todayBtn.classList.toggle('active', showToday);
    if (tasks.length) renderChart();
  });

  // Checkpoint modal
  addCheckpointBtn.addEventListener('click', openCheckpointModal);
  cpCloseBtn.addEventListener('click', closeCheckpointModal);
  cpCancelBtn.addEventListener('click', closeCheckpointModal);
  cpSubmitBtn.addEventListener('click', handleAddCheckpoint);
  cpOverlay.addEventListener('click', e => { if (e.target === cpOverlay) closeCheckpointModal(); });
  cpName.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddCheckpoint(); });

  [fName, fYear, fDuration].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); })
  );

  ganttChartArea.addEventListener('scroll', () => {
    taskList.scrollTop = ganttChartArea.scrollTop;
  });

  // Drag: mousedown via delegation on SVG, move/up on document
  svgContainer.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // Checkpoint click to delete
  svgContainer.addEventListener('click', e => {
    // If in placement mode, place checkpoint
    if (cpPlacing) {
      const tl = getTimeline();
      const px = e.clientX - ganttChartArea.getBoundingClientRect().left + ganttChartArea.scrollLeft;
      const date = pixelToDate(Math.max(0, Math.min(tl.numMonths * COL_W, px)), tl);
      checkpoints.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        name: cpPlacing.name,
        date: fmtDate(date),
      });
      saveCheckpoints();
      exitPlacingMode();
      render();
      showToast('Checkpoint placed');
    }
  });

  // Right-click context menu on checkpoints
  svgContainer.addEventListener('contextmenu', e => {
    const hit = e.target.closest('.cp-hit');
    if (!hit) return;
    e.preventDefault();
    showCpContextMenu(hit.dataset.cp, e.clientX, e.clientY);
  });

  // Checkpoint drag start
  svgContainer.addEventListener('mousedown', e => {
    const hit = e.target.closest('.cp-hit');
    if (!hit || cpPlacing) return;
    // Left click only
    if (e.button !== 0) return;
    e.preventDefault();
    const cpId = hit.dataset.cp;
    const cp = checkpoints.find(c => c.id === cpId);
    if (!cp) return;
    cpDragging = {
      id: cpId,
      tl: getTimeline(),
      chartRect: ganttChartArea.getBoundingClientRect(),
    };
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    svgContainer.classList.add('dragging');
  });

  // Checkpoint drag move/end on document
  document.addEventListener('mousemove', onCpDragMove);
  document.addEventListener('mouseup', onCpDragEnd);

  // Escape to cancel placement mode
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cpPlacing) exitPlacingMode();
    if (e.key === 'Escape') closeCpContextMenu();
  });

  // Close context menu on click outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.cp-context-menu')) closeCpContextMenu();
  });

  render();
}

// ── Color ─────────────────────────────────────────────────────
function pickColor(color) {
  selColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.style.backgroundColor === color);
  });
}

// ── CRUD ──────────────────────────────────────────────────────
function handleSubmit() {
  const name     = fName.value.trim();
  const month    = parseInt(fMonth.value);
  const year     = parseInt(fYear.value);
  const duration = parseInt(fDuration.value);

  if (!name)                                      return err('Task name is required.');
  if (isNaN(year) || year < 2020 || year > 2040)  return err('Enter a valid year (2020–2040).');
  if (isNaN(duration) || duration < 1)             return err('Duration must be at least 1 month.');
  clearErr();

  const startDate = fmtDate(new Date(year, month, 1));
  const endDate   = fmtDate(new Date(year, month + duration, 0)); // last day of last month

  if (editingId) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) tasks[idx] = { ...tasks[idx], name, startDate, endDate, color: selColor };
    editingId = null;
    cancelBtn.style.display = 'none';
    submitBtn.textContent = 'Add Task';
  } else {
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name, startDate, endDate, color: selColor,
    });
    const next = (COLORS.indexOf(selColor) + 1) % COLORS.length;
    pickColor(COLORS[next]);
  }
  save(); clearForm(); render();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  if (editingId === id) cancelEdit();
  save(); render();
}

function startEditTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editingId = id;
  const s = parseDate(t.startDate);
  fName.value     = t.name;
  fMonth.value    = s.getMonth();
  fYear.value     = s.getFullYear();
  fDuration.value = monthDiff(s, parseDate(t.endDate));
  pickColor(t.color);
  submitBtn.textContent   = 'Update Task';
  cancelBtn.style.display = '';
  fName.focus();
}

function cancelEdit() {
  editingId = null; clearForm();
  cancelBtn.style.display = 'none';
  submitBtn.textContent   = 'Add Task';
}

// ── Helpers ───────────────────────────────────────────────────
function save()      { localStorage.setItem('ganttflow', JSON.stringify(tasks)); }
function clearForm() { fName.value = ''; fDuration.value = ''; clearErr(); }
function err(msg)    { formMsg.textContent = msg; formMsg.style.display = ''; }
function clearErr()  { formMsg.textContent = ''; formMsg.style.display = 'none'; }
function esc(s)      { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function totalToDate(total) {
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

// ── Timeline ──────────────────────────────────────────────────
function getTimeline() {
  if (!tasks.length) {
    const now = new Date();
    return { startYear: now.getFullYear(), startMonth: now.getMonth(), numMonths: 12 };
  }
  let minTotal = Infinity, maxTotal = -Infinity;
  tasks.forEach(t => {
    const s = parseDate(t.startDate);
    const e = parseDate(t.endDate);
    const sT = s.getFullYear() * 12 + s.getMonth();
    const eT = e.getFullYear() * 12 + e.getMonth();
    if (sT < minTotal) minTotal = sT;
    if (eT > maxTotal) maxTotal = eT;
  });
  checkpoints.forEach(cp => {
    const d = parseDate(cp.date);
    const cT = d.getFullYear() * 12 + d.getMonth();
    if (cT < minTotal) minTotal = cT;
    if (cT > maxTotal) maxTotal = cT;
  });
  const startTotal = minTotal - 1;
  const endTotal   = maxTotal + 2;
  const { year: startYear, month: startMonth } = totalToDate(startTotal);
  return { startYear, startMonth, numMonths: endTotal - startTotal + 1 };
}

function buildYearGroups(tl) {
  const groups = [];
  let curY = null, startCol = 0, count = 0;
  for (let i = 0; i < tl.numMonths; i++) {
    const { year } = totalToDate(tl.startYear * 12 + tl.startMonth + i);
    if (year !== curY) {
      if (curY !== null) groups.push({ year: curY, startCol, count });
      curY = year; startCol = i; count = 1;
    } else count++;
  }
  if (curY !== null) groups.push({ year: curY, startCol, count });
  return groups;
}

// ── Render ────────────────────────────────────────────────────
function render() {
  if (!tasks.length) {
    emptyState.style.display   = '';
    ganttWrapper.style.display = 'none';
    return;
  }
  emptyState.style.display   = 'none';
  ganttWrapper.style.display = '';
  renderSidebar();
  renderChart();
}

function renderSidebar() {
  taskList.innerHTML = '';
  tasks.forEach(t => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `
      <div class="task-dot" style="background:${t.color}"></div>
      <span class="task-name" title="${esc(t.name)}">${esc(t.name)}</span>
      <div class="task-actions">
        <button class="icon-btn edit" title="Edit task">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn del" title="Delete task">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>`;
    row.querySelector('.edit').addEventListener('click', () => startEditTask(t.id));
    row.querySelector('.del').addEventListener('click', () => deleteTask(t.id));
    taskList.appendChild(row);
  });
}

function renderChart() {
  const tl   = getTimeline();
  const svgW = tl.numMonths * COL_W;
  const CP_FOOTER = checkpoints.length ? 24 : 0;
  const svgH = HEADER_H + tasks.length * ROW_H + CP_FOOTER;

  const now      = new Date();
  const todayOff = (now.getFullYear() - tl.startYear) * 12 + (now.getMonth() - tl.startMonth);
  const dim      = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayX   = (todayOff + (now.getDate() - 1) / dim) * COL_W;
  const yrs      = buildYearGroups(tl);
  const bodyBottom = HEADER_H + tasks.length * ROW_H;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="display:block">`;

  // Defs
  s += `<defs>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.28)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>`;
  tasks.forEach((t, i) => {
    const { sx, w } = barPx(t, tl);
    const by = HEADER_H + i * ROW_H + BAR_PAD;
    s += `<clipPath id="c${t.id}"><rect x="${sx+6}" y="${by}" width="${Math.max(0,w-12)}" height="${BAR_H}"/></clipPath>`;
  });
  s += `</defs>`;

  // White base
  s += `<rect width="${svgW}" height="${svgH}" fill="#fff"/>`;

  // Columns
  for (let i = 0; i < tl.numMonths; i++) {
    const { month } = totalToDate(tl.startYear * 12 + tl.startMonth + i);
    const x = i * COL_W;
    if (i % 2 === 1) s += `<rect x="${x}" y="${HEADER_H}" width="${COL_W}" height="${tasks.length*ROW_H}" fill="#F9FAFB"/>`;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${svgH}" stroke="#F3F4F6" stroke-width="1"/>`;
    s += `<text x="${x+COL_W/2}" y="${HEADER_H-10}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="500" fill="#9CA3AF">${MONTHS_SHORT[month]}</text>`;
  }

  // Year labels
  yrs.forEach(({ year, startCol, count }) => {
    const x = startCol * COL_W, w = count * COL_W;
    if (startCol > 0) s += `<line x1="${x}" y1="0" x2="${x}" y2="${HEADER_H}" stroke="#E5E7EB" stroke-width="1"/>`;
    s += `<text x="${x+w/2}" y="22" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600" fill="#374151">${year}</text>`;
  });

  s += `<line x1="0" y1="${HEADER_H}" x2="${svgW}" y2="${HEADER_H}" stroke="#E5E7EB" stroke-width="1"/>`;
  for (let i = 1; i < tasks.length; i++) s += `<line x1="0" y1="${HEADER_H+i*ROW_H}" x2="${svgW}" y2="${HEADER_H+i*ROW_H}" stroke="#F3F4F6" stroke-width="1"/>`;

  // Today
  if (showToday && todayOff >= 0 && todayOff < tl.numMonths) {
    const tx = todayX.toFixed(1);
    s += `<line x1="${tx}" y1="${HEADER_H}" x2="${tx}" y2="${svgH}" stroke="#F59E0B" stroke-width="1.5" stroke-dasharray="4 3" opacity=".75"/>`;
    s += `<circle cx="${tx}" cy="${HEADER_H}" r="3.5" fill="#F59E0B"/>`;
    s += `<text x="${tx}" y="${HEADER_H-14}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600" fill="#F59E0B">Today</text>`;
  }

  // Checkpoints
  checkpoints.forEach(cp => {
    const cpDate = parseDate(cp.date);
    const cpOff  = (cpDate.getFullYear() - tl.startYear) * 12 + (cpDate.getMonth() - tl.startMonth);
    if (cpOff < 0 || cpOff >= tl.numMonths) return;
    const cpDim = new Date(cpDate.getFullYear(), cpDate.getMonth() + 1, 0).getDate();
    const cpX   = (cpOff + (cpDate.getDate() - 1) / cpDim) * COL_W;
    const tx    = cpX.toFixed(1);
    s += `<line id="cp-line-${cp.id}" x1="${tx}" y1="${HEADER_H}" x2="${tx}" y2="${bodyBottom}" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="6 4" opacity=".6"/>`;
    s += `<polygon id="cp-tri-${cp.id}" points="${cpX-5},${HEADER_H} ${cpX+5},${HEADER_H} ${cpX},${HEADER_H+7}" fill="#9CA3AF"/>`;
    s += `<text id="cp-label-${cp.id}" x="${tx}" y="${bodyBottom + 15}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600" fill="#6B7280">${esc(cp.name)}</text>`;
    // Invisible hit area for drag & right-click
    s += `<rect class="cp-hit" data-cp="${cp.id}" x="${cpX-12}" y="${HEADER_H}" width="24" height="${bodyBottom - HEADER_H + CP_FOOTER}" fill="transparent" style="cursor:grab"/>`;
  });

  // Bars + drag handles
  tasks.forEach((t, i) => {
    const { sx, w } = barPx(t, tl);
    const by = HEADER_H + i * ROW_H + BAR_PAD;
    const bx = sx + 1, bw = Math.max(0, w - 2);
    if (bw <= 0) return;

    // Shadow
    s += `<rect id="bs-${t.id}" x="${bx}" y="${by+2}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="rgba(0,0,0,.07)"/>`;
    // Bar
    s += `<rect id="br-${t.id}" x="${bx}" y="${by}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="${t.color}"/>`;
    // Shine
    s += `<rect id="bh-${t.id}" x="${bx}" y="${by}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="url(#shine)"/>`;
    // Label
    if (bw > 28) {
      s += `<text id="bl-${t.id}" x="${bx+bw/2}" y="${by+BAR_H/2+4.5}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="500" fill="white" clip-path="url(#c${t.id})">${esc(t.name)}</text>`;
    }

    // Drag handles (invisible hit areas)
    if (bw > 20) {
      s += `<rect class="drag-handle" data-drag="start" data-task="${t.id}" x="${bx-4}" y="${by-4}" width="${HANDLE_W}" height="${BAR_H+8}" rx="3" fill="transparent"/>`;
      s += `<rect class="drag-handle" data-drag="end" data-task="${t.id}" x="${bx+bw-HANDLE_W+4}" y="${by-4}" width="${HANDLE_W}" height="${BAR_H+8}" rx="3" fill="transparent"/>`;
    }
  });

  s += `</svg>`;
  svgContainer.innerHTML = s;
}

// ── Drag ──────────────────────────────────────────────────────
let dragTooltip = null;

function getDragTooltip() {
  if (!dragTooltip) {
    dragTooltip = document.createElement('div');
    dragTooltip.className = 'drag-tooltip';
    document.body.appendChild(dragTooltip);
  }
  return dragTooltip;
}

function onDragStart(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.drag) return;
  e.preventDefault();

  const taskId = el.dataset.task;
  const edge   = el.dataset.drag; // 'start' or 'end'
  const task   = tasks.find(t => t.id === taskId);
  if (!task) return;

  drag = {
    taskId, edge,
    tl: getTimeline(),
    chartRect: ganttChartArea.getBoundingClientRect(),
    origStart: task.startDate,
    origEnd: task.endDate,
  };

  document.body.style.cursor     = 'col-resize';
  document.body.style.userSelect = 'none';
  svgContainer.classList.add('dragging');
}

function onDragMove(e) {
  if (!drag) return;
  e.preventDefault();

  const px = e.clientX - drag.chartRect.left + ganttChartArea.scrollLeft;
  const maxPx = drag.tl.numMonths * COL_W;
  const clamped = Math.max(0, Math.min(maxPx, px));
  let newDate = pixelToDate(clamped, drag.tl);

  const task = tasks.find(t => t.id === drag.taskId);
  if (!task) return;

  if (drag.edge === 'start') {
    const limit = addDays(parseDate(task.endDate), -MIN_DAYS);
    if (newDate > limit) newDate = limit;
    task.startDate = fmtDate(newDate);
  } else {
    const limit = addDays(parseDate(task.startDate), MIN_DAYS);
    if (newDate < limit) newDate = limit;
    task.endDate = fmtDate(newDate);
  }

  // Update bar elements in-place (fast, no full re-render)
  updateBarDOM(task, drag.tl);

  // Tooltip
  const displayDate = drag.edge === 'start' ? parseDate(task.startDate) : parseDate(task.endDate);
  const tip = getDragTooltip();
  const label = drag.edge === 'start' ? 'Start' : 'End';
  tip.textContent = `${label}: ${displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  tip.style.left = `${e.clientX}px`;
  tip.style.top  = `${e.clientY - 44}px`;
  tip.style.display = '';
}

function onDragEnd() {
  if (!drag) return;
  document.body.style.cursor     = '';
  document.body.style.userSelect = '';
  svgContainer.classList.remove('dragging');
  getDragTooltip().style.display = 'none';
  drag = null;
  save();
  render(); // full re-render to recalculate timeline bounds
}

function updateBarDOM(task, tl) {
  const { sx, w } = barPx(task, tl);
  const i  = tasks.indexOf(task);
  const by = HEADER_H + i * ROW_H + BAR_PAD;
  const bx = sx + 1, bw = Math.max(0, w - 2);

  // Update bar rects
  ['bs','br','bh'].forEach(prefix => {
    const el = document.getElementById(`${prefix}-${task.id}`);
    if (!el) return;
    el.setAttribute('x', bx);
    el.setAttribute('width', bw);
  });

  // Shadow y offset
  const shadow = document.getElementById(`bs-${task.id}`);
  if (shadow) shadow.setAttribute('y', by + 2);

  // Label
  const label = document.getElementById(`bl-${task.id}`);
  if (label) label.setAttribute('x', bx + bw / 2);

  // Clip path
  const clip = document.getElementById(`c${task.id}`);
  if (clip) {
    const r = clip.querySelector('rect');
    if (r) { r.setAttribute('x', sx + 6); r.setAttribute('width', Math.max(0, w - 12)); }
  }

  // Drag handles
  const hl = svgContainer.querySelector(`[data-drag="start"][data-task="${task.id}"]`);
  const hr = svgContainer.querySelector(`[data-drag="end"][data-task="${task.id}"]`);
  if (hl) hl.setAttribute('x', bx - 4);
  if (hr) hr.setAttribute('x', bx + bw - HANDLE_W + 4);
}

// ── Checkpoints ───────────────────────────────────────────────
function openCheckpointModal() {
  if (!tasks.length) { showToast('Add tasks first to place a checkpoint'); return; }
  cpName.value  = '';
  cpMsg.style.display = 'none';
  cpOverlay.classList.add('open');
  setTimeout(() => cpName.focus(), 100);
}

function closeCheckpointModal() {
  cpOverlay.classList.remove('open');
}

function handleAddCheckpoint() {
  const name = cpName.value.trim();
  if (!name) { cpMsg.textContent = 'Label is required.'; cpMsg.style.display = ''; return; }

  closeCheckpointModal();
  enterPlacingMode(name);
}

function enterPlacingMode(name) {
  cpPlacing = { name };
  document.body.classList.add('cp-placing');

  // Add banner
  let banner = document.getElementById('cpBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'cpBanner';
    banner.className = 'cp-placing-banner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<strong>${esc(name)}</strong> &mdash; click to place &nbsp;·&nbsp; <kbd>Esc</kbd> cancel`;
}

function exitPlacingMode() {
  cpPlacing = null;
  document.body.classList.remove('cp-placing');
  const banner = document.getElementById('cpBanner');
  if (banner) banner.remove();
  const preview = document.getElementById('cpPreviewSvg');
  if (preview) preview.remove();
}

function deleteCheckpoint(id) {
  checkpoints = checkpoints.filter(c => c.id !== id);
  saveCheckpoints();
  if (tasks.length) renderChart();
}

// ── Checkpoint drag ───────────────────────────────────────────
function onCpDragMove(e) {
  if (!cpDragging) return;
  e.preventDefault();
  const px = e.clientX - cpDragging.chartRect.left + ganttChartArea.scrollLeft;
  const maxPx = cpDragging.tl.numMonths * COL_W;
  const clamped = Math.max(0, Math.min(maxPx, px));
  const newDate = pixelToDate(clamped, cpDragging.tl);

  const cp = checkpoints.find(c => c.id === cpDragging.id);
  if (!cp) return;
  cp.date = fmtDate(newDate);

  // Update checkpoint elements in-place
  updateCheckpointDOM(cp, cpDragging.tl);

  // Tooltip
  const tip = getDragTooltip();
  const displayDate = parseDate(cp.date);
  tip.textContent = displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  tip.style.left = `${e.clientX}px`;
  tip.style.top  = `${e.clientY - 44}px`;
  tip.style.display = '';
}

function onCpDragEnd() {
  if (!cpDragging) return;
  document.body.style.cursor     = '';
  document.body.style.userSelect = '';
  svgContainer.classList.remove('dragging');
  getDragTooltip().style.display = 'none';
  cpDragging = null;
  saveCheckpoints();
  render();
}

function updateCheckpointDOM(cp, tl) {
  const cpDate = parseDate(cp.date);
  const cpOff  = (cpDate.getFullYear() - tl.startYear) * 12 + (cpDate.getMonth() - tl.startMonth);
  const cpDim  = new Date(cpDate.getFullYear(), cpDate.getMonth() + 1, 0).getDate();
  const cpX    = (cpOff + (cpDate.getDate() - 1) / cpDim) * COL_W;
  const tx     = cpX.toFixed(1);

  const line = document.getElementById(`cp-line-${cp.id}`);
  if (line) { line.setAttribute('x1', tx); line.setAttribute('x2', tx); }
  const tri = document.getElementById(`cp-tri-${cp.id}`);
  if (tri) tri.setAttribute('points', `${cpX-5},${HEADER_H} ${cpX+5},${HEADER_H} ${cpX},${HEADER_H+7}`);
  const label = document.getElementById(`cp-label-${cp.id}`);
  if (label) label.setAttribute('x', tx);
  const hit = svgContainer.querySelector(`.cp-hit[data-cp="${cp.id}"]`);
  if (hit) hit.setAttribute('x', cpX - 12);
}

// ── Checkpoint context menu ───────────────────────────────────
let cpContextMenu = null;

function showCpContextMenu(cpId, x, y) {
  closeCpContextMenu();
  const cp = checkpoints.find(c => c.id === cpId);
  if (!cp) return;

  const menu = document.createElement('div');
  menu.className = 'cp-context-menu';
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const dateStr = parseDate(cp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  menu.innerHTML = `
    <div style="padding:6px 12px 4px;font-size:11px;color:#9CA3AF;font-weight:600;letter-spacing:.03em">${esc(cp.name)} · ${dateStr}</div>
    <button class="danger" data-action="delete">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
      </svg>
      Delete
    </button>`;

  menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
    deleteCheckpoint(cpId);
    closeCpContextMenu();
  });

  document.body.appendChild(menu);
  cpContextMenu = menu;

  // Keep in viewport
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 8) + 'px';
  });
}

function closeCpContextMenu() {
  if (cpContextMenu) { cpContextMenu.remove(); cpContextMenu = null; }
}

// ── Export SVG (includes sidebar) ─────────────────────────────
function buildExportSVG() {
  const tl       = getTimeline();
  const chartW   = tl.numMonths * COL_W;
  const chartH   = HEADER_H + tasks.length * ROW_H;
  const SIDE_W   = 220;
  const TITLE_H  = 48;
  const CP_FOOT  = checkpoints.length ? 24 : 0;
  const totalW   = SIDE_W + chartW;
  const totalH   = TITLE_H + chartH + CP_FOOT + 16;
  const ct       = TITLE_H;
  const cx       = SIDE_W;

  const now      = new Date();
  const todayOff = (now.getFullYear() - tl.startYear) * 12 + (now.getMonth() - tl.startMonth);
  const dim      = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayX   = (todayOff + (now.getDate() - 1) / dim) * COL_W;
  const yrs      = buildYearGroups(tl);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">`;

  // Defs
  s += `<defs><linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.28)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/></linearGradient>`;
  tasks.forEach((t, i) => {
    const { sx, w } = barPx(t, tl);
    const bx = cx + sx + 1, bw = Math.max(0, w - 2);
    const by = ct + HEADER_H + i * ROW_H + BAR_PAD;
    s += `<clipPath id="ec${t.id}"><rect x="${bx+6}" y="${by}" width="${Math.max(0,bw-12)}" height="${BAR_H}"/></clipPath>`;
  });
  s += `</defs>`;

  // Background
  s += `<rect width="${totalW}" height="${totalH}" fill="#fff"/>`;

  // Title bar
  s += `<text x="20" y="${TITLE_H/2+6}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="#111827">GanttFlow</text>`;
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  s += `<text x="${totalW-20}" y="${TITLE_H/2+6}" text-anchor="end" font-family="Inter,system-ui,sans-serif" font-size="12" fill="#9CA3AF">${dateStr}</text>`;
  s += `<line x1="0" y1="${TITLE_H}" x2="${totalW}" y2="${TITLE_H}" stroke="#E5E7EB" stroke-width="1"/>`;

  // Sidebar
  s += `<rect x="0" y="${ct}" width="${SIDE_W}" height="${chartH}" fill="#fff"/>`;
  s += `<text x="20" y="${ct+HEADER_H-10}" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600" letter-spacing="1" fill="#9CA3AF">TASKS</text>`;
  s += `<line x1="0" y1="${ct+HEADER_H}" x2="${SIDE_W}" y2="${ct+HEADER_H}" stroke="#E5E7EB" stroke-width="1"/>`;
  s += `<line x1="${SIDE_W}" y1="${ct}" x2="${SIDE_W}" y2="${ct+chartH}" stroke="#E5E7EB" stroke-width="1"/>`;

  tasks.forEach((t, i) => {
    const ry = ct + HEADER_H + i * ROW_H;
    if (i > 0) s += `<line x1="0" y1="${ry}" x2="${SIDE_W}" y2="${ry}" stroke="#F3F4F6" stroke-width="1"/>`;
    s += `<circle cx="24" cy="${ry+ROW_H/2}" r="5" fill="${t.color}"/>`;
    s += `<text x="38" y="${ry+ROW_H/2+4.5}" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="500" fill="#111827">${esc(t.name)}</text>`;
  });

  // Chart
  s += `<rect x="${cx}" y="${ct}" width="${chartW}" height="${chartH}" fill="#fff"/>`;

  for (let i = 0; i < tl.numMonths; i++) {
    const { month } = totalToDate(tl.startYear * 12 + tl.startMonth + i);
    const x = cx + i * COL_W;
    if (i % 2 === 1) s += `<rect x="${x}" y="${ct+HEADER_H}" width="${COL_W}" height="${tasks.length*ROW_H}" fill="#F9FAFB"/>`;
    s += `<line x1="${x}" y1="${ct}" x2="${x}" y2="${ct+chartH}" stroke="#F3F4F6" stroke-width="1"/>`;
    s += `<text x="${x+COL_W/2}" y="${ct+HEADER_H-10}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="500" fill="#9CA3AF">${MONTHS_SHORT[month]}</text>`;
  }

  yrs.forEach(({ year, startCol, count }) => {
    const x = cx + startCol * COL_W, w = count * COL_W;
    if (startCol > 0) s += `<line x1="${x}" y1="${ct}" x2="${x}" y2="${ct+HEADER_H}" stroke="#E5E7EB" stroke-width="1"/>`;
    s += `<text x="${x+w/2}" y="${ct+22}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600" fill="#374151">${year}</text>`;
  });

  s += `<line x1="${cx}" y1="${ct+HEADER_H}" x2="${cx+chartW}" y2="${ct+HEADER_H}" stroke="#E5E7EB" stroke-width="1"/>`;
  for (let i = 1; i < tasks.length; i++) s += `<line x1="${cx}" y1="${ct+HEADER_H+i*ROW_H}" x2="${cx+chartW}" y2="${ct+HEADER_H+i*ROW_H}" stroke="#F3F4F6" stroke-width="1"/>`;

  // Today
  if (showToday && todayOff >= 0 && todayOff < tl.numMonths) {
    const tx = (cx + todayX).toFixed(1);
    s += `<line x1="${tx}" y1="${ct+HEADER_H}" x2="${tx}" y2="${ct+chartH}" stroke="#F59E0B" stroke-width="1.5" stroke-dasharray="4 3" opacity=".75"/>`;
    s += `<circle cx="${tx}" cy="${ct+HEADER_H}" r="3.5" fill="#F59E0B"/>`;
  }

  // Checkpoints (export)
  checkpoints.forEach(cp => {
    const cpDate = parseDate(cp.date);
    const cpOff  = (cpDate.getFullYear() - tl.startYear) * 12 + (cpDate.getMonth() - tl.startMonth);
    if (cpOff < 0 || cpOff >= tl.numMonths) return;
    const cpDim = new Date(cpDate.getFullYear(), cpDate.getMonth() + 1, 0).getDate();
    const cpX   = cx + (cpOff + (cpDate.getDate() - 1) / cpDim) * COL_W;
    const tx    = cpX.toFixed(1);
    s += `<line x1="${tx}" y1="${ct+HEADER_H}" x2="${tx}" y2="${ct+chartH}" stroke="#9CA3AF" stroke-width="1.5" stroke-dasharray="6 4" opacity=".6"/>`;
    s += `<polygon points="${cpX-5},${ct+HEADER_H} ${cpX+5},${ct+HEADER_H} ${cpX},${ct+HEADER_H+7}" fill="#9CA3AF"/>`;
    s += `<text x="${tx}" y="${ct+chartH+14}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600" fill="#6B7280">${esc(cp.name)}</text>`;
  });

  // Bars
  tasks.forEach((t, i) => {
    const { sx, w } = barPx(t, tl);
    const bx = cx + sx + 1, bw = Math.max(0, w - 2);
    const by = ct + HEADER_H + i * ROW_H + BAR_PAD;
    if (bw <= 0) return;
    s += `<rect x="${bx}" y="${by+2}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="rgba(0,0,0,.07)"/>`;
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="${t.color}"/>`;
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${BAR_H}" rx="${BAR_R}" fill="url(#shine)"/>`;
    if (bw > 28) {
      s += `<text x="${bx+bw/2}" y="${by+BAR_H/2+4.5}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="500" fill="white" clip-path="url(#ec${t.id})">${esc(t.name)}</text>`;
    }
  });

  s += `</svg>`;
  return s;
}

// ── SVG → Canvas ──────────────────────────────────────────────
function svgToCanvas(svgStr) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const scale  = 2;
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('render failed')); };
    img.src = url;
  });
}

async function exportPNG() {
  if (!tasks.length) return;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting…';
  try {
    const canvas = await svgToCanvas(buildExportSVG());
    const link   = document.createElement('a');
    link.download = `ganttflow-${new Date().toISOString().slice(0,10)}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
    showToast('Chart exported as PNG');
  } catch {
    showToast('Export failed — please try again');
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export PNG`;
  }
}

async function copyChart() {
  if (!tasks.length) return;
  copyBtn.disabled = true;
  try {
    const canvas = await svgToCanvas(buildExportSVG());
    canvas.toBlob(async blob => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Chart copied to clipboard');
      } catch {
        showToast('Copy failed — browser may require HTTPS');
      } finally { copyBtn.disabled = false; }
    }, 'image/png');
  } catch {
    showToast('Failed to generate image');
    copyBtn.disabled = false;
  }
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ── Start ─────────────────────────────────────────────────────
init();

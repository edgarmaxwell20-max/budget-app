/* Simple budget app (localStorage). */

const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

function ymKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const STORE_KEY = 'budget.simple.v1';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { months: {}, categories: [] };
  } catch {
    return { months: {}, categories: [] };
  }
}

function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

let store = loadStore();
let cursor = new Date();

function ensureMonth(key) {
  store.months[key] ||= { income: 0, savings: 0, startBal: 0, tx: [] };
  // Back-compat for existing stored months
  if (store.months[key].startBal === undefined) store.months[key].startBal = 0;
  return store.months[key];
}

function setMonthLabel() {
  const d = cursor;
  const label = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  $('monthLabel').textContent = label;
}

function seedDefaultsIfEmpty() {
  if (store.categories.length) return;
  store.categories = [
    { id: crypto.randomUUID(), name: 'Housing', budget: 0 },
    { id: crypto.randomUUID(), name: 'Groceries', budget: 0 },
    { id: crypto.randomUUID(), name: 'Transportation', budget: 0 },
    { id: crypto.randomUUID(), name: 'Utilities', budget: 0 },
    { id: crypto.randomUUID(), name: 'Dining', budget: 0 },
    { id: crypto.randomUUID(), name: 'Subscriptions', budget: 0 },
    { id: crypto.randomUUID(), name: 'Misc', budget: 0 },
  ];
  saveStore(store);
}

function monthTotals(month) {
  const expenses = month.tx
    .filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const incomeTx = month.tx
    .filter((t) => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  return { expenses, incomeTx };
}

function renderPlan() {
  const key = ymKey(cursor);
  const month = ensureMonth(key);
  $('income').value = month.income || '';
  $('savings').value = month.savings || '';
  $('startBal').value = month.startBal || '';

  const { expenses, incomeTx } = monthTotals(month);
  const plannedIncome = Number(month.income || 0);
  const startBal = Number(month.startBal || 0);
  const savings = Number(month.savings || 0);

  // Projection based on actual transactions so far (not budgets)
  const projected = startBal + plannedIncome + incomeTx - expenses - savings;

  const pills = [
    { k: 'Starting balance', v: fmt(startBal) },
    { k: 'Planned income', v: fmt(plannedIncome) },
    { k: 'Spent so far', v: fmt(expenses) },
    { k: 'Projected end balance', v: fmt(projected), tone: projected >= 0 ? 'good' : 'bad' },
  ];

  $('planSummary').innerHTML = `
    <div class="summary">
      ${pills
        .map(
          (p) => `
        <div class="pill">
          <div class="k">${p.k}</div>
          <div class="v ${p.tone === 'good' ? 'amt good' : p.tone === 'bad' ? 'amt bad' : ''}">${p.v}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

function plannedBudgetTotal() {
  return store.categories.reduce((s, c) => s + (Number(c.budget) || 0), 0);
}

function renderWaterfall() {
  const key = ymKey(cursor);
  const month = ensureMonth(key);

  const startBal = Number(month.startBal || 0);
  const inc = Number(month.income || 0);
  const budgets = plannedBudgetTotal();
  const sav = Number(month.savings || 0);
  const end = startBal + inc - budgets - sav;

  const steps = [
    { label: 'Start', type: 'total', value: startBal },
    { label: 'Income', type: 'delta', value: inc },
    { label: 'Budgets', type: 'delta', value: -budgets },
    { label: 'Savings', type: 'delta', value: -sav },
    { label: 'End (forecast)', type: 'total', value: end },
  ];

  $('wfEndBadge').textContent = `Forecast end: ${fmt(end)}`;
  $('waterfall').innerHTML = buildWaterfallSVG(steps);
}

function buildWaterfallSVG(steps) {
  // Compute cumulative ranges for each bar
  const bars = [];
  let cum = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'total') {
      const start = 0;
      const end = s.value;
      cum = s.value;
      bars.push({ ...s, start, end, delta: end - start, isTotal: true });
    } else {
      const start = cum;
      const end = cum + s.value;
      cum = end;
      bars.push({ ...s, start, end, delta: s.value, isTotal: false });
    }
  }

  const minV = Math.min(0, ...bars.map((b) => Math.min(b.start, b.end)));
  const maxV = Math.max(0, ...bars.map((b) => Math.max(b.start, b.end)));
  const pad = (maxV - minV) * 0.12 || 100;
  const yMin = minV - pad;
  const yMax = maxV + pad;

  const W = 980;
  const H = 320;
  const margin = { t: 22, r: 18, b: 70, l: 64 };
  const plotW = W - margin.l - margin.r;
  const plotH = H - margin.t - margin.b;
  const n = bars.length;
  const gap = 16;
  const barW = (plotW - gap * (n - 1)) / n;

  const y = (v) => margin.t + (yMax - v) * (plotH / (yMax - yMin));
  const y0 = y(0);

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i * (yMax - yMin)) / ticks);

  const rects = bars
    .map((b, i) => {
      const x = margin.l + i * (barW + gap);
      const top = y(Math.max(b.start, b.end));
      const bot = y(Math.min(b.start, b.end));
      const h = Math.max(1, bot - top);

      const up = b.delta >= 0;
      const fill = b.isTotal ? 'rgba(255,255,255,.16)' : up ? 'rgba(34,197,94,.70)' : 'rgba(239,68,68,.70)';
      const stroke = 'rgba(255,255,255,.18)';

      const label = `${b.label}`;
      const deltaLabel = b.isTotal ? fmt(b.end) : (b.delta >= 0 ? '+' : '−') + fmt(Math.abs(b.delta));

      // connector line from previous end to next start
      const prev = bars[i - 1];
      const conn = !prev
        ? ''
        : `<line x1="${x - gap}" y1="${y(prev.end)}" x2="${x}" y2="${y(b.start)}" stroke="rgba(255,255,255,.20)" stroke-dasharray="4 4" />`;

      return `
        ${conn}
        <rect x="${x}" y="${top}" width="${barW}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" />
        <text class="wfText" x="${x + barW / 2}" y="${Math.min(top + 16, H - margin.b - 6)}" text-anchor="middle">${escapeSvg(deltaLabel)}</text>
        <text class="wfAxis" x="${x + barW / 2}" y="${H - 36}" text-anchor="middle">${escapeSvg(label)}</text>
      `;
    })
    .join('');

  const axes = `
    <g class="wfAxis">
      ${tickVals
        .map((tv) => {
          const yy = y(tv);
          return `
            <line x1="${margin.l}" y1="${yy}" x2="${W - margin.r}" y2="${yy}" stroke="rgba(255,255,255,.10)" />
            <text x="${margin.l - 10}" y="${yy + 4}" text-anchor="end">${escapeSvg(fmt(tv))}</text>`;
        })
        .join('')}
      <line x1="${margin.l}" y1="${y0}" x2="${W - margin.r}" y2="${y0}" stroke="rgba(255,255,255,.22)" />
    </g>`;

  return `
    <svg class="wfSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly budget waterfall chart">
      ${axes}
      ${rects}
    </svg>`;
}

function escapeSvg(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderCatSelect() {
  const sel = $('txCat');
  sel.innerHTML = '';
  for (const c of store.categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
}

function catSpendForMonth(month) {
  const byCat = new Map();
  for (const c of store.categories) byCat.set(c.id, 0);
  for (const t of month.tx) {
    if (!t.catId) continue;
    const amt = Number(t.amount) || 0;
    if (amt < 0) byCat.set(t.catId, (byCat.get(t.catId) || 0) + Math.abs(amt));
  }
  return byCat;
}

function renderCats() {
  const key = ymKey(cursor);
  const month = ensureMonth(key);
  const spent = catSpendForMonth(month);

  const header = `
    <div class="tr th" style="grid-template-columns:1.2fr .6fr .6fr .6fr 36px">
      <div>Name</div><div>Budget</div><div>Spent</div><div>Left</div><div></div>
    </div>`;

  const rows = store.categories
    .map((c) => {
      const b = Number(c.budget) || 0;
      const s = spent.get(c.id) || 0;
      const left = b - s;
      const cls = left >= 0 ? 'good' : 'bad';
      return `
        <div class="tr">
          <div>
            <div style="font-weight:750">${escapeHtml(c.name)}</div>
            <div class="badge">${c.id.slice(0, 6)}</div>
          </div>
          <div class="amt">${fmt(b)}</div>
          <div class="amt">${fmt(s)}</div>
          <div class="amt ${cls}">${fmt(left)}</div>
          <button class="iconBtn" title="Remove" data-remove-cat="${c.id}">✕</button>
        </div>`;
    })
    .join('');

  $('catsTable').innerHTML = header + rows;

  for (const btn of document.querySelectorAll('[data-remove-cat]')) {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-remove-cat');
      store.categories = store.categories.filter((c) => c.id !== id);
      // Keep transactions but orphan category if removed.
      saveStore(store);
      renderAll();
    });
  }
}

function renderTx() {
  const key = ymKey(cursor);
  const month = ensureMonth(key);

  const header = `
    <div class="tr th" style="grid-template-columns:1.2fr .7fr .8fr .6fr 36px">
      <div>Description</div><div>Category</div><div>Date</div><div>Amount</div><div></div>
    </div>`;

  const catName = (id) => store.categories.find((c) => c.id === id)?.name || '—';

  const rows = month.tx
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((t) => {
      const amt = Number(t.amount) || 0;
      const cls = amt >= 0 ? 'good' : 'bad';
      return `
        <div class="tr" style="grid-template-columns:1.2fr .7fr .8fr .6fr 36px">
          <div style="font-weight:650">${escapeHtml(t.desc || '')}</div>
          <div>${escapeHtml(catName(t.catId))}</div>
          <div class="amt">${escapeHtml(t.date || '')}</div>
          <div class="amt ${cls}">${fmt(amt)}</div>
          <button class="iconBtn" title="Remove" data-remove-tx="${t.id}">✕</button>
        </div>`;
    })
    .join('');

  $('txTable').innerHTML = header + (rows || `<div class="hint">No transactions this month yet.</div>`);

  for (const btn of document.querySelectorAll('[data-remove-tx]')) {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-remove-tx');
      month.tx = month.tx.filter((t) => t.id !== id);
      saveStore(store);
      renderAll();
    });
  }
}

function exportCSV() {
  const key = ymKey(cursor);
  const month = ensureMonth(key);
  const catName = (id) => store.categories.find((c) => c.id === id)?.name || '';

  const lines = [
    ['month', 'date', 'description', 'category', 'amount'].join(','),
    ...month.tx.map((t) =>
      [
        key,
        t.date || '',
        csv(t.desc || ''),
        csv(catName(t.catId)),
        String(Number(t.amount) || 0),
      ].join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-${key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csv(s) {
  const v = String(s).replaceAll('"', '""');
  return `"${v}"`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderAll() {
  setMonthLabel();
  renderPlan();
  renderWaterfall();
  renderCatSelect();
  renderCats();
  renderTx();
}

function wire() {
  $('txDate').value = todayISO();

  $('income').addEventListener('change', () => {
    const key = ymKey(cursor);
    const month = ensureMonth(key);
    month.income = Number($('income').value || 0);
    saveStore(store);
    renderAll();
  });
  $('savings').addEventListener('change', () => {
    const key = ymKey(cursor);
    const month = ensureMonth(key);
    month.savings = Number($('savings').value || 0);
    saveStore(store);
    renderAll();
  });

  $('startBal').addEventListener('change', () => {
    const key = ymKey(cursor);
    const month = ensureMonth(key);
    month.startBal = Number($('startBal').value || 0);
    saveStore(store);
    renderAll();
  });

  $('catForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('catName').value.trim();
    const budget = Number($('catBudget').value || 0);
    if (!name) return;
    store.categories.push({ id: crypto.randomUUID(), name, budget });
    $('catName').value = '';
    $('catBudget').value = '';
    saveStore(store);
    renderAll();
  });

  $('txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = ymKey(cursor);
    const month = ensureMonth(key);
    const desc = $('txDesc').value.trim();
    const amount = Number($('txAmt').value || 0);
    const catId = $('txCat').value || '';
    const date = $('txDate').value || todayISO();
    if (!desc || !amount) return;
    month.tx.push({ id: crypto.randomUUID(), desc, amount, catId, date });
    $('txDesc').value = '';
    $('txAmt').value = '';
    $('txDesc').focus();
    saveStore(store);
    renderAll();
  });

  $('exportBtn').addEventListener('click', exportCSV);

  $('prevMonth').addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    renderAll();
  });
  $('nextMonth').addEventListener('click', () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    renderAll();
  });

  $('clearMonth').addEventListener('click', () => {
    const key = ymKey(cursor);
    const month = ensureMonth(key);
    if (!confirm(`Clear all transactions for ${key}?`)) return;
    month.tx = [];
    saveStore(store);
    renderAll();
  });
}

seedDefaultsIfEmpty();
wire();
renderAll();

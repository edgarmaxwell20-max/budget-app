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
  store.months[key] ||= { income: 0, savings: 0, tx: [] };
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

  const { expenses, incomeTx } = monthTotals(month);
  const totalIncome = Number(month.income || 0) + incomeTx;
  const remaining = totalIncome - expenses - Number(month.savings || 0);

  const pills = [
    { k: 'Planned income', v: fmt(month.income || 0) },
    { k: 'Txn income', v: fmt(incomeTx) },
    { k: 'Expenses (spent)', v: fmt(expenses) },
    { k: 'Remaining (after savings)', v: fmt(remaining), tone: remaining >= 0 ? 'good' : 'bad' },
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

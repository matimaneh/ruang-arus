(() => {
  const KEY = 'ruang-arus-data-v1';
  const today = new Date();
  const isoToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const defaults = {
    transactions: [], business: [], installments: [], notes: [], savingsGoals: [], savingsTransfers: [], budgets: {}, budgetUpdatedAt: {}, syncDeleted: [], syncDeletedBusiness: [], syncDeletedCategories: {},
    categories: { income: ['Gaji', 'Pendapatan usaha', 'Pendapatan laba usaha', 'Bonus', 'Pendapatan lain'], expense: ['Makan', 'Jajan', 'Bensin', 'Transportasi', 'Belanja rumah', 'Kesehatan', 'Tagihan', 'Lainnya'], debt: ['Kendaraan', 'Rumah', 'Elektronik', 'Pinjaman', 'Lainnya'] }
  };
  let data = load();
  let page = 'dashboard';
  let monthOffset = 0;
  let personalTab = 'activity';
  let overlayOpen = false;
  let amountsHidden = false;
  const el = (s, root = document) => root.querySelector(s);
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const displayMoney = n => amountsHidden ? 'Rp ••••••' : money(n);
  const numberInput = n => new Intl.NumberFormat('id-ID').format(Number(n) || 0);
  const dateLabel = (value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => value ? new Intl.DateTimeFormat('id-ID', opts).format(new Date(`${value}T00:00:00`)) : '-';
  const monthDate = () => new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthKey = value => (value || '').slice(0, 7);
  const selectedMonth = () => `${monthDate().getFullYear()}-${String(monthDate().getMonth() + 1).padStart(2, '0')}`;
  const monthName = () => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(monthDate());
  const inSelectedMonth = item => monthKey(item.date) === selectedMonth();
  const sum = (items, field) => items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
  const investmentIcon = '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="3.2"/><path d="M8 5.5v3M6.8 6.4h2.1M4 20h16M7 17l4-4 3 2 5-6M15 9h4v4" /></svg>';
  const bookIcon = '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5c-2.1-1.8-5-2.2-8-1.1v12c3.1-1.1 5.9-.7 8 1.1m0-12c2.1-1.8 5-2.2 8-1.1v12c-3.1-1.1-5.9-.7-8 1.1m0-12v12" /></svg>';
  const rupiahCoinIcon = '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><text x="12" y="15" text-anchor="middle" fill="currentColor" stroke="none" font-size="7" font-weight="700">Rp</text></svg>';
  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!stored || typeof stored !== 'object') return structuredClone(defaults);
      const categories = Object.fromEntries(Object.keys(defaults.categories).map(group => [group, [...new Set([...(defaults.categories[group] || []), ...(stored.categories?.[group] || [])])]]));
      return { ...structuredClone(defaults), ...stored, budgetUpdatedAt: stored.budgetUpdatedAt || {}, syncDeleted: stored.syncDeleted || [], syncDeletedBusiness: stored.syncDeletedBusiness || [], syncDeletedCategories: stored.syncDeletedCategories || {}, categories };
    } catch { return structuredClone(defaults); }
  }
  let syncTimer;
  let syncInProgress = false;
  let syncQueued = false;
  let syncErrorAt = 0;
  let syncErrorMessage = '';
  const pendingDeletions = new Map();
  let pendingImport = null;
  function saveLocal() { localStorage.setItem(KEY, JSON.stringify(data)); render(); }
  function save() { saveLocal(); if (window.RuangBackend?.enabled() && !pendingDeletions.size) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncCloud(false), 900); } }
  function toast(message, type = 'success', action = null) {
    const root = el('#toast-root'); if (!root) return;
    const item = document.createElement('div'); item.className = `app-toast ${type}`; item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const copy = document.createElement('span'); copy.textContent = message; item.append(copy);
    if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.addEventListener('click', () => { action.run(); item.remove(); }); item.append(button); }
    root.append(item); while (root.children.length > 3) root.firstElementChild.remove();
    setTimeout(() => { item.classList.add('leaving'); setTimeout(() => item.remove(), 180); }, action ? 7000 : 3600);
  }
  function formError(message) { let node = el('#active-form .form-error'); if (!node) { node = document.createElement('p'); node.className = 'form-error'; node.setAttribute('role', 'alert'); el('#active-form')?.prepend(node); } node.textContent = message; }
  function undoableDelete(key, message, removeItems, restoreItems, commit) {
    const snapshot = removeItems(); saveLocal();
    const timer = setTimeout(() => { commit(snapshot); pendingDeletions.delete(key); save(); }, 6500);
    pendingDeletions.set(key, { timer, snapshot, restoreItems });
    toast(message, 'info', { label: 'Urungkan', run: () => { const pending = pendingDeletions.get(key); if (!pending) return; clearTimeout(pending.timer); pendingDeletions.delete(key); pending.restoreItems(pending.snapshot); save(); toast('Penghapusan dibatalkan.'); } });
  }
  const routeState = (overlay = false) => ({ ruangArus: true, page, personalTab, overlay });
  function setPage(next, fromHistory = false) {
    if (!['dashboard', 'personal', 'business', 'savings', 'notes', 'settings'].includes(next)) return;
    if (overlayOpen) {
      closeModal(false);
      if (history.state?.ruangArus) history.replaceState(routeState(false), '', location.href);
    }
    if (page === next && !fromHistory) return;
    page = next;
    if (!fromHistory) history.pushState(routeState(), '', location.href);
    document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function pushOverlayState() {
    if (overlayOpen) closeModal(false);
    if (history.state?.ruangArus && history.state.overlay) history.replaceState(routeState(false), '', location.href);
    history.pushState(routeState(true), '', location.href);
    overlayOpen = true;
  }
  const monthTransactions = () => data.transactions.filter(inSelectedMonth);
  const monthBusiness = () => data.business.filter(inSelectedMonth);
  const txIcon = tx => tx.type === 'income' ? '↙' : '↗';
  function pageHead(title, subtitle, action = '') { return `<div class="page-head"><div><p class="eyebrow">${page === 'business' ? 'RUANG USAHA' : page === 'personal' || page === 'savings' ? 'RUANG PRIBADI' : page === 'notes' ? 'RUANG BEBAS' : 'KEUANGAN ANDA'}</p><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`; }
  function periodControl() { return `<div class="period-control"><button data-month="-1" aria-label="Bulan sebelumnya">‹</button><span class="period-value">${monthName()}</span><button data-month="1" aria-label="Bulan berikutnya">›</button></div>`; }
  function empty(icon, title, copy, action = '') { return `<div class="empty-state"><div class="empty-mark">${icon}</div><strong>${title}</strong>${copy}${action ? `<div style="margin-top:13px">${action}</div>` : ''}</div>`; }
  function transactionRows(items, limit = 0) {
    const rows = [...items].sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
    const shown = limit ? rows.slice(0, limit) : rows;
    if (!shown.length) return empty('◷', 'Belum ada aktivitas tercatat', 'Mulai dengan mencatat pemasukan atau pengeluaran pertama Anda.');
    return `<div class="transaction-list">${shown.map(tx => `<div class="transaction-row"><div class="tx-mark ${tx.type === 'expense' ? 'expense' : ''}">${txIcon(tx)}</div><button type="button" class="tx-meta tx-open" data-action="open-tx" data-id="${tx.id}" aria-label="Buka rincian ${escapeHtml(tx.title || tx.category)}"><span class="tx-title">${escapeHtml(tx.title || tx.category)}</span><span class="tx-detail">${escapeHtml(tx.category)} · ${dateLabel(tx.date)}</span></button><div class="tx-amount ${tx.type === 'expense' ? 'negative' : ''}">${tx.type === 'expense' ? '−' : '+'}${money(tx.amount)}</div>${page !== 'dashboard' ? `<div class="row-actions"><button data-action="delete-tx" data-id="${tx.id}" aria-label="Hapus catatan">×</button></div>` : ''}</div>`).join('')}</div>`;
  }
  function chart(items) {
    const period = monthDate();
    const endDay = monthOffset === 0 ? today.getDate() : new Date(period.getFullYear(), period.getMonth() + 1, 0).getDate();
    const startDay = Math.max(1, endDay - 6);
    const days = Array.from({ length: endDay - startDay + 1 }, (_, i) => new Date(period.getFullYear(), period.getMonth(), startDay + i));
    const values = days.map(day => {
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      return { date: day, key, income: sum(items.filter(x => x.date === key && x.type === 'income'), 'amount'), expense: sum(items.filter(x => x.date === key && x.type === 'expense'), 'amount') };
    });
    const max = Math.max(1, ...values.flatMap(x => [x.income, x.expense]));
    const hasData = values.some(x => x.income || x.expense);
    if (!hasData) return `<div class="chart-empty"><strong>Belum ada arus tercatat</strong>Aktivitas akhir bulan ini akan muncul di sini.</div>`;
    return `<div class="chart-wrap"><div class="chart-y"><span>${money(max).replace(',00', '')}</span><span>${money(max / 2).replace(',00', '')}</span><span>Rp0</span></div><div class="chart-main">${values.map(x => `<div class="chart-day"><div class="bar-pair"><span class="bar" title="Pemasukan ${money(x.income)}" style="height:${Math.max(x.income ? 4 : 0, x.income / max * 100)}%"></span><span class="bar out" title="Pengeluaran ${money(x.expense)}" style="height:${Math.max(x.expense ? 4 : 0, x.expense / max * 100)}%"></span></div><span class="day-label">${new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(x.date)}</span></div>`).join('')}</div></div>`;
  }
  function dashboard() {
    const tx = monthTransactions(); const biz = monthBusiness();
    const income = sum(tx.filter(x => x.type === 'income'), 'amount'); const expense = sum(tx.filter(x => x.type === 'expense'), 'amount');
    const savingInMonth = sum(data.savingsTransfers.filter(inSelectedMonth), 'amount');
    const totalSaved = sum(data.savingsGoals, 'saved');
    const owed = data.installments.reduce((n, item) => n + Math.max(0, Number(item.total) - Number(item.paid)), 0);
    const sales = sum(biz, 'turnover'); const profit = biz.reduce((n, row) => n + Number(row.turnover) - Number(row.hpp) - Number(row.cost), 0);
    const recent = [...tx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const todayTx = data.transactions.filter(item => item.date === isoToday);
    const todayIncome = sum(todayTx.filter(item => item.type === 'income'), 'amount');
    const todayExpense = sum(todayTx.filter(item => item.type === 'expense'), 'amount');
    const budget = Number(data.budgets[selectedMonth()] || 0);
    const budgetLeft = budget - expense;
    const budgetProgress = budget ? Math.min(100, expense / budget * 100) : 0;
    const incomeShare = income ? Math.round(savingInMonth / income * 100) : 0;
    return `<div class="dashboard-heading"><div><p class="eyebrow">RUANG ARUS</p><h1 class="page-title">Halo, selamat datang</h1><p class="page-subtitle">Catat dan pahami arus uang Anda bulan ini.</p></div><div class="dashboard-period">${periodControl()}</div></div>
      <section class="money-hero"><div class="hero-copy"><div class="hero-label">Sisa uang bulan ini <button class="visibility-toggle" data-action="toggle-amounts" aria-label="${amountsHidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}">${amountsHidden ? '◉' : '◎'}</button></div><div class="hero-value">${displayMoney(income - expense - savingInMonth)}</div><div class="hero-foot">Pemasukan dikurangi pengeluaran dan uang yang disisihkan</div></div><div class="hero-period"><span class="hero-period-mark">${String(monthDate().getMonth() + 1).padStart(2, '0')}</span><span>${monthName()}</span></div></section>
      <div class="stat-grid dashboard-stats">
        <article class="stat-card metric-income"><div class="metric-symbol">↓</div><div class="stat-label">Pemasukan</div><div class="stat-value">${displayMoney(income)}</div><div class="metric-track"><i style="width:100%"></i></div><div class="stat-foot">${tx.filter(x => x.type === 'income').length} catatan bulan ini</div></article>
        <article class="stat-card metric-expense"><div class="metric-symbol">↑</div><div class="stat-label">Pengeluaran</div><div class="stat-value">${displayMoney(expense)}</div><div class="metric-track"><i style="width:${income ? Math.min(100, expense / income * 100) : 0}%"></i></div><div class="stat-foot">${income ? `${Math.round(expense / income * 100)}% dari pemasukan` : 'Belum ada pemasukan'}</div></article>
        <article class="stat-card metric-savings"><div class="metric-symbol">${rupiahCoinIcon}</div><div class="stat-label">Tabungan</div><div class="stat-value">${displayMoney(totalSaved)}</div><div class="metric-track"><i style="width:${income ? incomeShare : 0}%"></i></div><div class="stat-foot">${income ? `${incomeShare}% disisihkan bulan ini` : 'Jumlah dari semua target'}</div></article>
      </div>
      <div class="secondary-summary"><div><small>SISA CICILAN</small><strong>${displayMoney(owed)}</strong></div><div><small>OMSET USAHA</small><strong>${displayMoney(sales)}</strong></div><div><small>LABA USAHA</small><strong>${displayMoney(profit)}</strong></div></div>
      <section class="panel today-panel"><div class="today-head"><div class="today-title"><span class="today-home">⌂</span><div><p class="eyebrow">KONDISI HARI INI</p><h2>${dateLabel(isoToday, { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div></div><button class="button secondary small budget-button" data-modal="budget">Atur budget <span aria-hidden="true">◔</span></button></div>
        <div class="today-figures"><div><strong>${displayMoney(todayExpense)}</strong><small>keluar hari ini</small></div><button class="transaction-count" data-page="personal"><span>▤</span>${todayTx.length} transaksi <span aria-hidden="true">›</span></button></div>
        <div class="today-bottom"><div class="today-mini income-mini"><small>PEMASUKAN HARI INI</small><strong>${displayMoney(todayIncome)}</strong></div><div class="today-mini budget-mini"><small>SISA JATAH BULAN INI</small><strong>${budget ? displayMoney(budgetLeft) : 'Atur budget'}</strong></div></div>
        ${budget ? `<div class="budget-progress"><span style="width:${budgetProgress}%"></span></div><div class="budget-caption">Terpakai ${displayMoney(expense)} dari ${displayMoney(budget)} · ${Math.round(budgetProgress)}%</div>` : `<p class="budget-caption">Tetapkan batas pengeluaran bulanan agar sisa jatah lebih mudah dipantau.</p>`}
      </section>
      <div class="overview-grid dashboard-lower"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Aktivitas terbaru</h2><p class="panel-hint">Catatan pribadi bulan ini</p></div><button class="text-link" data-page="personal">Lihat semua</button></div>${transactionRows(recent, 5)}</section><section class="panel savings-prompt"><div><p class="eyebrow">LANGKAH BERIKUTNYA</p><h2>Mulai dari satu tujuan</h2><p>Tentukan apa yang ingin dicapai dan catat setiap setoran.</p></div><button class="button" data-page="savings">${data.savingsGoals.length ? 'Lihat tabungan' : 'Buat target tabungan'}</button></section></div>`;
  }
  function installmentList() {
    if (!data.installments.length) return empty('▤', 'Belum ada cicilan', 'Tambahkan kewajiban cicilan agar total awal, yang sudah dibayar, dan sisanya terlihat jelas.', '<button class="button small" data-modal="installment">＋ Tambah cicilan</button>');
    return `<div class="transaction-list">${data.installments.map(item => {
      const total = Number(item.total) || 0, paid = Number(item.paid) || 0, left = Math.max(total - paid, 0), pct = total ? Math.min(100, paid / total * 100) : 0;
      return `<div class="installment-card"><div class="installment-info"><div class="installment-name">${escapeHtml(item.name)}</div><div class="installment-sub">${escapeHtml(item.category)} · Total ${money(total)}</div></div><div class="installment-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-meta"><span>${money(paid)} terbayar</span><span>${Math.round(pct)}%</span></div></div><div class="installment-remaining"><strong>${money(left)}</strong><small>sisa cicilan</small></div><div class="row-actions">${left > 0 ? `<button title="Catat pembayaran" data-action="pay-installment" data-id="${item.id}">＋</button>` : '<span class="category-chip">Lunas</span>'}<button title="Hapus cicilan" data-action="delete-installment" data-id="${item.id}">×</button></div></div>`;
    }).join('')}</div>`;
  }
  function personal() {
    const tx = monthTransactions(); const income = sum(tx.filter(x => x.type === 'income'), 'amount'); const expense = sum(tx.filter(x => x.type === 'expense'), 'amount');
    const action = `<button class="button" data-modal="transaction" data-type="income">＋ Catat transaksi</button>`;
    return `${pageHead('Keuangan pribadi', 'Catat pemasukan, belanja, cicilan, dan kebiasaan menyisihkan uang.', action)}<div class="toolbar personal-toolbar" style="justify-content:space-between;margin-bottom:15px">${periodControl()}<div class="tab-row" style="margin:0"><button class="tab-button ${personalTab === 'activity' ? 'active' : ''}" data-tab="activity">Arus uang</button><button class="tab-button ${personalTab === 'debt' ? 'active' : ''}" data-tab="debt">Cicilan</button><button class="tab-button ${personalTab === 'advice' ? 'active' : ''}" data-tab="advice">Saran pencatatan</button></div></div>
      ${personalTab === 'activity' ? `<div class="summary-strip"><div><small>Pemasukan</small><strong>${money(income)}</strong></div><div><small>Pengeluaran</small><strong>${money(expense)}</strong></div><div><small>Selisih</small><strong>${money(income - expense)}</strong></div></div><section class="panel"><div class="panel-head"><div><h2 class="panel-title">Riwayat transaksi</h2><p class="panel-hint">Rincian uang masuk dan keluar pada ${monthName()}</p></div><div class="toolbar"><button class="button secondary small" data-modal="transaction" data-type="expense">− Pengeluaran</button><button class="button small" data-modal="transaction" data-type="income">＋ Pemasukan</button></div></div>${transactionRows(tx)}</section>` : personalTab === 'debt' ? `<section class="panel"><div class="panel-head"><div><h2 class="panel-title">Daftar cicilan</h2><p class="panel-hint">Saldo kewajiban dan progres pembayarannya</p></div><button class="button small" data-modal="installment">＋ Tambah cicilan</button></div>${installmentList()}</section>` : `<section class="advice-grid"><article class="advice-card"><span class="advice-number">01</span><h2>Catat saat transaksi terjadi</h2><p>Masukkan nominal dan tanggal pada hari yang sama. Ini mengurangi catatan yang terlupa dan membuat rekap harian lebih akurat.</p></article><article class="advice-card"><span class="advice-number">02</span><h2>Pisahkan uang usaha dari uang pribadi</h2><p>Omset dan HPP dicatat di ruang usaha. Catat gaji sebagai pemasukan pribadi hanya saat uang benar-benar diterima.</p></article><article class="advice-card"><span class="advice-number">03</span><h2>Gunakan kategori yang konsisten</h2><p>Tambahkan kategori jika memang membantu keputusan. Terlalu banyak kategori membuat ringkasan lebih sulit dibaca.</p></article><article class="advice-card"><span class="advice-number">04</span><h2>Anggap tabungan sebagai tujuan</h2><p>Tentukan target dan catat setiap setoran. Setoran mengurangi sisa uang yang tersedia, tetapi tidak dicampur dengan belanja.</p><button class="text-link" data-page="savings">Atur target tabungan</button></article><article class="advice-card"><span class="advice-number">05</span><h2>Tutup bulan dengan pemeriksaan singkat</h2><p>Cocokkan total catatan dengan rekening atau bukti transaksi, lalu tinjau cicilan dan target yang masih berjalan.</p></article></section>`}`;
  }
  function savings() {
    const totalSaved = sum(data.savingsGoals, 'saved');
    const totalTarget = sum(data.savingsGoals, 'target');
    const goals = data.savingsGoals.map(goal => {
      const saved = Number(goal.saved) || 0, target = Number(goal.target) || 0;
      const pct = target ? Math.min(100, saved / target * 100) : 0;
      const left = Math.max(0, target - saved);
      return `<article class="goal-card"><div class="goal-top"><div class="goal-icon">${rupiahCoinIcon}</div><div class="goal-menu"><button class="icon-button" data-action="delete-goal" data-id="${goal.id}" aria-label="Hapus target ${escapeHtml(goal.title)}">×</button></div></div><h2>${escapeHtml(goal.title)}</h2><p class="goal-target">Target ${money(target)}</p><div class="goal-progress"><span style="width:${pct}%"></span></div><div class="goal-values"><strong>${money(saved)} <small>disisihkan</small></strong><span>${Math.round(pct)}%</span></div><div class="goal-foot"><span>${left ? `Kurang ${money(left)}` : 'Target tercapai'}</span><button class="button small" data-action="add-saving" data-id="${goal.id}" ${left ? '' : 'disabled'}>＋ Setor</button></div></article>`;
    }).join('');
    return `${pageHead('Tabungan', 'Beri setiap tabungan tujuan, target nominal, dan catatan setoran.', `<button class="button" data-modal="savings-goal">＋ Buat target</button>`)}
      <div class="summary-strip savings-summary"><div><small>Total disisihkan</small><strong>${money(totalSaved)}</strong></div><div><small>Total target</small><strong>${money(totalTarget)}</strong></div><div><small>Target berjalan</small><strong>${data.savingsGoals.filter(goal => Number(goal.saved) < Number(goal.target)).length}</strong></div></div>
      ${goals ? `<div class="goal-grid">${goals}</div>` : `<section class="panel">${empty(rupiahCoinIcon, 'Belum ada target tabungan', 'Mulai dengan menetapkan tujuan dan nominal yang ingin dicapai.', '<button class="button small" data-modal="savings-goal">＋ Buat target pertama</button>')}</section>`}
      <section class="panel savings-note"><h2>Alur tabungan</h2><div class="savings-steps"><div><b>1</b><span>Beri nama tujuan</span></div><div><b>2</b><span>Tentukan nominal target</span></div><div><b>3</b><span>Catat setoran saat menyisihkan uang</span></div></div><p>Setiap setoran masuk ke progres target dan mengurangi sisa uang bulan tersebut. Saldo rekening tidak berubah otomatis.</p></section>`;
  }
  function business() {
    const biz = monthBusiness(); const turnover = sum(biz, 'turnover'); const hpp = sum(biz, 'hpp'); const costs = sum(biz, 'cost'); const net = turnover - hpp - costs;
    const rows = [...biz].sort((a, b) => b.date.localeCompare(a.date));
    return `${pageHead('Keuangan usaha', 'Catat omset, HPP, dan biaya harian. Laba dihitung otomatis.', `<button class="button" data-modal="business">＋ Catat hari ini</button>`)}
      <section class="business-highlight"><div><small>Omset tercatat · ${monthName()}</small><strong>${money(turnover)}</strong></div><div class="net-label"><small>Laba setelah HPP & biaya</small><strong class="net-value">${money(net)}</strong></div></section>
      <div class="stat-grid"><article class="stat-card"><div class="stat-top"><span class="stat-label">Total omset</span><span class="stat-icon">↙</span></div><div class="stat-value">${money(turnover)}</div><div class="stat-foot">${biz.length} hari tercatat</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Total HPP</span><span class="stat-icon gold">▤</span></div><div class="stat-value">${money(hpp)}</div><div class="stat-foot">Harga pokok penjualan</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Biaya per hari</span><span class="stat-icon rust">↗</span></div><div class="stat-value">${money(costs)}</div><div class="stat-foot">Biaya operasional harian</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Rata-rata omset</span><span class="stat-icon">⌁</span></div><div class="stat-value">${money(biz.length ? turnover / biz.length : 0)}</div><div class="stat-foot">Per hari yang dicatat</div></article></div>
      <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Rekap harian</h2><p class="panel-hint">Omset dikurangi HPP dan biaya untuk menghitung laba</p></div>${periodControl()}</div>${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>TANGGAL</th><th class="numeric">OMSET</th><th class="numeric">HPP</th><th class="numeric hide-mobile">BIAYA</th><th class="numeric">LABA BERSIH</th><th></th></tr></thead><tbody>${rows.map(item => `<tr><td>${dateLabel(item.date)}</td><td class="numeric">${money(item.turnover)}</td><td class="numeric">${money(item.hpp)}</td><td class="numeric hide-mobile">${money(item.cost)}</td><td class="numeric"><strong>${money(Number(item.turnover) - Number(item.hpp) - Number(item.cost))}</strong></td><td><div class="row-actions"><button data-action="delete-business" data-id="${item.id}" aria-label="Hapus rekap">×</button></div></td></tr>`).join('')}</tbody></table></div>` : empty(investmentIcon, 'Belum ada rekap usaha', 'Tambahkan omset, HPP, dan biaya untuk melihat laba harian.')}</section>`;
  }
  function notes() {
    const notes = [...data.notes].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return `${pageHead('Ruang catatan', 'Simpan prompt, ide, tulisan, atau data penting dalam satu tempat.', `<button class="button" data-modal="note">＋ Catatan baru</button>`)}${notes.length ? `<div class="note-grid">${notes.map(note => `<article class="note-card"><h3>${escapeHtml(note.title || 'Tanpa judul')}</h3><p>${escapeHtml(note.body)}</p><div class="note-bottom"><span>Diubah ${dateLabel(note.updated, { day: 'numeric', month: 'short' })}</span><div class="note-tools"><button class="note-open" data-action="open-note" data-id="${note.id}">Buka</button><button data-action="edit-note" data-id="${note.id}">Ubah</button><button data-action="delete-note" data-id="${note.id}">Hapus</button></div></div></article>`).join('')}</div>` : `<section class="panel">${empty(bookIcon, 'Ruang ini masih kosong', 'Tulis prompt, ide usaha, daftar belanja, atau apa pun yang ingin Anda simpan.', '<button class="button small" data-modal="note">＋ Tulis catatan</button>')}</section>`}`;
  }
  function settings() {
    const groups = [['income', 'Kategori pemasukan'], ['expense', 'Kategori pengeluaran'], ['debt', 'Kategori cicilan']];
    const account = window.RuangBackend.session();
    const accountBlock = account?.user ? `<section class="panel settings-block"><h2>Akun & sinkronisasi antarponsel</h2><p>Masuk dengan akun yang sama di laptop dan HP. Data cloud diperiksa saat aplikasi dibuka, setelah disimpan, dan setiap 15 detik saat aplikasi aktif. Cache lokal membantu PWA berjalan offline; perubahan offline dikirim saat koneksi kembali.</p><div class="info-box sync"><strong>${escapeHtml(account.user.email || 'Akun Ruang Arus')}</strong>${window.RuangBackend.enabled() ? 'Sinkronisasi cloud aktif untuk akun ini.' : 'Masuk ke akun untuk mengaktifkan sinkronisasi cloud.'}</div><div class="toolbar" style="margin-top:14px"><button class="button" data-action="sync-now">↻ Sinkronkan sekarang</button><button class="button secondary" data-action="wa-code">Buat kode tautan WhatsApp</button><button class="button quiet" data-action="sign-out">Keluar akun</button></div><p id="whatsapp-code-result" class="field-hint"></p></section>` : `<section class="panel settings-block"><h2>Akun & sinkronisasi antarponsel</h2><p>Masuk dengan akun yang sama di laptop dan HP. Setelah masuk, catatan di perangkat ini otomatis digabungkan ke cloud dan disinkronkan.</p><form id="account-form" class="account-form"><div class="field"><label for="account-email">Email</label><input id="account-email" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="account-password">Kata sandi</label><input id="account-password" name="password" type="password" autocomplete="current-password" minlength="8" required><small>Minimal 8 karakter. Kata sandi tidak disimpan oleh aplikasi.</small></div><div class="toolbar"><button class="button" type="submit" data-auth-mode="signin">Masuk</button><button class="button secondary" type="submit" data-auth-mode="signup">Buat akun</button></div><p id="account-message" class="field-hint" aria-live="polite"></p></form></section>`;
    return `${pageHead('Pengaturan & data', 'Atur kategori dan kelola salinan data Anda.')}
      ${accountBlock}
      <section class="panel settings-block"><h2>Kategori pencatatan</h2><p>Sesuaikan dengan istilah yang paling mudah Anda kenali. Menghapus kategori tidak menghapus catatan lama.</p><div class="category-settings">${groups.map(([key, label]) => `<div class="category-group"><div class="category-group-head"><strong>${label}</strong><button class="button secondary small" data-modal="category" data-group="${key}">＋ Tambah kategori</button></div><div class="category-pills">${data.categories[key].map((item, index) => `<span class="category-pill">${escapeHtml(item)}${index > 0 ? `<button data-action="delete-category" data-group="${key}" data-index="${index}" aria-label="Hapus kategori ${escapeHtml(item)}">×</button>` : ''}</span>`).join('')}</div></div>`).join('')}</div></section>
      <section class="panel settings-block"><h2>Cadangan & pemindahan data</h2><p>Unduh salinan lengkap untuk arsip. Cadangan tetap disarankan walau sinkronisasi aktif.</p><div class="toolbar" style="margin-top:15px"><button class="button" data-action="export">↓ Unduh cadangan</button><button class="button secondary" data-action="import">↑ Impor cadangan</button><input id="import-file" type="file" accept="application/json,.json" hidden></div>${pendingImport ? `<div class="import-preview"><strong>Cadangan siap dipulihkan</strong><p>Data lokal akan diganti dengan isi berkas: ${pendingImport.transactions.length} transaksi pribadi, ${pendingImport.business.length} rekap usaha, ${pendingImport.installments.length} cicilan, dan ${pendingImport.notes.length} catatan.</p><div class="toolbar"><button class="button" data-action="apply-import">Ganti dengan cadangan</button><button class="button secondary" data-action="cancel-import">Batalkan</button></div></div>` : ''}</section>
      <section class="panel settings-block"><h2>Pasang aplikasi di ponsel</h2><p>Buka situs HTTPS ini di kedua ponsel agar Ruang Arus bisa dipasang ke layar utama dan dibuka seperti aplikasi.</p><div class="info-box sync"><strong>Android</strong>Buka melalui Chrome, tekan menu browser, lalu pilih Install app atau Tambahkan ke layar utama.<br><br><strong>iPhone</strong>Buka melalui Safari, tekan Bagikan, lalu pilih Tambahkan ke Layar Utama.</div></section>
      <section class="panel settings-block"><h2>Pengingat penyimpanan</h2><p>Data tersimpan di browser pada perangkat ini. Menghapus data browser atau memakai mode privat dapat menghilangkan catatan yang belum dicadangkan.</p><div class="info-box"><strong>Cadangkan secara berkala</strong>Setelah mengunduh, simpan berkas cadangan di tempat yang aman dan mudah Anda temukan kembali.</div></section>`;
  }
  function render() {
    const map = { dashboard, personal, business, savings, notes, settings };
    const labels = { dashboard: 'Ringkasan keuangan', personal: 'Keuangan pribadi', business: 'Keuangan usaha', savings: 'Tabungan', notes: 'Ruang catatan', settings: 'Pengaturan & data' };
    el('#top-context').textContent = labels[page];
    el('#today-label').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(today);
    const mobileAccount = el('#mobile-account');
    const accountSignedIn = Boolean(window.RuangBackend?.session()?.user);
    mobileAccount.textContent = accountSignedIn ? 'Akun' : 'Masuk';
    mobileAccount.setAttribute('aria-label', accountSignedIn ? 'Buka pengaturan akun' : 'Masuk ke akun Ruang Arus');
    el('#page-content').innerHTML = map[page]();
    document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  }
  function modal(title, subtitle, content, onSubmit, submitLabel = 'Simpan catatan') {
    pushOverlayState();
    el('#modal-root').innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Tutup">×</button></header><form id="active-form">${content}<footer class="modal-footer"><button class="button secondary" type="button" data-close-modal>Batal</button><button class="button" type="submit">${submitLabel}</button></footer></form></section></div>`;
    const root = el('#modal-root'); root.querySelector('[data-close-modal]').focus();
    root.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
    root.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
    root.querySelector('#active-form').addEventListener('submit', event => { event.preventDefault(); el('#active-form .form-error')?.remove(); const fd = new FormData(event.currentTarget); if (onSubmit(fd) !== false) closeModal(); });
  }
  function closeModal(navigateHistory = true) {
    const shouldGoBack = navigateHistory && overlayOpen && history.state?.ruangArus && history.state.overlay;
    overlayOpen = false;
    el('#modal-root').innerHTML = '';
    if (shouldGoBack) history.back();
  }
  function detailModal(title, subtitle, content, action = '') {
    pushOverlayState();
    el('#modal-root').innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Tutup">×</button></header><div class="detail-content">${content}</div><footer class="modal-footer">${action}<button class="button secondary" type="button" data-close-modal>Tutup</button></footer></section></div>`;
    const root = el('#modal-root');
    root.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal()));
    root.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
    root.querySelector('[data-close-modal]')?.focus();
  }
  function openTransactionDetails(tx) {
    const label = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    detailModal(tx.title || tx.category || 'Rincian transaksi', `${label} · ${dateLabel(tx.date)}`, `<div class="detail-amount ${tx.type === 'expense' ? 'negative' : ''}">${tx.type === 'expense' ? '−' : '+'}${money(tx.amount)}</div><dl class="detail-list"><div><dt>Kategori</dt><dd>${escapeHtml(tx.category || 'Lainnya')}</dd></div><div><dt>Tanggal</dt><dd>${dateLabel(tx.date)}</dd></div>${tx.source ? `<div><dt>Sumber dana</dt><dd>${escapeHtml(tx.source)}</dd></div>` : ''}${tx.entryMethod ? `<div><dt>Dicatat melalui</dt><dd>${escapeHtml(tx.entryMethod === 'photo-ocr' ? 'Baca dari foto' : tx.entryMethod === 'business' ? 'Rekap usaha' : tx.entryMethod)}</dd></div>` : ''}${tx.note ? `<div class="detail-note"><dt>Catatan</dt><dd>${escapeHtml(tx.note)}</dd></div>` : ''}</dl>`);
  }
  function openNoteDetails(note) {
    detailModal(note.title || 'Tanpa judul', `Catatan · diubah ${dateLabel(note.updated, { day: 'numeric', month: 'long', year: 'numeric' })}`, `<div class="note-detail-body">${escapeHtml(note.body)}</div>`, `<button class="button secondary" type="button" data-action="copy-note" data-id="${note.id}">Salin</button><button class="button" type="button" data-action="edit-note" data-id="${note.id}">Ubah catatan</button>`);
  }
  function selectOptions(options, selected = '') { return options.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`).join(''); }
  function amountField(label, name, value = '') { return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="number" min="0" step="1" inputmode="numeric" value="${value}" placeholder="0" required></div>`; }
  function openTransaction(type = 'expense', preset = null) {
    const isIncome = type === 'income'; const group = isIncome ? 'income' : 'expense';
    modal(isIncome ? 'Catat pemasukan' : 'Catat pengeluaran', isIncome ? 'Simpan gaji atau pemasukan lain yang Anda terima.' : 'Simpan pengeluaran agar alur uang harian tetap jelas.', `<div class="form-grid"><div class="field full"><label for="tx-title">Keterangan</label><input id="tx-title" name="title" maxlength="80" value="${escapeHtml(preset?.title || '')}" placeholder="Contoh: Gaji bulan November" required></div><div class="field"><label for="tx-category">Kategori</label><select id="tx-category" name="category">${selectOptions(data.categories[group], preset?.category || '')}</select></div><div class="field"><label for="tx-date">Tanggal</label><input id="tx-date" name="date" type="date" value="${preset?.date || isoToday}" required></div><div class="field full"><label for="tx-amount">Jumlah (rupiah)</label><input id="tx-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${preset?.amount || ''}" placeholder="0" required></div><div class="field full"><label for="tx-note">Catatan tambahan <span class="field-hint">(opsional)</span></label><input id="tx-note" name="note" maxlength="180" placeholder="Tambahkan detail bila perlu"></div></div>`, fd => { const timestamp = new Date().toISOString(); data.transactions.push({ id: crypto.randomUUID(), type, title: fd.get('title').trim(), category: fd.get('category'), date: fd.get('date'), amount: Number(fd.get('amount')), note: fd.get('note').trim(), entryMethod: preset?.entryMethod || 'manual', created: timestamp, updatedAt: timestamp }); save(); });
  }
  function openPhotoCapture() {
    modal('Baca dari foto', 'Pilih foto atau screenshot struk. Gambar dianalisis di browser pada perangkat ini dan tidak diunggah.', `<div class="field"><label for="receipt-image">Foto atau screenshot</label><input id="receipt-image" type="file" accept="image/*" capture="environment" required><small>Untuk hasil terbaik, pastikan nominal dan teks struk terbaca.</small></div><div id="ocr-status" class="info-box sync" style="margin-top:14px">OCR bahasa Indonesia memerlukan koneksi internet saat pertama kali memuat mesin baca.</div>`, () => false, 'Tutup');
    const root = el('#modal-root');
    root.querySelector('.modal-footer').innerHTML = '<button class="button secondary" type="button" data-close-modal>Tutup</button><button class="button" type="button" data-action="read-photo">Baca foto</button>';
    root.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  }
  function mergeSnapshot(local, remote) {
    const merged = { ...structuredClone(defaults), ...local, categories: { ...defaults.categories, ...(local.categories || {}) } };
    const deleted = new Set([...(local.syncDeleted || []), ...(remote.syncDeleted || [])]); merged.syncDeleted = [...deleted];
    merged.syncDeletedBusiness = [...new Set([...(local.syncDeletedBusiness || []), ...(remote.syncDeletedBusiness || [])])];
    merged.syncDeletedCategories = { ...(remote.syncDeletedCategories || {}), ...(local.syncDeletedCategories || {}) };
    const keys = ['transactions', 'business', 'installments', 'notes', 'savingsGoals', 'savingsTransfers'];
    const writeTime = item => Date.parse(item.updatedAt || item.updated_at || item.updated || item.created || '') || 0;
    for (const key of keys) {
      const all = new Map();
      for (const item of [...(local[key] || []), ...(remote[key] || [])]) {
        if (deleted.has(item.id)) continue;
        const current = all.get(item.id);
        if (!current || writeTime(item) >= writeTime(current)) all.set(item.id, item);
      }
      merged[key] = [...all.values()];
    }
    merged.categories = Object.fromEntries(Object.keys(defaults.categories).map(key => [key, [...new Set([...(remote.categories?.[key] || []), ...(local.categories?.[key] || [])])].filter(value => !merged.syncDeletedCategories[key]?.includes(value))]));
    merged.budgetUpdatedAt = { ...(remote.budgetUpdatedAt || {}), ...(local.budgetUpdatedAt || {}) };
    merged.budgets = { ...(remote.budgets || {}) };
    for (const [key, value] of Object.entries(local.budgets || {})) {
      if (!(key in merged.budgets) || (Date.parse(local.budgetUpdatedAt?.[key] || '') || 0) >= (Date.parse(remote.budgetUpdatedAt?.[key] || '') || 0)) merged.budgets[key] = value;
    }
    return merged;
  }
  async function syncCloud(announce = true) {
    if (!window.RuangBackend.enabled() || pendingDeletions.size) return;
    if (syncInProgress) { syncQueued = true; return; }
    syncInProgress = true;
    try {
      const row = await window.RuangBackend.getSnapshot();
      const remote = row?.payload || null;
      if (remote) data = mergeSnapshot(data, remote);
      const needsUpload = !remote || JSON.stringify(data) !== JSON.stringify(remote);
      if (needsUpload) await window.RuangBackend.putSnapshot(data);
      localStorage.setItem(KEY, JSON.stringify(data)); render();
      if (announce) toast('Sinkronisasi selesai. Perangkat dan cloud sudah diperbarui.');
      syncErrorAt = 0; syncErrorMessage = '';
    } catch (error) {
      const message = `Sinkronisasi belum berhasil: ${error.message}`;
      if (announce || message !== syncErrorMessage || Date.now() - syncErrorAt > 60_000) toast(message, 'error');
      syncErrorMessage = message; syncErrorAt = Date.now();
    } finally {
      syncInProgress = false;
      if (syncQueued) { syncQueued = false; setTimeout(() => syncCloud(false), 300); }
    }
  }
  function accountSubmit(form, mode) {
    const fd = new FormData(form), msg = form.querySelector('#account-message');
    msg.textContent = 'Menghubungkan ke layanan akun…';
    const fn = mode === 'signup' ? window.RuangBackend.signUp : window.RuangBackend.signIn;
    fn(fd.get('email').trim(), fd.get('password')).then(result => {
      if (!result.access_token) { msg.textContent = 'Akun dibuat. Periksa email untuk konfirmasi, lalu kembali dan masuk.'; return; }
      render(); syncCloud(true);
    }).catch(error => { msg.textContent = error.message; });
  }
  function openBudget() {
    const current = Number(data.budgets[selectedMonth()] || 0);
    modal('Atur budget bulanan', `Tetapkan batas pengeluaran pribadi untuk ${monthName()}.`, `<div class="form-grid"><div class="field full"><label for="budget-amount">Budget pengeluaran (rupiah)</label><input id="budget-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${current || ''}" placeholder="Contoh: 3000000" required></div><p class="field-hint field full">Budget hanya alat bantu pencatatan. Usaha dan tabungan tidak dihitung sebagai pengeluaran pribadi di bagian ini.</p>${current ? '<button type="button" class="button quiet field full" data-action="clear-budget">Hapus budget bulan ini</button>' : ''}</div>`, fd => { data.budgets[selectedMonth()] = Number(fd.get('amount')); data.budgetUpdatedAt[selectedMonth()] = new Date().toISOString(); save(); }, 'Simpan budget');
  }
  function openSavingsGoal() {
    modal('Buat target tabungan', 'Beri nama tujuan dan tentukan nominal yang ingin dicapai.', `<div class="form-grid"><div class="field full"><label for="goal-title">Nama tujuan</label><input id="goal-title" name="title" maxlength="70" placeholder="Contoh: Dana pendidikan" required></div>${amountField('Nominal target', 'target')}${amountField('Sudah disisihkan', 'saved', '0')}<div class="field full"><label for="goal-note">Catatan <span class="field-hint">(opsional)</span></label><input id="goal-note" name="note" maxlength="150" placeholder="Contoh: target sebelum Juni"></div></div>`, fd => {
      const target = Number(fd.get('target')), saved = Number(fd.get('saved'));
      if (saved > target) { formError('Nominal yang disisihkan tidak boleh melebihi target.'); return false; }
      const timestamp = new Date().toISOString(); data.savingsGoals.push({ id: crypto.randomUUID(), title: fd.get('title').trim(), target, saved, note: fd.get('note').trim(), created: timestamp, updatedAt: timestamp }); save();
    }, 'Simpan target');
  }
  function openSavingTransfer(goal) {
    const left = Math.max(0, Number(goal.target) - Number(goal.saved));
    if (!left) return;
    modal(`Setor ke ${escapeHtml(goal.title)}`, `Sisa target ${money(left)}. Setoran ini mengurangi sisa uang bulan berjalan.`, `<div class="form-grid"><div class="field full"><label for="saving-amount">Nominal setoran (rupiah)</label><input id="saving-amount" name="amount" type="number" min="1" max="${left}" step="1" inputmode="numeric" placeholder="0" required></div><div class="field full"><label for="saving-date">Tanggal disisihkan</label><input id="saving-date" name="date" type="date" value="${isoToday}" required></div></div>`, fd => {
      const amount = Number(fd.get('amount'));
      if (amount > left) { formError(`Setoran tidak boleh melebihi sisa target ${money(left)}.`); return false; }
      const timestamp = new Date().toISOString(); goal.saved = Number(goal.saved) + amount; goal.updatedAt = timestamp;
      data.savingsTransfers.push({ id: crypto.randomUUID(), goalId: goal.id, amount, date: fd.get('date'), created: timestamp, updatedAt: timestamp }); save();
    }, 'Simpan setoran');
  }
  function openQuickMenu() {
    pushOverlayState();
    el('#modal-root').innerHTML = `<div class="modal-backdrop" data-dismiss="true"><section class="quick-menu" role="dialog" aria-modal="true" aria-labelledby="quick-title"><header><div><h2 id="quick-title">Tambah catatan</h2><p>Pilih jenis catatan yang ingin dibuat.</p></div><button class="modal-close" data-close-modal aria-label="Tutup">×</button></header><div class="quick-menu-grid"><button data-modal="transaction" data-type="income"><span>↓</span>Pemasukan</button><button data-modal="transaction" data-type="expense"><span>↑</span>Pengeluaran</button><button data-modal="business"><span>${investmentIcon}</span>Rekap usaha</button><button data-modal="savings-goal"><span>${rupiahCoinIcon}</span>Target tabungan</button><button data-modal="note"><span>${bookIcon}</span>Catatan</button><button data-action="photo-capture"><span>▧</span>Baca dari foto</button></div></section></div>`;
    const root = el('#modal-root'); root.querySelector('[data-close-modal]').focus(); root.querySelector('[data-close-modal]').addEventListener('click', closeModal); root.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  }
  function openBusiness() {
    const existing = data.business.find(x => x.date === isoToday);
    modal(existing ? 'Perbarui rekap hari ini' : 'Catat keuangan usaha', 'Laba bersih usaha dihitung setelah HPP dan biaya. Omset dikurangi HPP otomatis dicatat sebagai pendapatan usaha di ruang pribadi.', `<div class="form-grid"><div class="field full"><label for="business-date">Tanggal rekap</label><input id="business-date" name="date" type="date" value="${existing?.date || isoToday}" required></div>${amountField('Total omset', 'turnover', existing?.turnover || '')}${amountField('HPP', 'hpp', existing?.hpp || '')}${amountField('Biaya per hari', 'cost', existing?.cost || '')}<div class="field full"><label for="business-note">Catatan <span class="field-hint">(opsional)</span></label><input id="business-note" name="note" maxlength="150" value="${escapeHtml(existing?.note || '')}" placeholder="Contoh: ramai saat makan siang"></div></div>`, fd => {
      const date = fd.get('date'); const previous = data.business.findIndex(x => x.date === date);
      const oldEntry = previous >= 0 ? data.business[previous] : null;
      const timestamp = new Date().toISOString();
      const entry = { ...oldEntry, id: oldEntry?.id || crypto.randomUUID(), date, turnover: Number(fd.get('turnover')), hpp: Number(fd.get('hpp')), cost: Number(fd.get('cost')), note: fd.get('note').trim(), created: oldEntry?.created || timestamp, updatedAt: timestamp };
      if (previous >= 0) data.business[previous] = entry; else data.business.push(entry);
      const personalIncome = data.transactions.find(tx => tx.id === entry.personalIncomeId || tx.businessEntryId === entry.id);
      const grossProfit = entry.turnover - entry.hpp;
      if (grossProfit > 0) {
        const tx = { id: personalIncome?.id || crypto.randomUUID(), type: 'income', title: `Keuntungan usaha · ${dateLabel(date, { day: 'numeric', month: 'short' })}`, category: 'Pendapatan usaha', date, amount: grossProfit, note: `Omset ${money(entry.turnover)} − HPP ${money(entry.hpp)}. Biaya harian dicatat terpisah di ruang usaha.`, source: 'Usaha', entryMethod: 'business', businessEntryId: entry.id, created: personalIncome?.created || timestamp, updatedAt: timestamp };
        if (personalIncome) data.transactions[data.transactions.indexOf(personalIncome)] = tx; else data.transactions.push(tx);
        entry.personalIncomeId = tx.id;
        data.syncDeleted = (data.syncDeleted || []).filter(id => id !== tx.id);
      } else if (personalIncome) {
        data.transactions = data.transactions.filter(tx => tx.id !== personalIncome.id);
        data.syncDeleted ||= []; data.syncDeleted.push(personalIncome.id); delete entry.personalIncomeId;
      }
      if (!data.categories.income.includes('Pendapatan usaha')) data.categories.income.push('Pendapatan usaha');
      save();
    });
  }
  function openInstallment() {
    modal('Tambah cicilan', 'Catat total kewajiban dan jumlah yang sudah Anda bayarkan sejauh ini.', `<div class="form-grid"><div class="field full"><label for="debt-name">Nama cicilan</label><input id="debt-name" name="name" maxlength="80" placeholder="Contoh: Cicilan motor" required></div><div class="field"><label for="debt-category">Kategori</label><select id="debt-category" name="category">${selectOptions(data.categories.debt)}</select></div><div class="field">${''}</div>${amountField('Total cicilan', 'total')}${amountField('Sudah dibayar', 'paid', '0')}<div class="field full"><label for="debt-note">Catatan <span class="field-hint">(opsional)</span></label><input id="debt-note" name="note" maxlength="150" placeholder="Contoh: jatuh tempo tanggal 10"></div></div>`, fd => {
      const total = Number(fd.get('total')), paid = Number(fd.get('paid'));
      if (paid > total) { formError('Jumlah yang sudah dibayar tidak boleh melebihi total cicilan.'); return false; }
      const timestamp = new Date().toISOString(); data.installments.push({ id: crypto.randomUUID(), name: fd.get('name').trim(), category: fd.get('category'), total, paid, note: fd.get('note').trim(), created: timestamp, updatedAt: timestamp }); save();
    });
  }
  function payInstallment(item) {
    const left = Number(item.total) - Number(item.paid);
    modal(`Bayar ${escapeHtml(item.name)}`, `Sisa cicilan saat ini ${money(left)}. Pembayaran juga dicatat sebagai pengeluaran pribadi.`, `<div class="form-grid"><div class="field full"><label for="pay-amount">Jumlah pembayaran (rupiah)</label><input id="pay-amount" name="amount" type="number" min="1" max="${left}" step="1" inputmode="numeric" placeholder="0" required></div><div class="field full"><label for="pay-date">Tanggal bayar</label><input id="pay-date" name="date" type="date" value="${isoToday}" required></div></div>`, fd => {
      const amount = Number(fd.get('amount'));
      if (amount > left) { formError(`Pembayaran tidak boleh melebihi sisa cicilan ${money(left)}.`); return false; }
      const timestamp = new Date().toISOString(); item.paid = Number(item.paid) + amount; item.updatedAt = timestamp;
      data.transactions.push({ id: crypto.randomUUID(), type: 'expense', title: `Pembayaran cicilan · ${item.name}`, category: 'Cicilan', date: fd.get('date'), amount, note: '', created: timestamp, updatedAt: timestamp }); save();
    }, 'Simpan pembayaran');
  }
  function openNote(note = null) {
    modal(note ? 'Ubah catatan' : 'Catatan baru', 'Tulis bebas dan simpan untuk dibuka kembali kapan saja.', `<div class="form-grid"><div class="field full"><label for="note-title">Judul</label><input id="note-title" name="title" maxlength="100" value="${escapeHtml(note?.title || '')}" placeholder="Contoh: Ide menu baru"></div><div class="field full"><label for="note-body">Isi catatan</label><textarea id="note-body" name="body" maxlength="12000" placeholder="Tulis prompt, tulisan, data, atau ide di sini…" required>${escapeHtml(note?.body || '')}</textarea></div></div>`, fd => {
      const timestamp = new Date().toISOString(); const entry = { id: note?.id || crypto.randomUUID(), title: fd.get('title').trim(), body: fd.get('body').trim(), updated: isoToday, updatedAt: timestamp };
      if (note) data.notes[data.notes.findIndex(x => x.id === note.id)] = entry; else data.notes.push(entry); save();
    }, 'Simpan catatan');
  }
  function openCategory(group) {
    const labels = { income: 'pemasukan', expense: 'pengeluaran', debt: 'cicilan' };
    modal('Tambah kategori', `Buat kategori baru untuk ${labels[group]}.`, `<div class="field"><label for="category-name">Nama kategori</label><input id="category-name" name="name" maxlength="32" placeholder="Contoh: Pendidikan" required></div>`, fd => {
      const name = fd.get('name').trim(); if (data.categories[group].some(x => x.toLowerCase() === name.toLowerCase())) { formError('Kategori tersebut sudah ada.'); return false; }
      data.categories[group].push(name); data.syncDeletedCategories[group] = (data.syncDeletedCategories[group] || []).filter(value => value !== name); save();
    }, 'Tambah kategori');
  }
  function remove(id, collection, label) {
    const key = `${collection}:${id}`;
    undoableDelete(key, `${label[0].toUpperCase()}${label.slice(1)} dihapus.`, () => {
      const removed = data[collection].find(item => item.id === id);
      const linked = collection === 'business' && removed?.personalIncomeId ? data.transactions.find(tx => tx.id === removed.personalIncomeId) : null;
      data[collection] = data[collection].filter(item => item.id !== id); if (linked) data.transactions = data.transactions.filter(tx => tx.id !== linked.id);
      return { removed, linked };
    }, ({ removed, linked }) => { if (removed) data[collection].push(removed); if (linked) data.transactions.push(linked); }, ({ linked }) => {
      data.syncDeleted ||= []; data.syncDeleted.push(id); if (collection === 'business') { data.syncDeletedBusiness ||= []; data.syncDeletedBusiness.push(id); } if (linked) data.syncDeleted.push(linked.id);
    });
  }
  function exportData() {
    const payload = { ...data, exportedAt: new Date().toISOString(), app: 'ruang-arus' };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `cadangan-ruang-arus-${isoToday}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function importData(file) {
    if (!file) return; const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!incoming || !Array.isArray(incoming.transactions) || !Array.isArray(incoming.business) || !Array.isArray(incoming.installments) || !Array.isArray(incoming.notes)) throw new Error();
        pendingImport = { ...structuredClone(defaults), ...incoming, categories: { ...defaults.categories, ...(incoming.categories || {}) } }; render();
      } catch { toast('Berkas tidak cocok atau rusak. Pilih cadangan Ruang Arus berformat JSON.', 'error'); }
    };
    reader.onerror = () => toast('Berkas cadangan tidak dapat dibaca.', 'error');
    reader.readAsText(file);
  }
  function applyImport() { if (!pendingImport) return; data = pendingImport; pendingImport = null; save(); toast('Cadangan berhasil dimuat.'); }
  document.addEventListener('click', event => {
    const authButton = event.target.closest('[data-auth-mode]'); if (authButton) { event.preventDefault(); const form = authButton.closest('form'); if (form) accountSubmit(form, authButton.dataset.authMode); return; }
    const pageButton = event.target.closest('[data-page]'); if (pageButton) { setPage(pageButton.dataset.page); return; }
    const monthButton = event.target.closest('[data-month]'); if (monthButton) { monthOffset += Number(monthButton.dataset.month); render(); return; }
    const tab = event.target.closest('[data-tab]'); if (tab) { if (personalTab !== tab.dataset.tab) { personalTab = tab.dataset.tab; history.pushState(routeState(), '', location.href); render(); } return; }
    const modalButton = event.target.closest('[data-modal]'); if (modalButton) {
      const kind = modalButton.dataset.modal;
      if (kind === 'transaction') openTransaction(modalButton.dataset.type || 'expense');
      if (kind === 'business') openBusiness(); if (kind === 'installment') openInstallment(); if (kind === 'note') openNote(); if (kind === 'category') openCategory(modalButton.dataset.group);
      if (kind === 'budget') openBudget(); if (kind === 'savings-goal') openSavingsGoal();
      return;
    }
    const action = event.target.closest('[data-action]'); if (!action) return;
    const { action: name, id } = action.dataset;
    if (name === 'open-tx') { const tx = data.transactions.find(item => item.id === id); if (tx) openTransactionDetails(tx); }
    if (name === 'copy-note') { const note = data.notes.find(item => item.id === id); if (note) copyNote(note, action); }
    if (name === 'delete-tx') remove(id, 'transactions', 'transaksi');
    if (name === 'delete-business') remove(id, 'business', 'rekap');
    if (name === 'delete-installment') remove(id, 'installments', 'cicilan');
    if (name === 'pay-installment') { const item = data.installments.find(x => x.id === id); if (item) payInstallment(item); }
    if (name === 'open-note' || name === 'edit-note') { const note = data.notes.find(x => x.id === id); if (note) name === 'open-note' ? openNoteDetails(note) : openNote(note); }
    if (name === 'delete-note') remove(id, 'notes', 'catatan');
    if (name === 'add-saving') { const goal = data.savingsGoals.find(x => x.id === id); if (goal) openSavingTransfer(goal); }
    if (name === 'delete-goal') undoableDelete(`goal:${id}`, 'Target tabungan dihapus.', () => { const goal = data.savingsGoals.find(x => x.id === id); const transfers = data.savingsTransfers.filter(x => x.goalId === id); data.savingsGoals = data.savingsGoals.filter(x => x.id !== id); data.savingsTransfers = data.savingsTransfers.filter(x => x.goalId !== id); return { goal, transfers }; }, ({ goal, transfers }) => { if (goal) data.savingsGoals.push(goal); data.savingsTransfers.push(...transfers); }, () => { data.syncDeleted ||= []; data.syncDeleted.push(id); });
    if (name === 'quick-menu') openQuickMenu();
    if (name === 'photo-capture') openPhotoCapture();
    if (name === 'enable-cloud') {
      if (!el('#cloud-consent')?.checked) { toast('Centang persetujuan sebelum mengaktifkan sinkronisasi.', 'error'); return; }
      window.RuangBackend.setEnabled(true); syncCloud(true); render();
    }
    if (name === 'sync-now') syncCloud(true);
    if (name === 'sign-out') window.RuangBackend.signOut().then(() => { render(); toast('Anda sudah keluar. Salinan cloud tetap tersimpan.'); }).catch(error => toast(error.message, 'error'));
    if (name === 'wa-code') window.RuangBackend.makeLinkCode().then(code => { const target = el('#whatsapp-code-result'); if (target) target.textContent = `Kirim “hubungkan ${code}” ke nomor WhatsApp Business bot Anda dalam 15 menit.`; }).catch(error => toast(error.message, 'error'));
    if (name === 'read-photo') readPhoto();
    if (name === 'toggle-amounts') { amountsHidden = !amountsHidden; render(); }
    if (name === 'clear-budget') { data.budgets[selectedMonth()] = null; data.budgetUpdatedAt[selectedMonth()] = new Date().toISOString(); save(); closeModal(); }
    if (name === 'delete-category') { const { group, index } = action.dataset; if (Number(index) > 0) undoableDelete(crypto.randomUUID(), 'Kategori dihapus. Catatan lama tetap tersimpan.', () => ({ value: data.categories[group].splice(Number(index), 1)[0], index: Number(index), group }), snap => data.categories[snap.group].splice(snap.index, 0, snap.value), snap => { data.syncDeletedCategories ||= {}; data.syncDeletedCategories[snap.group] ||= []; data.syncDeletedCategories[snap.group].push(snap.value); }); }
    if (name === 'export') { exportData(); toast('Cadangan berhasil diunduh.'); } if (name === 'import') el('#import-file').click();
    if (name === 'apply-import') applyImport(); if (name === 'cancel-import') { pendingImport = null; render(); }
  });
  document.addEventListener('change', event => { if (event.target.id === 'import-file') importData(event.target.files?.[0]); });
  async function copyNote(note, button) {
    const text = [note.title?.trim(), note.body || ''].filter(Boolean).join('\n\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select(); const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Clipboard tidak tersedia.');
      }
      const previous = button.textContent; button.textContent = 'Tersalin'; button.disabled = true;
      setTimeout(() => { if (button.isConnected) { button.textContent = previous; button.disabled = false; } }, 1400);
    } catch { toast('Catatan belum bisa disalin. Tekan lama pada teks lalu pilih Salin.', 'error'); }
  }
  async function readPhoto() {
    const file = el('#receipt-image')?.files?.[0]; if (!file) { const status = el('#ocr-status'); if (status) status.textContent = 'Pilih foto atau screenshot struk dahulu.'; return; }
    const status = el('#ocr-status'); const button = el('[data-action="read-photo"]'); button.disabled = true; status.textContent = 'Memuat pembaca teks dan memeriksa foto…';
    try {
      if (!window.Tesseract) await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js'; script.onload = resolve; script.onerror = () => reject(new Error('Pembaca OCR tidak dapat dimuat. Periksa koneksi internet.')); document.head.appendChild(script); });
      const worker = await window.Tesseract.createWorker('ind');
      const result = await worker.recognize(file); await worker.terminate();
      const text = result.data.text || '';
      const matches = [...text.matchAll(/(?:rp\s*)?([0-9][0-9.,\s]{2,})/gi)].map(m => Number(m[1].replace(/\D/g, ''))).filter(n => n >= 100);
      if (!matches.length) throw new Error('Nominal belum terbaca. Coba foto yang lebih jelas atau isi manual.');
      const amount = Math.max(...matches);
      const lines = text.split(/\r?\n/).map(x => x.trim()).filter(x => x.length > 2 && !/\d{3,}|total|subtotal|tunai|kembali|rp\b/i.test(x));
      const title = lines[0] ? `Pembelian · ${lines[0].slice(0, 48)}` : 'Pembelian dari struk';
      const category = /bensin|pertalite|pertamax/i.test(text) ? 'Bensin' : /kopi|es|snack|jajan/i.test(text) ? 'Jajan' : /makan|resto|warung|nasi/i.test(text) ? 'Makan' : 'Lainnya';
      closeModal(); openTransaction('expense', { amount, title, category, entryMethod: 'photo-ocr' });
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  }
  window.addEventListener('popstate', event => {
    const state = event.state;
    if (overlayOpen && !state?.overlay) closeModal(false);
    page = state?.ruangArus && ['dashboard', 'personal', 'business', 'savings', 'notes', 'settings'].includes(state.page) ? state.page : 'dashboard';
    if (state?.ruangArus && ['activity', 'debt', 'advice'].includes(state.personalTab)) personalTab = state.personalTab;
    if (state?.overlay && !el('#modal-root').firstElementChild) history.replaceState(routeState(false), '', location.href);
    overlayOpen = Boolean(state?.overlay && el('#modal-root').firstElementChild);
    render();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  history.replaceState(routeState(), '', location.href);
  render();
  if (window.RuangBackend.enabled()) setTimeout(() => syncCloud(false), 250);
  setInterval(() => { if (!document.hidden) syncCloud(false); }, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncCloud(false); });
  window.addEventListener('focus', () => syncCloud(false));
})();

(() => {
  'use strict';

  const PAGE_SIZE = 40;
  const STORAGE_KEY = 'taawon_cost_reviews_v1';

  const state = {
    albayan: [],          // array, index === idx
    skyItems: [],          // array
    matches: {},           // item_code -> match info
    reviews: {},           // item_code -> {status, albayan_idx, cost_override, ts}
    filter: 'all',
    search: '',
    branch: '',
    page: 1,
    activeCode: null,
    modalSearch: '',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function fmtNum(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function effective(code) {
    const rev = state.reviews[code];
    if (rev) {
      if (rev.status === 'confirmed' && rev.albayan_idx != null) {
        const a = state.albayan[rev.albayan_idx];
        return { source: 'manual_match', cost: a ? a.cost : null, albayan: a, albayan_idx: rev.albayan_idx, review: rev };
      }
      if (rev.status === 'manual_cost') {
        return { source: 'manual_cost', cost: rev.cost_override, albayan: null, albayan_idx: null, review: rev };
      }
      if (rev.status === 'no_match') {
        return { source: 'no_match', cost: null, albayan: null, albayan_idx: null, review: rev };
      }
    }
    const m = state.matches[code];
    if (m && m.status === 'matched' && m.albayan_idx != null) {
      const a = state.albayan[m.albayan_idx];
      return { source: 'barcode', cost: a ? a.cost : null, albayan: a, albayan_idx: m.albayan_idx, review: null };
    }
    return { source: 'unresolved', cost: null, albayan: null, albayan_idx: null, review: null };
  }

  function statusOf(code) {
    const eff = effective(code);
    if (eff.source === 'barcode') return 'matched';
    if (eff.source === 'manual_match' || eff.source === 'manual_cost') return 'confirmed';
    if (eff.source === 'no_match') return 'confirmed';
    const m = state.matches[code];
    if (m && m.status === 'needs_review') return 'review';
    return 'none';
  }

  function counts() {
    const c = { all: state.skyItems.length, matched: 0, review: 0, none: 0, confirmed: 0 };
    for (const s of state.skyItems) {
      const st = statusOf(s.item_code);
      if (st === 'matched') c.matched++;
      else if (st === 'review') c.review++;
      else if (st === 'none') c.none++;
      if (state.reviews[s.item_code]) c.confirmed++;
    }
    return c;
  }

  function branchList() {
    const set = new Set();
    for (const s of state.skyItems) for (const b of s.branches) if (b) set.add(b);
    return Array.from(set).sort();
  }

  function filteredItems() {
    let arr = state.skyItems;
    if (state.filter !== 'all') {
      arr = arr.filter((s) => {
        const st = statusOf(s.item_code);
        if (state.filter === 'reviewed') return !!state.reviews[s.item_code];
        return st === state.filter;
      });
    }
    if (state.branch) {
      arr = arr.filter((s) => s.branches.includes(state.branch));
    }
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      arr = arr.filter((s) => (s.name || '').toLowerCase().includes(q) || s.item_code.includes(q));
    }
    return arr;
  }

  // ---------------- rendering ----------------

  function chipHtml(code) {
    const st = statusOf(code);
    const rev = state.reviews[code];
    if (rev) return `<span class="chip confirmed">✓ روجعت يدوياً</span>`;
    if (st === 'matched') return `<span class="chip matched">✓ مطابق بالباركود</span>`;
    if (st === 'review') return `<span class="chip review">⚠ بحاجة مراجعة</span>`;
    return `<span class="chip none">✕ بدون تطابق</span>`;
  }

  function costCellHtml(s) {
    const eff = effective(s.item_code);
    if (eff.source === 'unresolved') return `<div class="cost-cell"><span class="pending">لم تُحسب بعد</span></div>`;
    if (eff.source === 'no_match') return `<div class="cost-cell"><span class="pending">بلا تكلفة مرجعية</span></div>`;
    return `<div class="cost-cell"><span class="new">${fmtNum(eff.cost)} د.ع</span></div>`;
  }

  function renderStats() {
    const c = counts();
    $('#statAll .num').textContent = fmtNum(c.all);
    $('#statMatched .num').textContent = fmtNum(c.matched);
    $('#statReview .num').textContent = fmtNum(c.review);
    $('#statNone .num').textContent = fmtNum(c.none);
    $('#statConfirmed .num').textContent = fmtNum(c.confirmed);
    $$('.stat-tile').forEach((t) => t.classList.toggle('active', t.dataset.filter === state.filter));
  }

  function renderBranchOptions() {
    const sel = $('#branchSelect');
    if (sel.dataset.filled) return;
    sel.dataset.filled = '1';
    for (const b of branchList()) {
      const o = document.createElement('option');
      o.value = b; o.textContent = b;
      sel.appendChild(o);
    }
  }

  function renderList() {
    const arr = filteredItems();
    const totalPages = Math.max(1, Math.ceil(arr.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = arr.slice(start, start + PAGE_SIZE);

    const list = $('#list');
    if (!pageItems.length) {
      list.innerHTML = `<div class="empty-state">لا توجد مواد تطابق عوامل التصفية الحالية</div>`;
    } else {
      list.innerHTML = pageItems.map((s) => `
        <div class="row-card" data-code="${s.item_code}">
          <div class="row-main">
            <div class="row-name">${escapeHtml(s.name || '(بدون اسم)')}</div>
            <div class="row-meta">
              <code>${s.item_code}</code>
              <span>${escapeHtml(s.category || '')}</span>
              <span>${s.branches.length} فرع</span>
              <span>${s.n_lines} سطر</span>
            </div>
          </div>
          ${chipHtml(s.item_code)}
          ${costCellHtml(s)}
        </div>
      `).join('');
      $$('.row-card', list).forEach((el) => el.addEventListener('click', () => openModal(el.dataset.code)));
    }

    $('#pagerInfo').textContent = `صفحة ${state.page} من ${totalPages} — ${fmtNum(arr.length)} مادة`;
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= totalPages;
  }

  function renderAll() {
    renderStats();
    renderBranchOptions();
    renderList();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- modal ----------------

  function candidateCardHtml(cand, chosenIdx, scoreLabel) {
    const a = state.albayan[cand.albayan_idx];
    if (!a) return '';
    const chosen = chosenIdx === cand.albayan_idx;
    return `
      <div class="candidate ${chosen ? 'chosen' : ''}" data-idx="${cand.albayan_idx}">
        <div>
          <div class="cand-name">${escapeHtml(a.name || '(بدون اسم)')}</div>
          <div class="cand-meta">
            ${a.foreign_name ? escapeHtml(a.foreign_name) + ' · ' : ''}${a.scientific_name ? escapeHtml(a.scientific_name) + ' · ' : ''}
            ${a.barcode ? 'باركود ' + a.barcode + ' · ' : ''}
            الوحدة: ${escapeHtml(a.base_unit || '—')} · التكلفة: ${a.cost != null ? fmtNum(a.cost) + ' د.ع' : 'غير متوفرة'}
            ${a.cost_source === 'last_purchase' ? ' (آخر شراء)' : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          ${scoreLabel ? `<span class="cand-score">${scoreLabel}</span>` : ''}
          <button class="btn ${chosen ? 'primary' : ''}" data-action="confirm-cand" data-idx="${cand.albayan_idx}">${chosen ? '✓ مُعتمدة' : 'اعتماد هذه المطابقة'}</button>
        </div>
      </div>`;
  }

  function openModal(code) {
    state.activeCode = code;
    state.modalSearch = '';
    const s = state.skyItems.find((x) => x.item_code === code);
    if (!s) return;
    const overlay = $('#overlay');
    overlay.hidden = false;
    renderModal();
  }

  function closeModal() {
    $('#overlay').hidden = true;
    state.activeCode = null;
  }

  function renderModal() {
    const code = state.activeCode;
    if (!code) return;
    const s = state.skyItems.find((x) => x.item_code === code);
    const m = state.matches[code] || { candidates: [] };
    const rev = state.reviews[code];
    const eff = effective(code);

    $('#modalTitle').textContent = s.name || '(بدون اسم)';
    $('#modalSub').textContent = `كود ${s.item_code} · ${s.branches.join('، ')} · ${s.n_lines} سطر إدخال`;

    let body = '';
    body += `<div class="info-grid">
      <div><span>الفئة</span>${escapeHtml(s.category || '—')}</div>
      <div><span>العلامة التجارية</span>${escapeHtml(s.brand || '—')}</div>
      <div><span>الوحدات المستخدمة</span>${escapeHtml(s.units.join('، ') || '—')}</div>
      <div><span>الوحدة الأساسية</span>${escapeHtml(s.base_units.join('، ') || '—')}</div>
    </div>`;

    if (eff.source === 'barcode') {
      body += `<div>
        <div class="section-title">مطابقة تلقائية بالباركود ${s.barcode ? '(' + s.barcode + ')' : ''}</div>
        ${candidateCardHtml({ albayan_idx: eff.albayan_idx }, null, null)}
      </div>`;
    }

    if (eff.source !== 'barcode' && m.candidates && m.candidates.length) {
      body += `<div><div class="section-title">اقتراحات للمطابقة اليدوية</div>`;
      body += m.candidates.map((c) => candidateCardHtml(c, rev && rev.albayan_idx, 'تقارب ' + Math.round(c.score * 100) + '%')).join('');
      body += `</div>`;
    }

    body += `<div>
      <div class="section-title">بحث يدوي في ملف البيان القديم</div>
      <input type="search" id="modalSearchBox" placeholder="ابحث بالاسم أو الباركود..." style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-family:inherit;">
      <div class="search-results" id="modalSearchResults" style="margin-top:8px;"></div>
    </div>`;

    body += `<div>
      <div class="section-title">أو أدخل تكلفة يدوياً (إن لم توجد مادة مطابقة في البيان)</div>
      <div class="manual-cost">
        <input type="number" id="manualCostInput" placeholder="التكلفة لكل وحدة أساسية" value="${rev && rev.status === 'manual_cost' ? rev.cost_override : ''}">
        <button class="btn" data-action="save-manual-cost">حفظ كتكلفة يدوية</button>
      </div>
    </div>`;

    body += `<div style="display:flex; gap:8px;">
      <button class="btn" data-action="mark-no-match" style="flex:1;">${rev && rev.status === 'no_match' ? '✓ مُعلّمة: بلا تطابق' : 'تعليم: بلا تطابق (بحاجة تسعير يدوي لاحقاً في Sky)'}</button>
      ${rev ? `<button class="btn ghost" data-action="clear-review">مسح المراجعة</button>` : ''}
    </div>`;

    $('#modalBody').innerHTML = body;

    $$('[data-action="confirm-cand"]', $('#modalBody')).forEach((btn) => {
      btn.addEventListener('click', () => saveReview(code, { status: 'confirmed', albayan_idx: Number(btn.dataset.idx), cost_override: null, ts: Date.now() }));
    });
    const searchBox = $('#modalSearchBox');
    if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        state.modalSearch = e.target.value;
        renderModalSearch();
      });
    }
    const manualBtn = $('[data-action="save-manual-cost"]', $('#modalBody'));
    if (manualBtn) manualBtn.addEventListener('click', () => {
      const val = parseFloat($('#manualCostInput').value);
      if (!val || val <= 0) { toast('أدخل رقماً صحيحاً أكبر من صفر'); return; }
      saveReview(code, { status: 'manual_cost', albayan_idx: null, cost_override: val, ts: Date.now() });
    });
    const noMatchBtn = $('[data-action="mark-no-match"]', $('#modalBody'));
    if (noMatchBtn) noMatchBtn.addEventListener('click', () => saveReview(code, { status: 'no_match', albayan_idx: null, cost_override: null, ts: Date.now() }));
    const clearBtn = $('[data-action="clear-review"]', $('#modalBody'));
    if (clearBtn) clearBtn.addEventListener('click', () => clearReview(code));

    renderModalSearch();
  }

  function renderModalSearch() {
    const box = $('#modalSearchResults');
    if (!box) return;
    const q = state.modalSearch.trim().toLowerCase();
    if (q.length < 2) { box.innerHTML = ''; return; }
    const rev = state.reviews[state.activeCode];
    const results = [];
    for (const a of state.albayan) {
      const hay = (a.name + ' ' + a.foreign_name + ' ' + a.scientific_name + ' ' + (a.barcode_raw || '')).toLowerCase();
      if (hay.includes(q)) {
        results.push(a);
        if (results.length >= 25) break;
      }
    }
    if (!results.length) { box.innerHTML = `<div style="padding:10px;font-size:12.5px;color:var(--ink-dim);">لا نتائج</div>`; return; }
    box.innerHTML = results.map((a) => candidateCardHtml({ albayan_idx: a.idx }, rev && rev.albayan_idx, null)).join('');
    $$('[data-action="confirm-cand"]', box).forEach((btn) => {
      btn.addEventListener('click', () => saveReview(state.activeCode, { status: 'confirmed', albayan_idx: Number(btn.dataset.idx), cost_override: null, ts: Date.now() }));
    });
  }

  // ---------------- local persistence (localStorage) ----------------
  // Reviews are saved only in this browser/device. Export the Excel file
  // regularly if you review from more than one computer.

  function loadReviews() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.reviews = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('loadReviews failed', e);
      state.reviews = {};
    }
  }

  function persistReviews() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.reviews));
      return true;
    } catch (e) {
      console.warn('persistReviews failed', e);
      return false;
    }
  }

  function saveReview(code, entry) {
    state.reviews[code] = entry;
    renderAll();
    renderModal();
    toast(persistReviews() ? 'تم الحفظ على هذا الجهاز' : 'تعذّر الحفظ محلياً (تحقق من إعدادات المتصفح)');
  }

  function clearReview(code) {
    delete state.reviews[code];
    renderAll();
    renderModal();
    persistReviews();
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---------------- export ----------------

  async function exportExcel() {
    const btn = $('#exportBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'جاري التحضير...';
    try {
      const res = await fetch('data/sky_lines.json');
      const lines = await res.json();

      // dominant base unit per item (most frequent across its lines)
      const baseUnitCounts = new Map(); // item_code -> Map(unit -> count)
      for (const l of lines) {
        if (!l.base_unit) continue;
        if (!baseUnitCounts.has(l.item_code)) baseUnitCounts.set(l.item_code, new Map());
        const m = baseUnitCounts.get(l.item_code);
        m.set(l.base_unit, (m.get(l.base_unit) || 0) + 1);
      }
      function dominantBaseUnit(code) {
        const m = baseUnitCounts.get(code);
        if (!m || !m.size) return '';
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0];
      }

      const priceListRows = [];
      const unresolvedRows = [];
      let nMatchedBarcode = 0, nManual = 0, nUnresolved = 0;

      for (const s of state.skyItems) {
        const eff = effective(s.item_code);
        if (eff.cost == null) {
          nUnresolved++;
          unresolvedRows.push({
            'كود المادة': s.item_code,
            'الاسم التجاري': s.name,
            'الفروع': s.branches.join('، '),
            'الحالة': eff.source === 'no_match' ? 'معلّمة: بلا تطابق' : 'بدون مراجعة بعد',
          });
          continue;
        }
        if (eff.source === 'barcode') nMatchedBarcode++;
        else nManual++;

        priceListRows.push({
          code: s.item_code,
          price_list_name: '',
          currency_name: 'IQD',
          unit_name: dominantBaseUnit(s.item_code) || s.base_units[0] || '',
          price: Math.round(eff.cost),
          min_quantity: 1,
          max_quantity: '',
          foc_for_each: 0,
          foc_quantity: 0,
          max_foc_quantity: 0,
          discount_percentage: 0,
          discount_active: 'FALSE',
        });
      }

      const summaryRows = [
        { 'البيان': 'إجمالي مواد Sky', 'القيمة': state.skyItems.length },
        { 'البيان': 'مواد جاهزة بقائمة الأسعار (مطابقة بالباركود)', 'القيمة': nMatchedBarcode },
        { 'البيان': 'مواد جاهزة بقائمة الأسعار (مطابقة/تسعير يدوي)', 'القيمة': nManual },
        { 'البيان': 'مواد بدون تكلفة بعد (غير محلولة)', 'القيمة': nUnresolved },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(priceListRows), 'Prices');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unresolvedRows), 'غير محلول');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص');

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });

      const fname = 'قائمة-اسعار-Sky-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('تم تنزيل الملف');
    } catch (e) {
      console.error(e);
      toast('حدث خطأ أثناء إنشاء الملف');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ---------------- init ----------------

  async function init() {
    try {
      const [albayan, skyItems, matches] = await Promise.all([
        fetch('data/albayan.json').then((r) => r.json()),
        fetch('data/sky_items.json').then((r) => r.json()),
        fetch('data/matches.json').then((r) => r.json()),
      ]);
      state.albayan = albayan;
      state.skyItems = skyItems;
      state.matches = matches;
    } catch (e) {
      $('#loading').innerHTML = '<p>تعذّر تحميل بيانات المطابقة. حدّث الصفحة وحاول مجدداً.</p>';
      console.error(e);
      return;
    }

    loadReviews();

    $('#loading').hidden = true;
    $('#appShell').hidden = false;

    renderAll();
    wireControls();
  }

  function wireControls() {
    $$('.stat-tile').forEach((t) => t.addEventListener('click', () => {
      state.filter = t.dataset.filter;
      state.page = 1;
      renderAll();
    }));
    $('#searchBox').addEventListener('input', (e) => { state.search = e.target.value; state.page = 1; renderList(); });
    $('#branchSelect').addEventListener('change', (e) => { state.branch = e.target.value; state.page = 1; renderList(); });
    $('#prevPage').addEventListener('click', () => { state.page--; renderList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#nextPage').addEventListener('click', () => { state.page++; renderList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#exportBtn').addEventListener('click', exportExcel);
    $('#closeModal').addEventListener('click', closeModal);
    $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

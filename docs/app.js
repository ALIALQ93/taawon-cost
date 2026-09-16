(() => {
  'use strict';

  const PAGE_SIZE = 40;
  const ROLE_LABELS = { viewer: 'مشاهد', reviewer: 'مراجع', admin: 'مسؤول' };

  const state = {
    albayan: [],
    skyItems: [],
    matches: {},
    reviews: {},
    filter: 'all',
    search: '',
    branch: '',
    page: 1,
    activeCode: null,
    modalSearch: '',
    user: null,
    profile: null,
    sessionReady: false,
  };

  let supabase = null;
  let controlsWired = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function role() {
    return (state.profile && state.profile.role) || 'viewer';
  }
  function isAdmin() { return role() === 'admin'; }
  function canReview() { return role() === 'reviewer' || role() === 'admin'; }
  function canSeeCost() { return isAdmin(); }
  function canExport() { return isAdmin(); }

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
      if (rev.status === 'duplicate_def') {
        return { source: 'duplicate_def', cost: null, albayan: null, albayan_idx: null, review: rev };
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
    if (eff.source === 'no_match' || eff.source === 'duplicate_def') return 'confirmed';
    const m = state.matches[code];
    if (m && m.status === 'needs_review') return 'review';
    return 'none';
  }

  function counts() {
    const c = { all: state.skyItems.length, matched: 0, review: 0, none: 0, confirmed: 0, duplicate: 0 };
    for (const s of state.skyItems) {
      const st = statusOf(s.item_code);
      if (st === 'matched') c.matched++;
      else if (st === 'review') c.review++;
      else if (st === 'none') c.none++;
      const rev = state.reviews[s.item_code];
      if (rev) {
        c.confirmed++;
        if (rev.status === 'duplicate_def') c.duplicate++;
      }
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
        const rev = state.reviews[s.item_code];
        if (state.filter === 'reviewed') return !!rev;
        if (state.filter === 'duplicate') return !!(rev && rev.status === 'duplicate_def');
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
    if (rev) {
      if (rev.status === 'no_match') return `<span class="chip none">✕ بلا تطابق</span>`;
      if (rev.status === 'duplicate_def') return `<span class="chip duplicate">⚠ معرفة بأكثر من أسلوب</span>`;
      return `<span class="chip confirmed">✓ روجعت يدوياً</span>`;
    }
    if (st === 'matched') return `<span class="chip matched">✓ مطابق بالباركود</span>`;
    if (st === 'review') return `<span class="chip review">⚠ بحاجة مراجعة</span>`;
    return `<span class="chip none">✕ بدون تطابق</span>`;
  }

  function costSourceLabel(costSource) {
    if (costSource === 'avg') return 'السعر الوسطي';
    if (costSource === 'last_purchase') return 'آخر شراء';
    return null;
  }

  function costCellHtml(s) {
    if (!canSeeCost()) {
      const st = statusOf(s.item_code);
      if (st === 'matched' || st === 'confirmed') {
        return `<div class="cost-cell"><span class="pending">محجوبة — للمسؤول فقط</span></div>`;
      }
      return `<div class="cost-cell"><span class="pending">—</span></div>`;
    }
    const eff = effective(s.item_code);
    if (eff.source === 'unresolved') return `<div class="cost-cell"><span class="pending">لم تُحسب بعد</span></div>`;
    if (eff.source === 'no_match') return `<div class="cost-cell"><span class="pending">بلا تكلفة مرجعية</span></div>`;
    if (eff.source === 'duplicate_def') return `<div class="cost-cell"><span class="pending">تعريف مكرر — راجع التوحيد</span></div>`;
    const unit = dominantUnitLabel(s);
    let sub;
    if (eff.source === 'manual_cost') sub = 'تكلفة يدوية';
    else sub = costSourceLabel(eff.albayan && eff.albayan.cost_source) || '—';
    return `<div class="cost-cell"><span class="new">${fmtNum(eff.cost)} د.ع</span><span class="old" style="text-decoration:none;color:var(--ink-dim);">لكل ${escapeHtml(unit)} · ${sub}</span></div>`;
  }

  function dominantUnitLabel(s) {
    return (s.base_units && s.base_units[0]) || (s.units && s.units[0]) || 'وحدة';
  }

  function renderUserBar() {
    const name = (state.profile && state.profile.full_name) || (state.user && state.user.email) || '—';
    $('#userName').textContent = name;
    const badge = $('#userRoleBadge');
    badge.textContent = ROLE_LABELS[role()] || role();
    badge.dataset.role = role();
    $('#exportBtn').hidden = !canExport();
  }

  function renderStats() {
    const c = counts();
    $('#statAll .num').textContent = fmtNum(c.all);
    $('#statMatched .num').textContent = fmtNum(c.matched);
    $('#statReview .num').textContent = fmtNum(c.review);
    $('#statNone .num').textContent = fmtNum(c.none);
    $('#statConfirmed .num').textContent = fmtNum(c.confirmed);
    $('#statDuplicate .num').textContent = fmtNum(c.duplicate);
    $$('.stat-tile').forEach((t) => t.classList.toggle('active', t.dataset.filter === state.filter));
    const statusSel = $('#statusSelect');
    if (statusSel && statusSel.value !== state.filter) statusSel.value = state.filter;
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
    renderUserBar();
    renderStats();
    renderBranchOptions();
    renderList();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- modal ----------------

  function candidateCostMeta(a) {
    if (!canSeeCost()) {
      return `الوحدة: ${escapeHtml(a.base_unit || '—')}`;
    }
    return `الوحدة: ${escapeHtml(a.base_unit || '—')} · التكلفة لكل ${escapeHtml(a.base_unit || 'وحدة')}:
      ${a.cost != null ? fmtNum(a.cost) + ' د.ع (' + (costSourceLabel(a.cost_source) || 'بدون مصدر') + ')' : 'غير متوفرة بالبيان القديم'}`;
  }

  function candidateCardHtml(cand, chosenIdx, scoreLabel) {
    const a = state.albayan[cand.albayan_idx];
    if (!a) return '';
    const chosen = chosenIdx === cand.albayan_idx;
    const actionBtn = canReview()
      ? `<button class="btn ${chosen ? 'primary' : ''}" data-action="confirm-cand" data-idx="${cand.albayan_idx}">${chosen ? '✓ مُعتمدة' : 'اعتماد هذه المطابقة'}</button>`
      : (chosen ? `<span class="chip confirmed">✓ مُعتمدة</span>` : '');
    return `
      <div class="candidate ${chosen ? 'chosen' : ''}" data-idx="${cand.albayan_idx}">
        <div>
          <div class="cand-name">${escapeHtml(a.name || '(بدون اسم)')}</div>
          <div class="cand-meta">
            ${a.foreign_name ? escapeHtml(a.foreign_name) + ' · ' : ''}${a.scientific_name ? escapeHtml(a.scientific_name) + ' · ' : ''}
            ${a.barcode ? 'باركود ' + a.barcode + ' · ' : ''}
            ${candidateCostMeta(a)}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          ${scoreLabel ? `<span class="cand-score">${scoreLabel}</span>` : ''}
          ${actionBtn}
        </div>
      </div>`;
  }

  function openModal(code) {
    state.activeCode = code;
    state.modalSearch = '';
    const s = state.skyItems.find((x) => x.item_code === code);
    if (!s) return;
    $('#overlay').hidden = false;
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

    if (canReview()) {
      body += `<div class="modal-search-wrap">
        <div class="section-title">بحث يدوي في ملف البيان القديم</div>
        <input type="search" id="modalSearchBox" placeholder="ابحث بالاسم أو الباركود...">
        <div class="search-results" id="modalSearchResults"></div>
      </div>`;
    }

    if (isAdmin()) {
      body += `<div>
        <div class="section-title">أو أدخل تكلفة يدوياً (إن لم توجد مادة مطابقة في البيان)</div>
        <div class="manual-cost">
          <input type="number" id="manualCostInput" placeholder="التكلفة لكل ${escapeHtml(dominantUnitLabel(s))}" value="${rev && rev.status === 'manual_cost' ? rev.cost_override : ''}">
          <button class="btn" data-action="save-manual-cost">حفظ كتكلفة يدوية</button>
        </div>
      </div>`;
    } else if (rev && rev.status === 'manual_cost') {
      body += `<div class="footnote">هذه المادة لها تكلفة يدوية أدخلها المسؤول (القيمة محجوبة).</div>`;
    }

    if (canReview()) {
      const noMatchLabel = rev && rev.status === 'no_match'
        ? '✓ مُعلّمة: بلا تطابق'
        : 'علم: بلا تطابق (بحاجة تسعير يدوي لاحقاً في Sky)';
      const dupLabel = rev && rev.status === 'duplicate_def'
        ? '✓ مُعلّمة: معرفة بأكثر من أسلوب'
        : 'علم: المادة معرفة بأكثر من أسلوب مختلف';
      body += `<div class="review-actions">
        <button class="btn" data-action="mark-no-match">${noMatchLabel}</button>
        <button class="btn" data-action="mark-duplicate-def">${dupLabel}</button>
        ${rev ? `<button class="btn ghost" data-action="clear-review">مسح المراجعة</button>` : ''}
      </div>`;
    } else {
      body += `<div class="footnote">حسابك للعرض فقط — المراجعة والتصدير حسب الصلاحية.</div>`;
    }

    $('#modalBody').innerHTML = body;

    $$('[data-action="confirm-cand"]', $('#modalBody')).forEach((btn) => {
      btn.addEventListener('click', () => saveReview(code, { status: 'confirmed', albayan_idx: Number(btn.dataset.idx), cost_override: null }));
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
      saveReview(code, { status: 'manual_cost', albayan_idx: null, cost_override: val });
    });
    const noMatchBtn = $('[data-action="mark-no-match"]', $('#modalBody'));
    if (noMatchBtn) noMatchBtn.addEventListener('click', () => saveReview(code, { status: 'no_match', albayan_idx: null, cost_override: null }));
    const dupBtn = $('[data-action="mark-duplicate-def"]', $('#modalBody'));
    if (dupBtn) dupBtn.addEventListener('click', () => saveReview(code, { status: 'duplicate_def', albayan_idx: null, cost_override: null }));
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
    if (!results.length) {
      box.innerHTML = `<div class="search-empty">لا نتائج</div>`;
      return;
    }
    box.innerHTML = results.map((a) => candidateCardHtml({ albayan_idx: a.idx }, rev && rev.albayan_idx, null)).join('');
    $$('[data-action="confirm-cand"]', box).forEach((btn) => {
      btn.addEventListener('click', () => saveReview(state.activeCode, { status: 'confirmed', albayan_idx: Number(btn.dataset.idx), cost_override: null }));
    });
  }

  // ---------------- auth + supabase ----------------

  function getConfig() {
    const cfg = window.TAAWON_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || cfg.supabaseUrl.includes('YOUR_PROJECT')) {
      return null;
    }
    return cfg;
  }

  function initSupabase() {
    const cfg = getConfig();
    if (!cfg) {
      $('#loginScreen').hidden = false;
      $('#loginScreen .login-card').innerHTML = `
        <h1>إعداد مطلوب</h1>
        <p class="login-sub">انسخ <code>docs/config.example.js</code> إلى <code>docs/config.js</code> واملأ رابط مشروع Supabase ومفتاح anon، ثم نفّذ <code>supabase/schema.sql</code>.</p>`;
      return false;
    }
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return true;
  }

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // trigger may lag; insert fallback as viewer
      const { data: inserted, error: insErr } = await supabase
        .from('profiles')
        .insert({ id: userId, full_name: state.user.email, role: 'viewer' })
        .select('id, full_name, role')
        .single();
      if (insErr) throw insErr;
      return inserted;
    }
    return data;
  }

  function stripCostsInMemory() {
    if (canSeeCost()) return;
    for (const a of state.albayan) {
      if (a && 'cost' in a) a.cost = null;
      if (a && 'cost_source' in a) a.cost_source = null;
    }
    for (const code of Object.keys(state.reviews)) {
      const r = state.reviews[code];
      if (r) r.cost_override = null;
    }
  }

  async function loadReviewsFromCloud() {
    const { data, error } = await supabase
      .from('reviews_visible')
      .select('item_code, status, albayan_idx, cost_override, updated_at');
    if (error) throw error;
    const map = {};
    for (const row of data || []) {
      map[row.item_code] = {
        status: row.status,
        albayan_idx: row.albayan_idx,
        cost_override: row.cost_override,
        ts: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
      };
    }
    state.reviews = map;
  }

  async function saveReview(code, entry) {
    if (!canReview()) { toast('ليس لديك صلاحية المراجعة'); return; }
    if (entry.status === 'manual_cost' && !isAdmin()) {
      toast('التكلفة اليدوية للمسؤول فقط');
      return;
    }

    const payload = {
      item_code: code,
      status: entry.status,
      albayan_idx: entry.albayan_idx,
      cost_override: entry.cost_override,
      reviewed_by: state.user.id,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('reviews').upsert(payload, { onConflict: 'item_code' });
    if (error) {
      console.error(error);
      toast('تعذّر الحفظ: ' + (error.message || 'خطأ'));
      return;
    }

    state.reviews[code] = {
      status: entry.status,
      albayan_idx: entry.albayan_idx,
      cost_override: canSeeCost() ? entry.cost_override : null,
      ts: Date.now(),
    };
    renderAll();
    renderModal();
    toast('تم الحفظ أونلاين');
  }

  async function clearReview(code) {
    if (!canReview()) { toast('ليس لديك صلاحية'); return; }
    const { error } = await supabase.from('reviews').delete().eq('item_code', code);
    if (error) {
      console.error(error);
      toast('تعذّر المسح');
      return;
    }
    delete state.reviews[code];
    renderAll();
    renderModal();
    toast('تم مسح المراجعة');
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
    if (!canExport()) { toast('التصدير للمسؤول فقط'); return; }
    const btn = $('#exportBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'جاري التحضير...';
    try {
      const res = await fetch('data/sky_lines.json');
      const lines = await res.json();

      const baseUnitCounts = new Map();
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

      const exportItems = filteredItems();
      const filterLabels = [];
      if (state.filter === 'all') filterLabels.push('كل المواد');
      else if (state.filter === 'matched') filterLabels.push('مطابق بالباركود');
      else if (state.filter === 'review') filterLabels.push('بحاجة مراجعة');
      else if (state.filter === 'none') filterLabels.push('بدون تطابق');
      else if (state.filter === 'reviewed') filterLabels.push('روجعت يدوياً');
      else if (state.filter === 'duplicate') filterLabels.push('مكرّر التعريف');
      if (state.branch) filterLabels.push('فرع: ' + state.branch);
      if (state.search.trim()) filterLabels.push('بحث: ' + state.search.trim());
      const filterDesc = filterLabels.join(' · ');

      const priceListRows = [];
      const sourceDetailRows = [];
      const unresolvedRows = [];
      let nMatchedBarcode = 0, nManual = 0, nUnresolved = 0;

      for (const s of exportItems) {
        const eff = effective(s.item_code);
        if (eff.cost == null) {
          nUnresolved++;
          unresolvedRows.push({
            'كود المادة': s.item_code,
            'الاسم التجاري': s.name,
            'الفروع': s.branches.join('، '),
            'الحالة': eff.source === 'no_match' ? 'معلّمة: بلا تطابق'
              : eff.source === 'duplicate_def' ? 'معلّمة: معرفة بأكثر من أسلوب'
              : 'بدون مراجعة بعد',
          });
          continue;
        }
        if (eff.source === 'barcode') nMatchedBarcode++;
        else nManual++;

        const unitName = dominantBaseUnit(s.item_code) || s.base_units[0] || '';
        const priceOriginLabel =
          eff.source === 'manual_cost' ? 'تكلفة أُدخلت يدوياً (بدون مصدر من البيان)'
          : costSourceLabel(eff.albayan && eff.albayan.cost_source) === 'آخر شراء' ? 'آخر سعر شراء بالبيان القديم (السعر الوسطي غير متوفر لهذه المادة)'
          : 'السعر الوسطي بالبيان القديم';

        priceListRows.push({
          code: s.item_code,
          price_list_name: '',
          currency_name: 'IQD',
          unit_name: unitName,
          price: Math.round(eff.cost),
          min_quantity: 1,
          max_quantity: '',
          foc_for_each: 0,
          foc_quantity: 0,
          max_foc_quantity: 0,
          discount_percentage: 0,
          discount_active: 'FALSE',
        });

        sourceDetailRows.push({
          'كود المادة (code)': s.item_code,
          'الاسم بSky': s.name,
          'الوحدة (unit_name)': unitName,
          'السعر المصدَّر (price)': Math.round(eff.cost),
          'مصدر هذا السعر': priceOriginLabel,
          'طريقة المطابقة': eff.source === 'barcode' ? 'تلقائية بالباركود' : eff.source === 'manual_match' ? 'يدوية مؤكدة' : 'تكلفة يدوية بدون مطابقة',
          'اسم المادة المطابقة بالبيان': eff.albayan ? eff.albayan.name : '',
          'باركود المادة المطابقة بالبيان': eff.albayan ? eff.albayan.barcode_raw : '',
        });
      }

      const summaryRows = [
        { 'البيان': 'نطاق التصدير (الفلتر الحالي)', 'القيمة': filterDesc },
        { 'البيان': 'إجمالي مواد Sky (كل القاعدة)', 'القيمة': state.skyItems.length },
        { 'البيان': 'مواد داخلة في التصدير (بعد الفلتر)', 'القيمة': exportItems.length },
        { 'البيان': 'مواد جاهزة بقائمة الأسعار (مطابقة بالباركود)', 'القيمة': nMatchedBarcode },
        { 'البيان': 'مواد جاهزة بقائمة الأسعار (مطابقة/تسعير يدوي)', 'القيمة': nManual },
        { 'البيان': 'مواد بدون تكلفة بعد (غير محلولة)', 'القيمة': nUnresolved },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(priceListRows), 'Prices');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sourceDetailRows), 'مصدر كل سعر');
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
      toast(`تم تنزيل الملف · ${exportItems.length} مادة (حسب الفلتر)`);
    } catch (e) {
      console.error(e);
      toast('حدث خطأ أثناء إنشاء الملف');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ---------------- session UI ----------------

  function showLogin() {
    document.body.classList.add('is-login');
    document.body.classList.remove('is-app');
    $('#loginScreen').hidden = false;
    $('#appRoot').hidden = true;
    $('#loading').hidden = true;
    $('#appShell').hidden = true;
    const overlay = $('#overlay');
    if (overlay) overlay.hidden = true;
  }

  function showAppShellLoading() {
    document.body.classList.remove('is-login');
    document.body.classList.add('is-app');
    $('#loginScreen').hidden = true;
    $('#appRoot').hidden = false;
    $('#loading').hidden = false;
    $('#appShell').hidden = true;
  }

  let appLoadSeq = 0;

  async function onSignedIn(session) {
    const seq = ++appLoadSeq;
    state.user = session.user;
    showAppShellLoading();
    try {
      state.profile = await loadProfile(session.user.id);
      if (seq !== appLoadSeq) return;
      await loadAppData();
      if (seq !== appLoadSeq) return;
      await loadReviewsFromCloud();
      if (seq !== appLoadSeq) return;
      stripCostsInMemory();
      $('#loading').hidden = true;
      $('#appShell').hidden = false;
      renderAll();
      wireControls();
    } catch (e) {
      if (seq !== appLoadSeq) return;
      console.error(e);
      $('#loading').innerHTML = '<p>تعذّر تحميل البيانات أو الصلاحيات. حدّث الصفحة أو راجع إعدادات Supabase.</p>';
    }
  }

  async function loadAppData() {
    const [albayan, skyItems, matches] = await Promise.all([
      fetch('data/albayan.json').then((r) => {
        if (!r.ok) throw new Error('albayan.json missing');
        return r.json();
      }),
      fetch('data/sky_items.json').then((r) => {
        if (!r.ok) throw new Error('sky_items.json missing');
        return r.json();
      }),
      fetch('data/matches.json').then((r) => {
        if (!r.ok) throw new Error('matches.json missing');
        return r.json();
      }),
    ]);
    state.albayan = albayan;
    state.skyItems = skyItems;
    state.matches = matches;
  }

  async function onSignedOut() {
    state.user = null;
    state.profile = null;
    state.reviews = {};
    state.albayan = [];
    state.skyItems = [];
    state.matches = {};
    showLogin();
  }

  function wireAuthUi() {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#loginError');
      errEl.hidden = true;
      const btn = $('#loginBtn');
      btn.disabled = true;
      btn.textContent = 'جارِ الدخول…';
      try {
        const email = $('#loginEmail').value.trim();
        const password = $('#loginPassword').value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } catch (err) {
        errEl.textContent = err.message || 'فشل تسجيل الدخول';
        errEl.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'دخول';
      }
    });
    $('#logoutBtn').addEventListener('click', async () => {
      await supabase.auth.signOut();
    });
  }

  function wireControls() {
    if (controlsWired) return;
    controlsWired = true;
    $$('.stat-tile').forEach((t) => t.addEventListener('click', () => {
      state.filter = t.dataset.filter;
      state.page = 1;
      renderAll();
    }));
    $('#statusSelect').addEventListener('change', (e) => {
      state.filter = e.target.value || 'all';
      state.page = 1;
      renderAll();
    });
    $('#searchBox').addEventListener('input', (e) => { state.search = e.target.value; state.page = 1; renderList(); });
    $('#branchSelect').addEventListener('change', (e) => { state.branch = e.target.value; state.page = 1; renderList(); });
    $('#prevPage').addEventListener('click', () => { state.page--; renderList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#nextPage').addEventListener('click', () => { state.page++; renderList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#exportBtn').addEventListener('click', exportExcel);
    $('#closeModal').addEventListener('click', closeModal);
    $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }

  async function boot() {
    if (!initSupabase()) return;
    wireAuthUi();

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED') return;
      if (session) await onSignedIn(session);
      else await onSignedOut();
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();

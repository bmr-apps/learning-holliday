// 별무리 러닝 홀리데이 — 홍보 페이지 + 온라인 지원 접수 + 관리자 화면
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './style.css';
import { applyAppInfo } from './app-info.js';
import { supabase } from './supabase.js';
import { loginWithGoogle, logout, onUserChange, currentUser } from './auth.js';
import { session } from './store.js';

applyAppInfo(' · 일하고, 배우고, 함께 사는 시간');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/* ---------------- 모집 상태 표시 ---------------- */
(function recruitState() {
  const el = $('#recruit-state');
  if (!el) return;
  const now = new Date();
  const start = new Date('2026-12-01T00:00:00+09:00');
  const end = new Date('2027-01-01T00:00:00+09:00');
  if (now >= start && now < end) {
    el.textContent = '모집 중 · 2026.12.1 ~ 12.31';
    el.classList.add('on');
  } else if (now < start) {
    const days = Math.ceil((start - now) / 86400000);
    el.textContent = `모집 시작 D-${days}`;
  } else {
    el.textContent = '모집 기간 종료';
  }
})();

/* ---------------- 지원서 ---------------- */
const form = $('#apply-form');
const doneBox = $('#done');
const errorBox = $('#form-error');
const submitBtn = $('#submit-btn');

if (form) {
  const birth = form.elements.birth_date;
  if (birth) {
    const t = new Date();
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    birth.max = iso;
    birth.min = '1940-01-01';
  }

  const showError = (msg) => {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorBox) errorBox.hidden = true;

    // 간단한 스팸 차단: 숨긴 칸이 채워지면 제출하지 않습니다
    if (won(form.elements.website?.value)) {
      showError('제출을 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      showError('필수 항목을 확인해 주세요. 빨간색으로 표시된 칸을 채우면 제출할 수 있습니다.');
      return;
    }

    const fd = new FormData(form);
    const get = (k) => won(fd.get(k) ?? '');
    const payload = {
      name: get('name'),
      birth_date: get('birth_date'),
      phone: get('phone'),
      email: get('email'),
      address: get('address'),
      affiliation: get('affiliation'),
      apply_route: get('apply_route'),
      category: get('category'),
      part: get('part'),
      education: get('education'),
      career: get('career'),
      q_self: get('q_self'),
      q_motive: get('q_motive'),
      q_plan: get('q_plan'),
      agree_live: fd.get('agree_live') === 'on',
      agree_privacy: fd.get('agree_privacy') === 'on',
      newsletter: fd.get('newsletter') === 'on',
      message_extra: get('message_extra'),
    };

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '제출하는 중…'; }
    try {
      const { data, error } = await supabase.rpc('submit_application', { p: payload });
      if (error) throw new Error(error.message || '접수하지 못했습니다.');
      showDone(payload, data || {});
    } catch (err) {
      const msg = String(err?.message || '');
      let friendly = '접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
      if (msg.includes('개인정보')) friendly = msg;
      else if (msg.includes('꼭 적어')) friendly = msg;
      else if (msg.includes('골라')) friendly = msg;
      else if (msg.includes('몰리고')) friendly = msg;
      else if (msg.includes('Failed to fetch') || msg.includes('fetch')) friendly = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
      showError(friendly + ' 계속 문제가 있으면 조은길 010-4517-4164로 연락 주세요.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '지원서 제출하기'; }
    }
  });
}

function showDone(payload, result) {
  if (!doneBox) return;
  const no = result.receipt_no || '접수 완료';
  $('#receipt-no').textContent = no;
  const when = result.created_at ? new Date(result.created_at) : new Date();
  $('#receipt-when').textContent = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }).format(when);
  $('#done-name').textContent = payload.name;
  $('#done-category').textContent = payload.category;
  $('#done-part').textContent = payload.part;
  form.hidden = true;
  doneBox.hidden = false;
  doneBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
  document.title = `${no} 접수 완료 · 별무리 러닝 홀리데이`;
  history.replaceState(null, '', '#done');
}

$('#print-receipt')?.addEventListener('click', () => window.print());

/* ---------------- 관리자 ---------------- */
const adminView = $('#admin-view');
const adminBody = $('#admin-body');
const ADMIN_HASH = '#admin';
let adminState = { user: null, manager: false, loading: false, rows: [], filter: '전체', q: '', openedId: null };

function openAdmin() {
  if (!adminView) return;
  adminView.hidden = false;
  $('#main').hidden = true;
  document.body.classList.add('admin-open');
  if (location.hash !== ADMIN_HASH) history.replaceState(null, '', ADMIN_HASH);
  window.scrollTo({ top: 0 });
  renderAdmin();
}

function closeAdmin() {
  if (!adminView) return;
  adminView.hidden = true;
  $('#main').hidden = false;
  document.body.classList.remove('admin-open');
  closeDetail();
  if (location.hash === ADMIN_HASH) history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo({ top: 0 });
}

$$('[data-open="admin"]').forEach((b) => b.addEventListener('click', () => { session.set('admin-intent', true); openAdmin(); }));
$$('[data-close="admin"]').forEach((b) => b.addEventListener('click', () => { session.remove('admin-intent'); closeAdmin(); }));

if (location.hash === ADMIN_HASH) openAdmin();
window.addEventListener('hashchange', () => {
  if (location.hash === ADMIN_HASH) openAdmin();
});

async function renderAdmin() {
  if (!adminBody) return;
  if (adminState.loading) {
    adminBody.innerHTML = '<p class="admin-meta">확인하는 중…</p>';
    return;
  }

  let user = adminState.user;
  if (!user) {
    try { user = await currentUser(); } catch { user = null; }
    adminState.user = user;
  }

  if (!user) {
    adminBody.innerHTML = `
      <div class="login-card">
        <h2>관리자 로그인</h2>
        <p>지원서 열람과 심사는 허브(BMR APPS) 계정으로 로그인한 담당자만 할 수 있습니다. 구글 계정으로 로그인해 주세요.</p>
        <button type="button" class="btn primary" id="admin-login">구글로 로그인</button>
        <p class="admin-note">지원자는 로그인 없이 지원서를 낼 수 있습니다. 이 화면은 담당자용입니다.</p>
      </div>`;
    $('#admin-login')?.addEventListener('click', () => { session.set('admin-intent', true); loginWithGoogle(); });
    return;
  }

  if (!adminState.checkedManager) {
    adminState.loading = true;
    adminBody.innerHTML = '<p class="admin-meta">권한을 확인하는 중…</p>';
    const { data, error } = await supabase.rpc('am_i_manager');
    adminState.loading = false;
    adminState.checkedManager = true;
    if (error) {
      adminBody.innerHTML = `<div class="login-card"><h2>권한을 확인하지 못했습니다</h2>
        <p>${esc(error.message || '잠시 뒤 다시 시도해 주세요.')}</p>
        <button type="button" class="btn" id="admin-retry">다시 시도</button></div>`;
      $('#admin-retry')?.addEventListener('click', () => { adminState.checkedManager = false; renderAdmin(); });
      return;
    }
    adminState.manager = data === true;
  }

  if (!adminState.manager) {
    adminBody.innerHTML = `
      <div class="login-card">
        <h2>관리자 권한이 없습니다</h2>
        <p><b>${esc(user.email || '')}</b> 계정으로 로그인되어 있습니다. 이 계정은 지원서를 볼 수 있는 관리자 명단에 없습니다.</p>
        <p class="admin-note">담당자 계정으로 다시 로그인하거나, 관리자 명단에 이 메일을 추가해 달라고 요청하세요.</p>
        <div class="detail-actions">
          <button type="button" class="btn" id="admin-logout">로그아웃</button>
          <button type="button" class="btn primary" id="admin-relogin">다른 계정으로 로그인</button>
        </div>
      </div>`;
    $('#admin-logout')?.addEventListener('click', adminLogout);
    $('#admin-relogin')?.addEventListener('click', async () => { await logout(); session.set('admin-intent', true); loginWithGoogle(); });
    return;
  }

  if (!adminState.rows.length && !adminState.loaded) {
    await loadApplications();
    return;
  }

  drawAdminList();
}

async function loadApplications() {
  if (!adminBody) return;
  adminState.loading = true;
  adminBody.innerHTML = '<p class="admin-meta">지원서를 불러오는 중…</p>';
  const { data, error } = await supabase.from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  adminState.loading = false;
  adminState.loaded = true;
  if (error) {
    adminState.loaded = false;
    adminBody.innerHTML = `<div class="login-card"><h2>지원서를 불러오지 못했습니다</h2>
      <p>${esc(error.message || '')}</p>
      <button type="button" class="btn" id="admin-retry">다시 시도</button></div>`;
    $('#admin-retry')?.addEventListener('click', () => renderAdmin());
    return;
  }
  adminState.rows = data || [];
  drawAdminList();
}

function filteredRows() {
  const q = adminState.q.toLowerCase();
  return adminState.rows.filter((r) => {
    if (adminState.filter !== '전체' && r.status !== adminState.filter) return false;
    if (!q) return true;
    return [r.receipt_no, r.name, r.phone, r.email, r.category, r.part].join(' ').toLowerCase().includes(q);
  });
}

function drawAdminList() {
  if (!adminBody) return;
  const rows = filteredRows();
  const statuses = ['전체', '접수완료', '서류검토', '인터뷰', '합격', '보류'];
  const count = (s) => (s === '전체' ? adminState.rows.length : adminState.rows.filter((r) => r.status === s).length);
  const fmt = (v) => (v ? new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—');

  const table = rows.length ? `
    <div class="table-wrap">
      <table class="apps">
        <thead><tr><th>접수번호</th><th>이름</th><th>지원 구분</th><th>희망 파트</th><th>연락처</th><th>접수</th><th>상태</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr data-id="${esc(r.id)}">
            <td>${esc(r.receipt_no)}</td>
            <td class="name">${esc(r.name)}</td>
            <td>${esc(r.category)}</td>
            <td>${esc(r.part)}</td>
            <td>${esc(r.phone)}</td>
            <td>${esc(fmt(r.created_at))}</td>
            <td><span class="pill s-${esc(r.status)}">${esc(r.status)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<div class="table-wrap"><p class="empty">조건에 맞는 지원서가 없습니다.</p></div>';

  adminBody.innerHTML = `
    <div class="admin-bar">
      <div class="filters" role="group" aria-label="상태로 거르기">
        ${statuses.map((s) => `<button type="button" class="filter ${adminState.filter === s ? 'on' : ''}" data-filter="${esc(s)}">${esc(s)} <span class="n">${count(s)}</span></button>`).join('')}
      </div>
      <div class="grow"></div>
      <form class="search-box" id="admin-search" role="search">
        <input type="text" name="q" value="${esc(adminState.q)}" placeholder="이름 · 연락처 · 접수번호" aria-label="지원자 검색">
        <button type="submit" class="btn tiny">검색</button>
      </form>
      <button type="button" class="btn tiny" id="admin-csv">CSV 내려받기</button>
      <button type="button" class="btn tiny ghost" id="admin-refresh">새로고침</button>
      <button type="button" class="btn tiny ghost" id="admin-logout">로그아웃</button>
    </div>
    <p class="admin-meta">${esc(adminState.user?.email || '')} · 전체 ${adminState.rows.length}건 · 지금 보기 ${rows.length}건</p>
    ${table}`;

  $$('.filter', adminBody).forEach((b) => b.addEventListener('click', () => { adminState.filter = b.dataset.filter; drawAdminList(); }));
  $$('tr[data-id]', adminBody).forEach((tr) => tr.addEventListener('click', () => openDetail(Number(tr.dataset.id))));
  $('#admin-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    adminState.q = won(new FormData(e.currentTarget).get('q') ?? '');
    drawAdminList();
  });
  $('#admin-csv')?.addEventListener('click', downloadCsv);
  $('#admin-refresh')?.addEventListener('click', () => { adminState.loaded = false; loadApplications(); });
  $('#admin-logout')?.addEventListener('click', adminLogout);
}

async function adminLogout() {
  await logout();
  session.remove('admin-intent');
  adminState = { user: null, manager: false, loading: false, rows: [], filter: '전체', q: '', openedId: null, loaded: false };
  renderAdmin();
}

/* ---------------- 상세 패널 ---------------- */
let backdrop = null;
function closeDetail() {
  $('#app-detail')?.remove();
  backdrop?.remove();
  backdrop = null;
  adminState.openedId = null;
}

function openDetail(id) {
  const r = adminState.rows.find((x) => Number(x.id) === id);
  if (!r) return;
  closeDetail();
  adminState.openedId = id;

  backdrop = document.createElement('div');
  backdrop.className = 'detail-backdrop';
  backdrop.addEventListener('click', closeDetail);
  document.body.appendChild(backdrop);

  const el = document.createElement('section');
  el.id = 'app-detail';
  el.className = 'detail';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `${r.name} 지원서`);
  const when = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.created_at));
  const p = (v) => (v && String(v).trim() ? esc(v) : '<span class="dim">—</span>');
  const opts = ['접수완료', '서류검토', '인터뷰', '합격', '보류'];

  el.innerHTML = `
    <div class="detail-top">
      <div>
        <h2>${esc(r.name)}</h2>
        <p class="sub">${esc(r.receipt_no)} · ${esc(when)} 접수</p>
      </div>
      <button type="button" class="btn tiny ghost" id="detail-close">닫기</button>
    </div>

    <section>
      <h3>심사</h3>
      <div class="row">
        <select id="detail-status" aria-label="심사 상태">
          ${opts.map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button type="button" class="btn tiny primary" id="detail-save">저장</button>
        <span class="saved" id="detail-saved" hidden>저장했습니다</span>
      </div>
      <label class="field full memo-field">
        <span>메모 (담당자만 봄)</span>
        <textarea id="detail-memo" maxlength="2000" placeholder="면담 일정, 확인 사항 등을 적어 두세요.">${esc(r.memo || '')}</textarea>
      </label>
    </section>

    <section>
      <h3>기본 정보</h3>
      <dl>
        <dt>생년월일</dt><dd>${p(r.birth_date)}</dd>
        <dt>휴대전화</dt><dd class="kv-links"><a href="tel:${esc(String(r.phone).replace(/[^0-9+]/g, ''))}">${esc(r.phone)}</a></dd>
        <dt>이메일</dt><dd class="kv-links"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></dd>
        <dt>거주지</dt><dd>${p(r.address)}</dd>
        <dt>소속</dt><dd>${p(r.affiliation)}</dd>
        <dt>지원 경로</dt><dd>${p(r.apply_route)}</dd>
      </dl>
    </section>

    <section>
      <h3>지원 구분 · 희망 파트</h3>
      <dl>
        <dt>지원 구분</dt><dd><b>${esc(r.category)}</b></dd>
        <dt>희망 파트</dt><dd><b>${esc(r.part)}</b></dd>
      </dl>
    </section>

    <section>
      <h3>학력 · 경력</h3>
      <dl>
        <dt>학력</dt><dd>${p(r.education)}</dd>
        <dt>경력</dt><dd>${p(r.career)}</dd>
      </dl>
    </section>

    <section>
      <h3>자기소개와 지원 동기</h3>
      <div class="qa">
        <div><b>1. 자기소개</b><p>${p(r.q_self)}</p></div>
        <div><b>2. 지원한 이유</b><p>${p(r.q_motive)}</p></div>
        <div><b>3. 이루고 싶은 것</b><p>${p(r.q_plan)}</p></div>
      </div>
    </section>

    <section>
      <h3>동의</h3>
      <dl>
        <dt>숙식·공동체</dt><dd>${r.agree_live ? '동의함' : '동의하지 않음'}</dd>
        <dt>개인정보</dt><dd>${r.agree_privacy ? '동의함' : '동의하지 않음'}</dd>
        <dt>소식 수신</dt><dd>${r.newsletter ? '받겠음' : '받지 않음'}</dd>
        <dt>하고 싶은 말</dt><dd>${p(r.message_extra)}</dd>
      </dl>
    </section>

    <div class="detail-actions">
      <button type="button" class="btn tiny danger" id="detail-delete">지원서 지우기</button>
    </div>`;
  document.body.appendChild(el);

  $('#detail-close')?.addEventListener('click', closeDetail);
  $('#detail-save')?.addEventListener('click', () => saveDetail(r.id));
  $('#detail-delete')?.addEventListener('click', () => deleteDetail(r.id, r.name));
  el.focus?.();
}

async function saveDetail(id) {
  const status = $('#detail-status')?.value || '접수완료';
  const memo = $('#detail-memo')?.value || '';
  const btn = $('#detail-save');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
  const { error } = await supabase.from('applications')
    .update({ status, memo, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  if (error) { alert(`저장하지 못했습니다: ${error.message}`); return; }
  const row = adminState.rows.find((x) => Number(x.id) === Number(id));
  if (row) { row.status = status; row.memo = memo; }
  const saved = $('#detail-saved');
  if (saved) { saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 2000); }
  drawAdminList();
  if (adminState.openedId) openDetail(Number(id));
}

async function deleteDetail(id, name) {
  if (!confirm(`${name} 님의 지원서를 지울까요? 되돌릴 수 없습니다.`)) return;
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) { alert(`지우지 못했습니다: ${error.message}`); return; }
  adminState.rows = adminState.rows.filter((x) => Number(x.id) !== Number(id));
  closeDetail();
  drawAdminList();
}

/* ---------------- CSV ---------------- */
function downloadCsv() {
  const rows = filteredRows();
  const cols = [
    ['receipt_no', '접수번호'], ['name', '이름'], ['birth_date', '생년월일'], ['phone', '휴대전화'],
    ['email', '이메일'], ['address', '거주지'], ['affiliation', '소속'], ['apply_route', '지원 경로'],
    ['category', '지원 구분'], ['part', '희망 파트'], ['education', '학력'], ['career', '경력'],
    ['q_self', '자기소개'], ['q_motive', '지원 동기'], ['q_plan', '이루고 싶은 것'],
    ['agree_live', '숙식·공동체 동의'], ['agree_privacy', '개인정보 동의'], ['newsletter', '소식 수신'],
    ['status', '상태'], ['memo', '메모'], ['created_at', '접수 시각'], ['message_extra', '하고 싶은 말'],
  ];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map((c) => cell(c[1])).join(',')];
  for (const r of rows) {
    lines.push(cols.map(([k]) => {
      if (k === 'agree_live' || k === 'agree_privacy' || k === 'newsletter') return cell(r[k] ? '예' : '아니오');
      if (k === 'created_at') return cell(r[k] ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r[k])) : '');
      return cell(r[k]);
    }).join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `러닝홀리데이-지원자-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- 로그인 상태 ---------------- */
onUserChange(async (user) => {
  adminState.user = user;
  adminState.checkedManager = false;
  adminState.manager = false;
  if (session.get('admin-intent') && user) {
    if (adminView?.hidden) openAdmin();
    else renderAdmin();
  }
  if (!adminView?.hidden) {
    if (!adminState.loaded || user) renderAdmin();
  }
});

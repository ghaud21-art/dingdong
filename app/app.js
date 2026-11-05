// 딩동 폰 화면: 구글 로그인(드라이브 숨김 앱 폴더) → PC 딩동이 올린 백업을 읽어 오늘 화면을 보여 주고,
// 할 일·일정을 고치면 "수정 요청" 파일을 같은 폴더에 올린다(PC 딩동이 켜져 있을 때 반영). 서버는 없다.
// 내 구글 드라이브의 앱 전용 숨김 폴더만 쓰고, 마지막으로 읽은 화면과 보내지 못한 수정은 이 폰에만 저장한다.
(function () {
  'use strict';
  const CLIENT_ID = '26286844705-6j3i94arganim9nd8tkucdi05o1lcror.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DOC = 'dingdong-settings.json';
  const KEY = { payload: 'dd.payload', at: 'dd.at', granted: 'dd.granted', tab: 'dd.tab', pending: 'dd.pending' };
  const V = window.DDMobile;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const when = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso || ''; } };
  const mmdd = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${+m[1]}/${+m[2]}` : ''; };

  const loadPending = () => { try { const x = JSON.parse(ls.get(KEY.pending) || '[]'); return Array.isArray(x) ? x.filter((p) => p && p.op && p.op.id) : []; } catch { return []; } };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const S = { calMonth: '', calDay: '', pending: loadPending(), token: '', tokenExp: 0, payload: null, view: null, tab: ls.get(KEY.tab) || 'today', status: '', error: '', busy: false, offline: false };
  let tokenClient = null, pendingToken = null;

  /* ── 구글 로그인 ── */
  function gsiReady() { return new Promise((res) => { if (window.google?.accounts?.oauth2) return res(); window.addEventListener('gsi-ready', () => res(), { once: true }); }); }
  async function initClient() {
    if (tokenClient) return tokenClient;
    await gsiReady();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: (r) => { const p = pendingToken; pendingToken = null; if (!p) return; if (r.error) p.rej(new Error(r.error)); else p.res(r); },
      error_callback: (e) => { const p = pendingToken; pendingToken = null; if (p) p.rej(new Error(e.type || 'popup_closed')); }
    });
    return tokenClient;
  }
  // interactive=true: 버튼을 눌렀을 때(로그인 창 허용), false: 이미 허용한 적이 있으면 조용히 새 토큰을 받는다
  async function getToken(interactive) {
    if (S.token && S.tokenExp > Date.now() + 30000) return S.token;
    const c = await initClient();
    const r = await new Promise((res, rej) => { pendingToken = { res, rej }; c.requestAccessToken({ prompt: interactive ? (ls.get(KEY.granted) ? '' : 'consent') : 'none' }); });
    if (!String(r.scope || '').includes('drive.appdata')) throw new Error('드라이브 항목을 허용해 주세요. 다시 연결해 주세요.');
    S.token = r.access_token; S.tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000; ls.set(KEY.granted, '1');
    return S.token;
  }

  /* ── 드라이브 읽기 ── */
  async function drive(url, token) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { S.token = ''; S.tokenExp = 0; const e = new Error('로그인이 만료됐어요.'); e.code = 401; throw e; }
    if (r.status === 403) { const e = new Error('구글 드라이브 사용이 막혀 있어요. 학교 구글 계정이면 개인 계정으로 시도해 보세요.'); e.code = 403; throw e; }
    if (!r.ok) throw new Error('구글 드라이브에서 읽지 못했어요(' + r.status + ').');
    return r;
  }
  async function fetchBackup(token) {
    const q = encodeURIComponent(`name='${DOC}' and trashed=false`);
    const list = await (await drive(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=1`, token)).json();
    const f = list.files && list.files[0];
    if (!f) return null;
    return await (await drive(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, token)).text();
  }

  // 구글 로그인 창의 오류 코드를 쉬운 말로
  const friendly = (e) => {
    const m = String((e && e.message) || '');
    if (/popup_closed|popup_failed/.test(m)) return '로그인 창이 닫혔거나 열리지 않았어요. 팝업을 허용하고 다시 눌러 주세요.';
    if (/access_denied/.test(m)) return '구글 연결을 허용하지 않으면 볼 수 없어요. 다시 눌러 허용해 주세요.';
    if (/interaction_required|immediate_failed|user_logged_out|login_required/.test(m)) return '다시 로그인이 필요해요. "구글로 연결하기"를 눌러 주세요.';
    return m || '읽지 못했어요.';
  };

  /* ── 불러오기 ── */
  async function refresh(interactive) {
    S.busy = true; S.error = ''; S.status = '구글 드라이브에서 읽는 중…'; draw();
    try {
      const token = await getToken(interactive);
      const text = await fetchBackup(token);
      if (!text) { S.payload = null; S.error = 'empty'; return; }
      const payload = V.parseBackup(text);
      S.payload = payload; prune(payload); ls.set(KEY.payload, text); ls.set(KEY.at, new Date().toISOString()); S.offline = false;
    } catch (e) {
      if (S.payload) { S.offline = true; S.error = ''; S.status = '인터넷이나 로그인 문제로 마지막으로 읽은 화면을 보여 줘요. (' + friendly(e) + ')'; }
      else S.error = friendly(e);
    } finally { S.busy = false; if (!S.offline) S.status = ''; draw(); flushOps().catch(() => {}); }
  }

  /* ── 수정 요청 보내기 ──
     요청 하나 = 숨김 폴더의 파일 하나(dd-op-<번호>.json). PC 딩동이 읽어 반영한 뒤 파일을 지우고, 처리한 번호를 백업(mobileApplied)에 적어 둔다.
     그 번호가 보이면 이 폰의 "대기 중" 표시를 없앤다. 3일이 지나도 반영되지 않으면 포기한다. */
  const savePending = () => ls.set(KEY.pending, JSON.stringify(S.pending));
  function prune(payload) {
    const ap = new Set(payload.mobileApplied || []), lim = Date.now() - 3 * 86400000;
    S.pending = S.pending.filter((p) => !ap.has(p.op.id) && p.at > lim); savePending();
  }
  async function uploadOp(op, token) {
    const b = '----dd' + rid(), meta = { name: 'dd-op-' + op.id + '.json', parents: ['appDataFolder'] };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(op)}\r\n--${b}--`;
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + b }, body });
    if (r.status === 401) { S.token = ''; S.tokenExp = 0; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }
  let flushing = false;
  async function flushOps() {
    const todo = S.pending.filter((p) => !p.sent);
    if (flushing || !todo.length || !ls.get(KEY.granted)) return;
    flushing = true;
    try { const token = await getToken(false); for (const p of todo) { await uploadOp(p.op, token); p.sent = true; savePending(); } }
    catch { /* 인터넷이 없거나 로그인이 필요하면 나중에 다시 보낸다 */ }
    finally { flushing = false; draw(); }
  }
  function queueOp(op) {
    S.pending.push({ op: { ...op, id: 'p' + rid(), ts: new Date().toISOString() }, sent: false, at: Date.now() }); savePending();
    closeSheet(); draw(); flushOps().catch(() => {});
  }

  /* ── 화면 ── */
  const li = (time, t, extra, cls) => `<li class="row ${cls || ''}"><time>${esc(time)}</time><div class="t">${t}</div>${extra || ''}</li>`;
  const chips = (list) => { const c = list.filter(Boolean).map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join(''); return c ? `<span class="chips">${c}</span>` : ''; };
  const canCheck = (x) => (x.src === 'me' && x.id) || (x.src === 'notion' && x.pid && x.prop);
  // 할 일 한 줄: 왼쪽 동그라미(완료) · 제목(굵게, 중요하면 ★) · 아래 작은 글씨에 날짜·분류·출처. 칩을 여러 개 늘어놓지 않는다.
  const todoLi = (x) => {
    const editable = (x.src === 'me' && x.id) || (x.src === 'notion' && x.pid);
    const meta = [
      x.due && (x.overdue ? `<b class="late">${mmdd(x.due)} 지남</b>` : x.today ? '<b class="today">오늘</b>' : mmdd(x.due)),
      x.cat && esc(x.cat), x.src === 'notion' && '<span class="nt">노션</span>', x.pending && '<b class="wait">반영 대기</b>'
    ].filter(Boolean).join(' · ');
    const ck = canCheck(x) ? `<button class="ck" data-act="done" data-key="${esc(x.key)}" aria-label="${esc(x.text)} 완료"></button>` : '<span class="ck-sp"></span>';
    return `<li class="td ${x.pending ? 'pend' : ''}">${ck}<div class="tb ${editable ? 'tap' : ''}" ${editable ? `data-act="${x.src === 'notion' ? 'edit-notion' : 'edit-todo'}" data-key="${esc(x.key)}"` : ''}><div class="tt">${x.star ? '<span class="st">★</span>' : ''}${esc(x.text)}</div>${meta ? `<div class="tm">${meta}</div>` : ''}</div></li>`;
  };
  const todoList = (items) => `<ul class="tl">${items.map(todoLi).join('')}</ul>`;
  // 할 일 탭: 기한 지남 / 오늘 / 이번 주 / 그 뒤 / 기한 없음으로 나눠서 보여 준다
  const todoGroups = (v) => v.todoGroups.map((g) => `<div class="grp"><div class="gh ${g.key}">${g.label}<span>${g.items.length}</span></div>${todoList(g.items)}</div>`).join('');
  const evLi = (e, showDate) => `<li class="row ${e.pending ? 'pend' : ''}"><time>${esc(showDate ? `${mmdd(e.date)}${e.time ? ' ' + e.time : ''}` : (e.time || '종일'))}</time><div class="t ${e.src === 'me' && e.id ? 'tap' : ''}" ${e.src === 'me' && e.id ? `data-act="edit-event" data-eid="${esc(e.id)}"` : ''}>${esc(e.title)}${chips([e.pending && ['wait', '반영 대기'], [e.src, e.label]])}</div></li>`;
  const addBtn = (act, label, date) => `<button class="btn sm add" data-act="${act}" ${date ? `data-date="${esc(date)}"` : ''}>+ ${label}</button>`;
  const wk = ['일', '월', '화', '수', '목', '금', '토'];
  const p2 = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  // 작은 달력: 할 일이 있는 날엔 파란 점, 일정이 있는 날엔 주황 점
  function calendarCard(v) {
    const td = todayStr(); if (!S.calDay) S.calDay = td; if (!S.calMonth) S.calMonth = S.calDay.slice(0, 7);
    const [y, m] = S.calMonth.split('-').map(Number), start = new Date(y, m - 1, 1).getDay();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const dt = new Date(y, m - 1, 1 - start + i), ds = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`, out = dt.getMonth() !== m - 1, info = v.byDate[ds];
      if (i >= 35 && out) break;
      cells += `<button type="button" data-act="cal-day" data-date="${ds}" class="${out ? 'out ' : ''}${ds === td ? 'today ' : ''}${ds === S.calDay ? 'sel ' : ''}${dt.getDay() === 0 ? 'sun' : ''}" aria-label="${dt.getMonth() + 1}월 ${dt.getDate()}일${info && info.todos.length ? ', 할 일 ' + info.todos.length + '개' : ''}${info && info.events.length ? ', 일정 ' + info.events.length + '개' : ''}">${dt.getDate()}<span class="dots">${info && info.todos.length ? '<i class="dot"></i>' : ''}${info && info.events.length ? '<i class="dot e"></i>' : ''}</span></button>`;
    }
    return `<section class="card"><div class="mcal-h"><button data-act="cal-prev" aria-label="이전 달">‹</button><b>${y}년 ${m}월</b><button data-act="cal-today" aria-label="오늘로">오늘</button><button data-act="cal-next" aria-label="다음 달">›</button></div>
      <div class="mcal-w">${wk.map((d) => `<span>${d}</span>`).join('')}</div><div class="mcal-g">${cells}</div>
      <div class="legend"><span><i></i>할 일</span><span><i class="e"></i>일정</span></div></section>`;
  }
  function dayCard(v) {
    const ds = S.calDay || todayStr(), d = new Date(ds + 'T00:00'), info = v.byDate[ds] || { todos: [], events: [] };
    return `<section class="card"><h2>${d.getMonth() + 1}월 ${d.getDate()}일 (${wk[d.getDay()]}) <small></small>${addBtn('add-todo', '할 일', ds)}${addBtn('add-event', '일정', ds)}</h2>
      ${info.todos.length ? todoList(info.todos) : ''}${info.events.length ? `<ul>${info.events.map((e) => evLi(e, false)).join('')}</ul>` : ''}${info.todos.length || info.events.length ? '' : '<div class="empty">이 날은 할 일·일정이 없어요</div>'}</section>`;
  }

  function sections(v) {
    const lessons = v.lessons.length
      ? `<ul>${v.lessons.map((l) => li(`${l.period}교시`, `${esc(l.text)}<small>${esc(l.start)} – ${esc(l.end)}</small>`, l.state === 'now' ? '<span class="chip">지금</span>' : l.state === 'next' ? '<span class="chip">다음</span>' : '', 'lesson ' + l.state)).join('')}</ul>`
      : '<div class="empty">오늘은 수업이 없어요</div>';
    return {
      today: `
        <section class="card"><h2>오늘 수업 <small>${v.lessons.length ? v.lessons.length + '시간' : ''}</small></h2>${lessons}</section>
        <section class="card"><h2>오늘 할 일 <small>${v.todayTodos.length ? v.todayTodos.length + '개' : ''}</small>${addBtn('add-todo', '할 일')}</h2>${v.todayTodos.length ? `${todoList(v.todayTodos.slice(0, 12))}${v.todayTodos.length > 12 ? `<div class="muted">외 ${v.todayTodos.length - 12}개 — 할 일 탭에서 볼 수 있어요</div>` : ''}` : '<div class="empty">오늘 할 일이 없어요</div>'}</section>
        <section class="card"><h2>오늘 일정 <small></small>${addBtn('add-event', '일정')}</h2>${v.todayEvents.length ? `<ul>${v.todayEvents.map((e) => evLi(e, false)).join('')}</ul>` : '<div class="empty">오늘은 일정이 없어요</div>'}</section>
        ${v.meals.length ? `<section class="card"><h2>오늘 급식</h2>${v.meals.map((m) => `<div class="muted">${esc(m.kind || '')}</div><div style="font-weight:700">${(m.dishes || []).map(esc).join(' · ')}</div>`).join('')}</section>` : ''}
        ${v.ddays.length ? `<section class="card"><h2>챙길 날</h2><ul>${v.ddays.map((d) => li(d.n === 0 ? 'D-DAY' : 'D-' + d.n, esc(d.t), `<span class="muted">${mmdd(d.date)}</span>`)).join('')}</ul></section>` : ''}`,
      todo: `<section class="card"><h2>할 일 <small>${v.todos.length}개</small>${addBtn('add-todo', '할 일')}</h2>${v.todos.length ? todoGroups(v) : '<div class="empty">남은 할 일이 없어요</div>'}</section>`,
      cal: `${calendarCard(v)}${dayCard(v)}<section class="card"><h2>앞으로 30일 일정 <small>${v.upcoming.length}개</small></h2>${v.upcoming.length ? `<ul>${v.upcoming.map((e) => evLi(e, true)).join('')}</ul>` : '<div class="empty">30일 안에 일정이 없어요</div>'}</section>`
    };
  }

  function welcome() {
    return `<div class="welcome"><img src="icon-192.png" alt=""><h2>딩동</h2><p>구글에 연결하면 PC 딩동의 시간표·할 일·일정을<br>폰에서 볼 수 있어요.</p>
      <button class="btn" id="login">구글로 연결하기</button>
      <ol class="steps"><li><b>PC 딩동</b>의 설정 → 구글 연동에서 연결하고 <b>지금 올리기</b>를 한 번 눌러요.</li><li>여기서 <b>같은 구글 계정</b>으로 연결해요.</li><li>내 구글 드라이브의 앱 전용 숨김 폴더만 써요.</li></ol></div>${S.error && S.error !== 'empty' ? `<div class="notice err">${esc(S.error)}</div>` : ''}`;
  }
  function emptyBackup() {
    return `<div class="notice">이 구글 계정에는 딩동 백업이 아직 없어요.</div>
      <section class="card"><h2>이렇게 해 보세요</h2><ul><li class="row"><div class="t">PC 딩동 → 설정 → <b>구글 연동</b> → <b>구글에 연결</b> → <b>지금 올리기</b></div></li><li class="row"><div class="t">PC에서 연결한 구글 계정과 <b>같은 계정</b>으로 여기서 연결했는지 확인해 주세요.</div></li></ul><div style="margin-top:12px"><button class="btn sm" id="reload">다시 읽기</button> <button class="btn ghost sm" id="logout">다른 계정으로 연결</button></div></section>`;
  }
  function more() {
    const v = S.view, at = ls.get(KEY.at);
    return `<section class="card"><h2>연결 정보</h2><div class="muted">마지막으로 읽은 때: ${esc(at ? when(at) : '-')}</div>
      <div class="muted">PC가 올린 때: ${esc(v && v.savedAt ? when(v.savedAt) : '-')}${v && v.host ? ' · ' + esc(v.host) : ''}</div>
      ${v && !v.hasSummary ? '<div class="muted" style="margin-top:6px">PC 딩동을 최신 버전으로 올리면 노션 할 일·그룹 일정·급식도 보여요.</div>' : ''}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="reload">지금 다시 읽기</button><button class="btn ghost sm" id="logout">연결 해제</button></div></section>
      <section class="card"><h2>안내</h2><ul><li class="row"><div class="t muted">PC에서 고친 내용은 PC 딩동이 켜져 있을 때 몇 분 안에 여기에 나타나요. 여기서 고친 할 일·일정·노션 할 일(체크·제목·날짜)은 PC 딩동이 켜져 있을 때 2분 안팎에 PC에 반영돼요. 그룹 일정은 PC에서 고쳐요.</div></li><li class="row"><div class="t muted">학생 정보(생기부)는 폰에 올라오지 않아요.</div></li><li class="row"><div class="t muted">"연결 해제"를 누르면 이 폰에 저장된 화면과 구글 연결이 지워져요.</div></li></ul></section>`;
  }

  function pendingNotice() {
    const unsent = S.pending.filter((p) => !p.sent).length, sent = S.pending.length - unsent;
    if (!S.pending.length) return '';
    return `<div class="notice">${unsent ? `${unsent}건은 인터넷이 연결되면 보내요. ` : ''}${sent ? `${sent}건은 PC 딩동이 켜져 있으면 곧 반영돼요(보통 2분 안팎).` : ''}</div>`;
  }

  /* ── 고치는 창(아래에서 올라오는 시트) ── */
  const sheet = () => $('#sheet');
  function closeSheet() { $('#scrim').hidden = true; sheet().innerHTML = ''; }
  const dayStr = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  function openTodo(x, dflt) {
    const e = !!x;
    sheet().dataset.kind = 'todo'; sheet().dataset.id = e ? x.id : '';
    sheet().innerHTML = `<h3>${e ? '할 일 고치기' : '할 일 추가'}</h3><label for="fText">할 일</label><input type="text" id="fText" maxlength="200" required value="${esc(e ? x.text : '')}">
      <label for="fDue">기한 (없으면 비워 두세요)</label><input type="date" id="fDue" value="${esc(e ? x.due : dflt || '')}">
      <label class="chk"><input type="checkbox" id="fStar" ${e && x.star ? 'checked' : ''}> 중요한 일</label>
      <div class="btns"><button class="btn" type="submit">저장</button>${e ? '<button class="btn danger" type="button" data-act="del">지우기</button>' : ''}<button class="btn ghost" type="button" data-act="close">닫기</button></div>`;
    $('#scrim').hidden = false; $('#fText').focus();
  }
  // 노션 할 일: 제목과 날짜만 고친다(노션 쪽 분류·내용은 PC나 노션에서). PC 딩동이 노션에 반영한다.
  function openNotion(x) {
    sheet().dataset.kind = 'notion'; sheet().dataset.id = x.pid;
    sheet().innerHTML = `<h3>노션 할 일 고치기</h3><label for="fText">제목</label><input type="text" id="fText" maxlength="200" required value="${esc(x.text)}">
      <label for="fDue">날짜</label><input type="date" id="fDue" required value="${esc(x.due)}">
      <p class="muted" style="margin:10px 0 0">저장하면 PC 딩동이 노션에 반영해요(PC가 켜져 있을 때 2분 안팎).</p>
      <div class="btns"><button class="btn" type="submit">저장</button><button class="btn ghost" type="button" data-act="close">닫기</button></div>`;
    $('#scrim').hidden = false; $('#fText').focus();
  }
  function openEvent(x, dflt) {
    const e = !!x;
    sheet().dataset.kind = 'event'; sheet().dataset.id = e ? x.id : '';
    sheet().innerHTML = `<h3>${e ? '일정 고치기' : '일정 추가'}</h3><label for="fTitle">일정</label><input type="text" id="fTitle" maxlength="100" required value="${esc(e ? x.title : '')}">
      <label for="fDate">날짜</label><input type="date" id="fDate" required value="${esc(e ? x.date : dflt || dayStr(new Date()))}">
      <label for="fTime">시간 (종일이면 비워 두세요)</label><input type="time" id="fTime" value="${esc(e ? x.time : '')}">
      <div class="btns"><button class="btn" type="submit">저장</button>${e ? '<button class="btn danger" type="button" data-act="del">지우기</button>' : ''}<button class="btn ghost" type="button" data-act="close">닫기</button></div>`;
    $('#scrim').hidden = false; $('#fTitle').focus();
  }
  function submitSheet(ev) {
    ev.preventDefault();
    const kind = sheet().dataset.kind, id = sheet().dataset.id;
    if (kind === 'todo') {
      const text = $('#fText').value.trim(); if (!text) return;
      const due = $('#fDue').value || '', star = $('#fStar').checked;
      if (id) queueOp({ t: 'todo.edit', tid: id, text, due, star }); else queueOp({ t: 'todo.add', tid: 'm' + rid(), text, due, star });
    } else if (kind === 'notion') {
      const text = $('#fText').value.trim(), due = $('#fDue').value; if (!text || !due) return;
      queueOp({ t: 'notion.edit', pid: id, title: text, date: due });
    } else if (kind === 'event') {
      const title = $('#fTitle').value.trim(), date = $('#fDate').value, time = $('#fTime').value || ''; if (!title || !date) return;
      if (id) queueOp({ t: 'event.edit', eid: id, title, date, time }); else queueOp({ t: 'event.add', eid: 'm' + rid(), title, date, time });
    }
  }
  function onAct(el) {
    const act = el.dataset.act, v = S.view; if (!v) return;
    if (act === 'close') return closeSheet();
    if (act === 'add-todo') return openTodo(null, el.dataset.date);
    if (act === 'add-event') return openEvent(null, el.dataset.date);
    if (act === 'cal-day') { S.calDay = el.dataset.date; S.calMonth = S.calDay.slice(0, 7); return draw(); }
    if (act === 'cal-today') { S.calDay = todayStr(); S.calMonth = S.calDay.slice(0, 7); return draw(); }
    if (act === 'cal-prev' || act === 'cal-next') { const [y, m] = S.calMonth.split('-').map(Number), d = new Date(y, m - 1 + (act === 'cal-next' ? 1 : -1), 1); S.calMonth = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; return draw(); }
    if (act === 'del') {
      const kind = sheet().dataset.kind, id = sheet().dataset.id;
      if (id) queueOp(kind === 'todo' ? { t: 'todo.del', tid: id } : { t: 'event.del', eid: id });
      return;
    }
    const x = v.todos.find((t) => t.key === el.dataset.key);
    if (act === 'edit-todo' && x) return openTodo(x);
    if (act === 'edit-notion' && x) return openNotion(x);
    if (act === 'edit-event') { const e = Object.values(v.byDate).flatMap((b) => b.events).find((q) => q.src === 'me' && q.id === el.dataset.eid); if (e) openEvent(e); return; }
    if (act === 'done' && x) queueOp(x.src === 'notion' ? { t: 'notion.done', pid: x.pid, prop: x.prop, done: true } : { t: 'todo.done', tid: x.id, done: true });
  }
  $('#app').addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) onAct(el); });
  $('#sheet').addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) onAct(el); });
  $('#sheet').addEventListener('submit', submitSheet);
  $('#scrim').addEventListener('click', (e) => { if (e.target === $('#scrim')) closeSheet(); });

  function draw() {
    const root = $('#app'), tabs = $('#tabs');
    const head = (sub) => `<header class="top"><img src="icon-192.png" alt=""><div><h1>딩동</h1><div class="sub">${esc(sub)}</div></div><button class="btn ghost sm" id="reload" ${S.busy ? 'disabled' : ''}>${S.busy ? '읽는 중…' : '새로고침'}</button></header>`;
    if (!S.payload) {
      tabs.hidden = true;
      if (S.busy) { root.innerHTML = head('') + `<div class="empty">${esc(S.status || '읽는 중…')}</div>`; return; }
      root.innerHTML = S.error === 'empty' ? head('') + emptyBackup() : welcome();
      bind(); return;
    }
    S.view = V.build(S.payload, new Date(), S.pending.map((p) => p.op));
    const v = S.view, sec = sections(v);
    tabs.hidden = false; tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    root.innerHTML = head(`${v.dateLabel}${v.school ? ' · ' + v.school : ''}`) + (S.status ? `<div class="notice">${esc(S.status)}</div>` : '') + pendingNotice() + (S.tab === 'more' ? more() : sec[S.tab] || sec.today);
    bind();
  }
  function bind() {
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('#login', () => refresh(true));
    on('#reload', () => refresh(!ls.get(KEY.granted)));
    on('#logout', () => {
      try { if (S.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(S.token, () => {}); } catch {}
      [KEY.payload, KEY.at, KEY.granted, KEY.pending].forEach(ls.del); S.pending = []; S.token = ''; S.payload = null; S.view = null; S.error = ''; S.tab = 'today'; draw();
    });
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; S.tab = b.dataset.tab; ls.set(KEY.tab, S.tab); draw(); window.scrollTo(0, 0); });

  /* ── 시작: 저장된 화면이 있으면 바로 보여 주고, 이미 허용했으면 조용히 새로 읽는다 ── */
  (function start() {
    const cached = ls.get(KEY.payload);
    if (cached) { try { S.payload = V.parseBackup(cached); } catch { ls.del(KEY.payload); } }
    draw();
    if (ls.get(KEY.granted)) refresh(false).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (S.payload) draw(); if (ls.get(KEY.granted) && !S.busy && Date.now() - Date.parse(ls.get(KEY.at) || 0) > 120000) refresh(false).catch(() => {}); } });
    setInterval(() => { if (document.visibilityState === 'visible' && S.payload && !S.busy && $('#scrim').hidden) draw(); }, 60000); // "지금 수업" 표시를 분마다 갱신(고치는 중에는 건드리지 않음)
    setInterval(() => { if (document.visibilityState === 'visible' && !S.busy && S.pending.length && ls.get(KEY.granted) && Date.now() - Date.parse(ls.get(KEY.at) || 0) > 100000) refresh(false).catch(() => {}); }, 30000); // 반영 대기 중이면 곧 확인
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();

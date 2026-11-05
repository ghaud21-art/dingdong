// 딩동 폰 보기: PC 딩동이 구글 드라이브에 올린 백업(dingdong-settings.json)을 오늘 화면에 쓸 데이터로 바꾼다. 화면과 시험에서 같이 쓴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDMobile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : -1; };
  const DEFAULT_BELL = [['08:40', '09:30'], ['09:40', '10:30'], ['10:40', '11:30'], ['11:40', '12:30'], ['13:30', '14:20'], ['14:30', '15:20'], ['15:30', '16:20']];

  // 칸에 "2-1 윤탐"이라고 적혀 있으면 "윤탐(2-1)" 모양으로
  function lessonText(c) {
    const t = String(c || '').trim(); if (!t) return '';
    const m = t.match(/^(\d+\s*[-–]\s*\d+)\s+(.+)$/);
    return m ? `${m[2]}(${m[1].replace(/\s+/g, '')})` : t;
  }

  function parseBackup(text) {
    let j; try { j = JSON.parse(text); } catch { throw new Error('구글 드라이브의 백업 파일을 읽지 못했어요.'); }
    if (!j || j.app !== 'dingdong' || !j.settings || typeof j.settings !== 'object') throw new Error('딩동 백업 파일이 아니에요.');
    return j;
  }

  function ddays(S, now) {
    const t0 = new Date(iso(now) + 'T00:00'), out = [], seen = new Set();
    String(S.ddayText || '').split('\n').forEach((l) => { const m = l.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/); if (m) out.push({ date: m[1], t: m[2] }); });
    return out.map((x) => ({ ...x, n: Math.round((new Date(x.date + 'T00:00') - t0) / 86400000) }))
      .filter((x) => x.n >= 0 && x.n <= 365).sort((a, b) => a.n - b.n)
      .filter((x) => { const k = x.date + '|' + x.t; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // 폰에서 고쳤지만 PC가 아직 반영하지 않은 수정 요청을 화면 데이터에 먼저 적용해 보여 준다
  const getOps = () => (typeof module === 'object' && module.exports ? require('./ops.js') : self.DDMobileOps);
  function overlay(payload, pending) {
    const done = new Set(Array.isArray(payload.mobileApplied) ? payload.mobileApplied : []);
    const ops = (Array.isArray(pending) ? pending : []).filter((o) => o && !done.has(o.id));
    if (!ops.length) return { payload, ops: [] };
    const S = payload.settings || {}, M = payload.mobile || {};
    const r = getOps().apply({ todos: Array.isArray(S.todos) ? S.todos : [], events: Array.isArray(S.events) ? S.events : [] }, ops);
    const notion = (Array.isArray(M.notion) ? M.notion : []).map((x) => ({ ...x }));
    for (const n of r.notion) notion.forEach((x) => { if (x && x.id === n.pid) { if (n.edit) { if (n.title !== undefined) x.title = n.title; if (n.date !== undefined) x.date = n.date; if (n.category !== undefined) x.cat = n.category; } else if (n.line) { x.body = (x.body || []).map((l) => (l.id === n.bid ? { ...l, t: n.text !== undefined ? n.text : l.t, c: n.checked !== undefined ? n.checked : l.c } : l)); } else if (n.add) { x.body = (x.body || []).concat([{ id: 'new-' + n.opId, k: 'text', l: 0, t: n.text, pend: true }]); } else x.done = n.done; } });
    return { payload: { ...payload, settings: { ...S, todos: r.todos, events: r.events }, mobile: payload.mobile ? { ...M, notion } : payload.mobile }, ops };
  }

  function build(payload0, nowDate, pending) {
    const ov = overlay(payload0, pending), payload = ov.payload;
    const pset = new Set(); ov.ops.forEach((o) => { const k = o.tid || o.eid || o.pid; if (k) pset.add(k); });
    const now = nowDate || new Date(), S = payload.settings || {}, M = payload.mobile || {};
    const today = iso(now), wd = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    const bell = Array.isArray(S.bell) && S.bell.length ? S.bell : DEFAULT_BELL;
    const tt = Array.isArray(S.timetable) ? S.timetable : [];
    const lessons = [];
    if (wd >= 1 && wd <= 5) {
      tt.forEach((row, i) => {
        const c = lessonText(row && row[wd - 1]); if (!c) return;
        const b = bell[i] || [], s = toMin(b[0]), e = toMin(b[1]);
        lessons.push({ period: i + 1, text: c, start: b[0] || '', end: b[1] || '', state: s < 0 ? 'later' : mins >= e ? 'done' : mins >= s ? 'now' : 'later' });
      });
      const nx = lessons.find((l) => l.state === 'later'); if (nx && !lessons.some((l) => l.state === 'now')) nx.state = 'next';
    }
    // 할 일: PC에 직접 적은 것 + 노션(PC가 요약해 올린 것)
    const DEF_TAGS = [{ id: 'homeroom', name: '담임', color: 'pink' }, { id: 'subject', name: '교과', color: 'peach' }, { id: 'work', name: '업무', color: 'butter' }];
    const tags = (Array.isArray(S.todoTags) ? S.todoTags : DEF_TAGS).filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.name.trim()).map((t) => ({ id: t.id, name: t.name.trim() }));
    const tagName = (id) => (tags.find((t) => t.id === id) || {}).name || '';
    const todos = [];
    (Array.isArray(S.todos) ? S.todos : []).forEach((x) => { if (x && !x.done && x.text) todos.push({ key: 'me:' + (x.id || ''), id: x.id || '', text: x.text, star: !!x.important, due: x.due || '', tag: x.tag || '', cat: tagName(x.tag), src: 'me', pending: pset.has(x.id) }); });
    (Array.isArray(M.notion) ? M.notion : []).forEach((x) => { if (x && !x.done && x.title) todos.push({ key: 'notion:' + (x.id || ''), id: x.id || '', pid: x.id || '', prop: x.prop || '', text: x.title, star: !!x.star, due: x.date || '', cat: x.cat || '', body: Array.isArray(x.body) ? x.body : null, src: 'notion', pending: pset.has(x.id) }); });
    todos.forEach((x) => { x.overdue = !!x.due && x.due < today; x.today = x.due === today; });
    const open = todos.sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || (a.due || '9999').localeCompare(b.due || '9999'));
    // 할 일 탭용 묶음: 기한 지남 / 오늘 / 이번 주(7일 안) / 그 뒤 / 기한 없음
    const weekEnd = iso(addDays(now, 7));
    const gkey = (x) => (!x.due ? 'none' : x.due < today ? 'late' : x.due === today ? 'today' : x.due <= weekEnd ? 'week' : 'later');
    const todoGroups = [['late', '기한 지남'], ['today', '오늘'], ['week', '이번 주'], ['later', '그 뒤'], ['none', '기한 없음']]
      .map(([key, label]) => ({ key, label, items: open.filter((x) => gkey(x) === key).sort((a, b) => (a.due || '').localeCompare(b.due || '') || (b.star ? 1 : 0) - (a.star ? 1 : 0)) })).filter((g) => g.items.length);
    const todayTodos = open.filter((x) => !x.due || x.due <= today);
    // 일정: 내 일정 + 그룹 일정(PC가 올린 것) — 오늘부터 30일
    const end = iso(addDays(now, 30));
    const events = [];
    (Array.isArray(S.events) ? S.events : []).forEach((e) => { if (e && e.date && e.title) events.push({ id: e.id || '', date: e.date, time: e.time || '', title: e.title, src: 'me', label: '내 일정', pending: pset.has(e.id) }); });
    (Array.isArray(M.groupEvents) ? M.groupEvents : []).forEach((e) => { if (e && e.date && e.title) events.push({ date: e.date, time: e.time || '', title: e.title, src: 'group', label: e.gname || '그룹' }); });
    const upcoming = events.filter((e) => e.date >= today && e.date <= end).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
    // 달력용: 날짜별 할 일(기한이 있는 것)·일정
    const byDate = {}; const slot = (d) => byDate[d] || (byDate[d] = { todos: [], events: [] });
    open.forEach((x) => { if (x.due) slot(x.due).todos.push(x); });
    events.slice().sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).forEach((e) => slot(e.date).events.push(e));
    // 급식: PC가 올린 요약이 오늘 것일 때만
    const meals = M.mealsDate === today && Array.isArray(M.meals) ? M.meals : [];
    return {
      today, dateLabel: `${now.getMonth() + 1}월 ${now.getDate()}일 ${DAYS[wd]}요일`, school: (S.school && S.school.name) || '',
      lessons, todos: open, todayTodos, upcoming, todayEvents: upcoming.filter((e) => e.date === today), meals, ddays: ddays(S, now).slice(0, 3),
      tags, todoGroups, notionCat: M.notionCat || null, byDate, pendingCount: ov.ops.length, savedAt: payload.savedAt || '', host: payload.host || '', summaryAt: M.at || '', hasSummary: !!payload.mobile
    };
  }

  return { build, parseBackup, lessonText, overlay, DAYS };
});

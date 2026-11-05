// 폰에서 보낸 "수정 요청"을 할 일·일정에 적용한다. PC 딩동(화면)과 폰 화면이 같은 규칙을 쓰도록 한 파일을 둔다(폰 쪽은 pubrepo 의 app/ops.js 로 복사, 두 파일은 같아야 한다 — 시험에서 확인).
// 순수 함수라서 같은 요청을 두 번 받아도 결과가 같다(이미 있는 번호의 추가는 건너뜀).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDMobileOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const validDate = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); if (!m) return false;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
  };
  const TYPES = ['todo.add', 'todo.done', 'todo.edit', 'todo.del', 'event.add', 'event.edit', 'event.del', 'notion.done', 'notion.edit'];
  const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

  // 요청 하나를 검사해 안전한 모양으로 돌려준다. 이상하면 null.
  function clean(op) {
    if (!op || typeof op !== 'object' || !TYPES.includes(op.t) || !ID.test(String(op.id || ''))) return null;
    const o = { id: String(op.id), t: op.t, ts: /^\d{4}-\d{2}-\d{2}T/.test(String(op.ts)) ? String(op.ts) : '' };
    const date = (k, req) => { if (op[k] === undefined || op[k] === null) return !req; if (op[k] === '' && !req) { o[k] = ''; return true; } if (!validDate(op[k])) return false; o[k] = String(op[k]); return true; };
    switch (op.t) {
      case 'todo.add': { if (!ID.test(String(op.tid || ''))) return null; o.tid = String(op.tid); o.text = clip(op.text, 200); if (!o.text) return null; if (!date('due', false)) return null; o.star = !!op.star; return o; }
      case 'todo.done': { if (!ID.test(String(op.tid || ''))) return null; o.tid = String(op.tid); o.done = !!op.done; return o; }
      case 'todo.edit': { if (!ID.test(String(op.tid || ''))) return null; o.tid = String(op.tid); if (op.text !== undefined) { o.text = clip(op.text, 200); if (!o.text) return null; } if (!date('due', false)) return null; if (op.star !== undefined) o.star = !!op.star; return o; }
      case 'todo.del': { if (!ID.test(String(op.tid || ''))) return null; o.tid = String(op.tid); return o; }
      case 'event.add': { if (!ID.test(String(op.eid || ''))) return null; o.eid = String(op.eid); o.title = clip(op.title, 100); if (!o.title || !date('date', true)) return null; o.time = op.time ? String(op.time) : ''; if (o.time && !HM.test(o.time)) return null; return o; }
      case 'event.edit': { if (!ID.test(String(op.eid || ''))) return null; o.eid = String(op.eid); if (op.title !== undefined) { o.title = clip(op.title, 100); if (!o.title) return null; } if (op.date !== undefined && !date('date', true)) return null; if (op.time !== undefined) { o.time = op.time ? String(op.time) : ''; if (o.time && !HM.test(o.time)) return null; } return o; }
      case 'event.del': { if (!ID.test(String(op.eid || ''))) return null; o.eid = String(op.eid); return o; }
      case 'notion.edit': { if (!ID.test(String(op.pid || '').replace(/-/g, 'x'))) return null; o.pid = String(op.pid); if (op.title !== undefined) { o.title = clip(op.title, 200); if (!o.title) return null; } if (op.date !== undefined && !date('date', true)) return null; if (o.title === undefined && o.date === undefined) return null; return o; }
      case 'notion.done': { if (!ID.test(String(op.pid || '').replace(/-/g, 'x'))) return null; o.pid = String(op.pid); o.prop = clip(op.prop, 60); if (!o.prop) return null; o.done = !!op.done; return o; }
    }
    return null;
  }

  // state: { todos:[], events:[] } 를 고치지 않고 새 모양을 돌려준다.
  function apply(state, ops) {
    let todos = (Array.isArray(state?.todos) ? state.todos : []).map((x) => ({ ...x }));
    let events = (Array.isArray(state?.events) ? state.events : []).map((x) => ({ ...x }));
    const applied = [], rejected = [], notion = [];
    const byTodo = (id) => todos.find((x) => x.id === id), byEv = (id) => events.find((x) => x.id === id);
    for (const raw of (Array.isArray(ops) ? ops : [])) {
      const op = clean(raw);
      if (!op) { rejected.push({ id: String(raw && raw.id || ''), why: '모양이 올바르지 않아요' }); continue; }
      switch (op.t) {
        case 'todo.add': if (!byTodo(op.tid)) todos.push({ id: op.tid, text: op.text, tag: 'work', due: op.due || '', done: false, important: !!op.star }); break;
        case 'todo.done': { const x = byTodo(op.tid); if (x) x.done = op.done; break; }
        case 'todo.edit': { const x = byTodo(op.tid); if (x) { if (op.text !== undefined) x.text = op.text; if (op.due !== undefined) x.due = op.due; if (op.star !== undefined) x.important = op.star; } break; }
        case 'todo.del': todos = todos.filter((x) => x.id !== op.tid); break;
        case 'event.add': if (!byEv(op.eid)) events.push({ id: op.eid, date: op.date, time: op.time || '', title: op.title }); break;
        case 'event.edit': { const x = byEv(op.eid); if (x) { if (op.title !== undefined) x.title = op.title; if (op.date !== undefined) x.date = op.date; if (op.time !== undefined) x.time = op.time; } break; }
        case 'event.del': events = events.filter((x) => x.id !== op.eid); break;
        case 'notion.edit': notion.push({ opId: op.id, pid: op.pid, edit: true, title: op.title, date: op.date }); break;
        case 'notion.done': notion.push({ opId: op.id, pid: op.pid, prop: op.prop, done: op.done }); break;
      }
      applied.push(op.id);
    }
    return { todos, events, notion, applied, rejected };
  }

  return { apply, clean, TYPES };
});

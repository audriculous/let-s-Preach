// The weekly prep plan: a few steps spread over the days before you preach. Your
// usual week is a template (Settings); each sermon gets its own copy that you can
// bend: rename, move, add or drop steps, or spread what is left when a week goes
// sideways. Steps tick themselves when the work shows up in the study, and you can
// always tick or untick by hand.

import { esc } from './verses.js';

export const DEFAULT_STEPS = [
  { id: 'read', label: 'Read it slowly and pray', day: 6, auto: '' },
  { id: 'observe', label: 'Observe: mark up the text', day: 5, auto: 'observe' },
  { id: 'shape', label: 'Big idea and breakup', day: 4, auto: 'shape' },
  { id: 'apply', label: 'Christ and application', day: 3, auto: 'apply' },
  { id: 'write', label: 'Illustrations and write it up', day: 2, auto: 'write' },
  { id: 'rehearse', label: 'Preach it out loud', day: 1, auto: 'rehearse' },
];

const AUTO = {
  observe: s => (s.strokes || []).length >= 5 || (s.spots || []).length > 0 || !!s.connectives,
  shape: s => !!(s.outline && String(s.outline.bigIdea || '').trim() && (s.outline.points || []).length >= 2),
  apply: s => {
    const o = s.outline || {}, cc = o.cc || {};
    const has = a => a && (String(a.text || '').trim() || (a.pad && a.pad.strokes.length));
    const grid = o.grid && (o.grid.on || []).some(k => has(o.grid.a && o.grid.a[k]));
    return !!(has(cc.christ) && (String(o.application || '').trim() || (o.pads && o.pads.application && o.pads.application.strokes.length) || grid));
  },
  write: s => {
    const o = s.outline || {};
    return !!(String(o.illustrations || '').trim() || (o.pads && o.pads.illustrations && o.pads.illustrations.strokes.length));
  },
  rehearse: s => !!s.rehearsed,
};
export const AUTO_LABELS = {
  '': 'Tick it yourself', observe: 'Ticks when you mark up the page', shape: 'Ticks with a big idea and two points',
  apply: 'Ticks when Christ and application are answered', write: 'Ticks when illustrations are in', rehearse: 'Ticks when you open Preach this study',
};

const DAY = 864e5;
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const atNoon = iso => new Date(iso + 'T12:00');
const addDays = (iso, n) => isoDay(new Date(atNoon(iso).getTime() + n * DAY));
export const daysBetween = (a, b) => Math.round((atNoon(b) - atNoon(a)) / DAY);
export const today = () => isoDay(new Date());
const sid = () => 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
export const shortDay = iso => atNoon(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const weekday = iso => atNoon(iso).toLocaleDateString(undefined, { weekday: 'long' });

export function templateSteps(settings) {
  const t = settings.planSteps;
  return Array.isArray(t) && t.length ? t : DEFAULT_STEPS;
}

function fromTemplate(date, settings) {
  return {
    date,
    steps: templateSteps(settings).map(t => ({ id: t.id || sid(), label: t.label, due: addDays(date, -t.day), auto: t.auto || '' })),
  };
}

// The study's plan: its own if it has one (moved along if the preaching date changed),
// otherwise your usual week laid against its date. Null without a date.
export function planFor(study, settings) {
  const date = study.preached;
  if (!date || settings.planOn === false) return null;
  const p = study.plan;
  if (!p) return fromTemplate(date, settings);
  if (p.date !== date) {
    const shift = daysBetween(p.date, date);
    p.steps.forEach(st => { st.due = addDays(st.due, shift); });
    p.date = date;
  }
  return p;
}

// Keep a plan on the study once you change anything in it.
const own = (study, plan) => { study.plan = plan; return plan; };

export const isDone = (st, study) => st.done === true || (st.done !== false && !!(AUTO[st.auto] && AUTO[st.auto](study)));
const autoDone = (st, study) => st.done == null && !!(AUTO[st.auto] && AUTO[st.auto](study));

export function status(study, settings, now = today()) {
  const plan = planFor(study, settings);
  if (!plan) return null;
  const steps = [...plan.steps].sort((a, b) => a.due.localeCompare(b.due));
  const open = steps.filter(st => !isDone(st, study));
  return {
    plan, date: plan.date,
    done: steps.length - open.length, total: steps.length,
    behind: open.filter(st => st.due < now),
    todays: open.filter(st => st.due === now),
    next: open.find(st => st.due > now) || null,
    daysLeft: daysBetween(now, plan.date),
  };
}

// Spread the unfinished steps evenly from today to the day before preaching (or to
// the day itself when there is no room), keeping their order.
export function spread(study, settings, now = today()) {
  const plan = own(study, planFor(study, settings));
  const open = [...plan.steps].sort((a, b) => a.due.localeCompare(b.due)).filter(st => !isDone(st, study));
  const last = daysBetween(now, plan.date) >= 1 ? addDays(plan.date, -1) : plan.date;
  const span = Math.max(0, daysBetween(now, last));
  const first = daysBetween(now, last) < 0 ? plan.date : now;
  open.forEach((st, i) => {
    st.due = open.length === 1 || span === 0 ? first : addDays(first, Math.round(i * span / (open.length - 1)));
  });
  return open.length;
}

export function resetToTemplate(study, settings) {
  const fresh = fromTemplate(study.preached, settings);
  const old = study.plan ? study.plan.steps : [];
  fresh.steps.forEach(st => { const o = old.find(x => x.id === st.id); if (o && o.done != null) st.done = o.done; });
  study.plan = fresh;
}

export function saveAsTemplate(study, settings) {
  const plan = planFor(study, settings);
  settings.planSteps = [...plan.steps].sort((a, b) => a.due.localeCompare(b.due))
    .map(st => ({ id: st.id, label: st.label, day: Math.max(0, daysBetween(st.due, plan.date)), auto: st.auto || '' }));
}

// One line for the home screen.
export function summary(st, now = today()) {
  if (st.done === st.total) return { text: 'Every step is done. Well prepared.', tone: 'good' };
  if (st.behind.length) {
    const b = st.behind[0];
    return { text: `Behind: ${b.label} (was ${weekday(b.due)})${st.behind.length > 1 ? ` and ${st.behind.length - 1} more` : ''}`, tone: 'behind' };
  }
  if (st.todays.length) return { text: `Today: ${st.todays.map(x => x.label).join(', ')}`, tone: 'today' };
  if (st.next) return { text: `All caught up. Next: ${st.next.label}, ${daysBetween(now, st.next.due) === 1 ? 'tomorrow' : weekday(st.next.due)}`, tone: 'good' };
  return { text: 'All caught up.', tone: 'good' };
}

// ---------- the Plan tab in the side sheet ----------

export function renderPlanPane(pane, { study, settings, save, saveSettings, toast, onChange }) {
  const now = today();
  const plan = planFor(study, settings);
  if (settings.planOn === false) {
    pane.innerHTML = `<p class="eyebrow">Prep plan</p><p class="hint">The prep plan is turned off. Turn it on in Settings, under Weekly prep plan.</p>`;
    return;
  }
  if (!plan) {
    pane.innerHTML = `<p class="eyebrow">Prep plan</p>
      <h3 class="plan-title">When are you preaching this?</h3>
      <p class="hint">Pick the date and your usual week is laid out before it. You can change any of it.</p>
      <input type="date" class="field" id="planDate" min="${now}">`;
    pane.querySelector('#planDate').addEventListener('change', e => {
      if (!e.target.value) return;
      study.preached = e.target.value;
      save(); onChange();
    });
    return;
  }
  const st = status(study, settings, now);
  const steps = [...plan.steps].sort((a, b) => a.due.localeCompare(b.due));
  const until = st.daysLeft > 1 ? `${st.daysLeft} days to go` : st.daysLeft === 1 ? 'Tomorrow' : st.daysLeft === 0 ? 'Today' : 'Preached';
  pane.innerHTML = `
    <p class="eyebrow">Prep plan · ${esc(until)}</p>
    <h3 class="plan-title">Preaching ${esc(shortDay(plan.date))}</h3>
    <div class="plan-bar"><span style="width:${Math.round(100 * st.done / Math.max(1, st.total))}%"></span></div>
    <p class="hint">${st.done} of ${st.total} done. Tap a step to rename it, tap its date to move it. Steps with a dot tick themselves as the work shows up.</p>
    <ul class="plan-steps" id="planSteps"></ul>
    <button type="button" class="text-link" id="planAdd">+ Add a step</button>
    <div class="plan-actions">
      <button type="button" class="chip-btn small" id="planSpread">Busy week? Spread what is left from today</button>
      <button type="button" class="chip-btn small" id="planReset">Back to my usual week</button>
      <button type="button" class="text-link" id="planTemplate">Make this my usual week</button>
    </div>`;
  const ul = pane.querySelector('#planSteps');
  for (const s of steps) {
    const done = isDone(s, study), auto = autoDone(s, study);
    const li = document.createElement('li');
    li.className = 'plan-step' + (done ? ' done' : s.due < now ? ' behind' : s.due === now ? ' today' : '');
    li.innerHTML = `
      <input type="checkbox" class="plan-check" aria-label="Done">
      <div class="plan-main">
        <input class="plan-label" spellcheck="true">
        <div class="plan-meta">
          <input type="date" class="plan-due" aria-label="Day">
          <span class="plan-when"></span>
          ${s.auto ? `<span class="plan-auto" title="${esc(AUTO_LABELS[s.auto] || '')}">${auto ? 'Looks done' : '•'}</span>` : ''}
        </div>
      </div>
      <button type="button" class="point-del" aria-label="Remove step">×</button>`;
    const cb = li.querySelector('.plan-check'), label = li.querySelector('.plan-label'), due = li.querySelector('.plan-due');
    cb.checked = done;
    label.value = s.label;
    due.value = s.due;
    due.max = plan.date;
    li.querySelector('.plan-when').textContent = s.due === now ? 'Today' : daysBetween(now, s.due) === 1 ? 'Tomorrow' : weekday(s.due);
    cb.addEventListener('change', () => { own(study, plan); s.done = cb.checked; save(); onChange(); });
    label.addEventListener('change', () => { own(study, plan); s.label = label.value.trim() || s.label; save(); onChange(); });
    due.addEventListener('change', () => { if (!due.value) return; own(study, plan); s.due = due.value; save(); onChange(); });
    li.querySelector('.point-del').addEventListener('click', () => {
      own(study, plan);
      plan.steps = plan.steps.filter(x => x !== s);
      save(); onChange();
    });
    ul.appendChild(li);
  }
  pane.querySelector('#planAdd').addEventListener('click', () => {
    own(study, plan);
    const day = now < plan.date ? now : plan.date;
    plan.steps.push({ id: sid(), label: 'New step', due: day, auto: '' });
    save(); onChange();
    const inputs = pane.querySelectorAll('.plan-label');
    const last = [...inputs].find(i => i.value === 'New step');
    if (last) { last.focus(); last.select(); }
  });
  pane.querySelector('#planSpread').addEventListener('click', () => {
    const n = spread(study, settings, now);
    save(); onChange();
    toast(n ? `${n} step${n === 1 ? '' : 's'} spread from today to ${weekday(addDays(plan.date, daysBetween(now, plan.date) >= 1 ? -1 : 0))}` : 'Nothing left to do');
  });
  pane.querySelector('#planReset').addEventListener('click', () => { resetToTemplate(study, settings); save(); onChange(); toast('Back to your usual week'); });
  pane.querySelector('#planTemplate').addEventListener('click', () => {
    saveAsTemplate(study, settings); saveSettings();
    toast('Saved as your usual week. New sermons will start with it.');
  });
}

// ---------- your usual week, in Settings ----------

export function renderTemplateEditor(box, { settings }) {
  // Edits a working copy; the caller saves it with the rest of Settings.
  const steps = (box._steps = box._steps || templateSteps(settings).map(s => ({ ...s })));
  const opts = n => Array.from({ length: 14 }, (_, d) => `<option value="${d}"${d === n ? ' selected' : ''}>${d === 0 ? 'On the day' : d === 1 ? '1 day before' : d + ' days before'}</option>`).join('');
  box.innerHTML = `<ul class="tpl-steps">${steps.map((s, i) => `
    <li data-i="${i}"><input class="field tpl-label" value="${esc(s.label)}" aria-label="Step"><select class="field select tpl-day" aria-label="When">${opts(s.day)}</select>
    <button type="button" class="point-del" aria-label="Remove">×</button></li>`).join('')}</ul>
    <div class="tpl-foot"><button type="button" class="text-link" id="tplAdd">+ Add a step</button><button type="button" class="text-link" id="tplReset">Use the suggested week</button></div>`;
  box.querySelectorAll('li').forEach(li => {
    const s = steps[+li.dataset.i];
    li.querySelector('.tpl-label').addEventListener('input', e => { s.label = e.target.value; });
    li.querySelector('.tpl-day').addEventListener('change', e => { s.day = +e.target.value; });
    li.querySelector('.point-del').addEventListener('click', () => { steps.splice(+li.dataset.i, 1); renderTemplateEditor(box, { settings }); });
  });
  box.querySelector('#tplAdd').addEventListener('click', () => { steps.push({ id: sid(), label: 'New step', day: 1, auto: '' }); renderTemplateEditor(box, { settings }); });
  box.querySelector('#tplReset').addEventListener('click', () => { box._steps = DEFAULT_STEPS.map(s => ({ ...s })); renderTemplateEditor(box, { settings }); });
}

export function readTemplateEditor(box) {
  const steps = (box._steps || []).filter(s => String(s.label || '').trim()).map(s => ({ ...s, label: s.label.trim(), id: s.id || sid() }));
  box._steps = null;
  return steps.sort((a, b) => b.day - a.day);
}

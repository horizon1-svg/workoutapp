// Repeatable logic tests for WorkoutApp. Run from the project folder:   node tests/run-tests.js
// No dependencies: the app files are loaded into a Node `vm` with a minimal fake DOM and a controllable clock.
// Covers: data integrity (streak/history/progress/backup), custom modifications, added exercises (max 10), workout flow.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = fs.existsSync(path.join(__dirname, 'app.js')) ? __dirname : path.join(__dirname, '..'); // works from tests/ and from a flat repo
const J = JSON.stringify;

// WA_TEST_MODE=gen runs the Phase 2 sections AFTER the migration: the tests keep reading/writing the 'wa_*' keys through a view of the generation in use.
const GEN_VIEW = process.env.WA_TEST_MODE === 'gen';
function make(nowISO, store, opts) {
  const clock = { t: new Date(nowISO).getTime() };
  store = store || {};
  const RD = Date;
  class FD extends RD { constructor(...a) { a.length ? super(...a) : super(clock.t); } static now() { return clock.t; } }
  const roots = {}, fields = {}, copied = [], toasts = [];
  let ops = 0; // writes/removes of 'wa_' keys so far (used to stop the program abruptly at an exact point)
  const crashGate = (k) => { if (opts && opts.crashAt !== undefined && /^wa_/.test(k)) { if (ops >= opts.crashAt) { for (;;) { /* the app is killed here: no code after this point ever runs */ } } ops++; } };
  const genView = GEN_VIEW && !(opts && opts.legacy) || !!(opts && opts.dataSafety);
  const mk = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {} }, _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; },
    addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {}, firstElementChild: null, querySelector: () => null, focus() {}, select() {} });
  const doc = { visibilityState: 'visible', body: { appendChild: (el) => toasts.push(el.textContent) },
    getElementById: (id) => fields[id] || (roots[id] = roots[id] || mk()), querySelector: mk, querySelectorAll: () => [],
    createElement: () => Object.assign(mk(), { className: '', textContent: '', value: '' }), addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') doc.__init = fn; }, documentElement: mk(), readyState: opts && opts.deferInit ? 'loading' : 'complete' };
  const c = { WA_DATA_SAFETY_AUTOSTART: genView, WA_STORAGE_LIMIT_CHARS: opts && opts.limit, console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date: FD, Math,
    localStorage: { getItem: (k) => store[k] ?? null, key: (i) => { if (c.__listFail === 'key') throw new Error('localStorage.key failed'); return Object.keys(store)[i] === undefined ? null : Object.keys(store)[i]; },
      get length() { if (c.__listFail === 'length') throw new Error('localStorage.length failed'); if (c.__listFail === 'nan') return undefined; return Object.keys(store).length; }, // the Web Storage listing API (tests can make it fail while the app runs: c.__listFail)
      setItem: (k, v) => { crashGate(k); if (opts && opts.frozen && opts.frozen(k)) return; const nv = opts && opts.onWrite ? opts.onWrite(k, v) : undefined; store[k] = nv === undefined ? v : nv; },
      removeItem: (k) => { crashGate(k); if (opts && opts.frozen && opts.frozen(k)) return; if (opts && opts.onRemove) opts.onRemove(k); delete store[k]; } },
    document: doc, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } }, addEventListener() {}, requestAnimationFrame() {}, AudioContext: function () {} };
  c.window = c; c.store = store; c.rawStore = store; c.copied = copied; c.toasts = toasts; c.roots = roots;
  c.setField = (id, v) => { fields[id] = { value: v, focus() {}, select() {} }; };
  c.setNow = (iso) => { clock.t = new Date(iso).getTime(); };
  if (opts && opts.noEnumerate) { delete c.localStorage.key; delete c.localStorage.length; } // a storage that cannot be listed (not the case for real browsers)
  c.__listFail = (opts && opts.listFail) || null;
  c.__armed = !!(opts && opts.crashAt !== undefined);
  vm.createContext(c);
  if (genView && GEN_VIEW) { // legacy-looking view of the keys that now live in the generation
    const VIEW = { wa_history: 1, wa_exerciseMods: 1, wa_customExercises: 1, wa_settings: 1, wa_theme: 1, wa_accentTheme: 1 };
    c.store = new Proxy(store, {
      get(t, k) { if (typeof k === 'string' && VIEW[k]) { const v = vm.runInContext(`Store.get(${J(k.slice(3))}, undefined)`, c); return v === undefined ? undefined : J(v); } return t[k]; },
      set(t, k, v) { if (typeof k === 'string' && VIEW[k]) { let p; try { p = JSON.parse(v); } catch (e) { t[k] = v; return true; } vm.runInContext(`Store.set(${J(k.slice(3))}, ${J(p)})`, c); return true; } t[k] = v; return true; },
      has(t, k) { return (typeof k === 'string' && VIEW[k]) ? vm.runInContext(`Store.get(${J(k.slice(3))}, undefined)`, c) !== undefined : k in t; },
      ownKeys(t) { const ks = Reflect.ownKeys(t).filter((k) => !VIEW[k]); Object.keys(VIEW).forEach((k) => { if (vm.runInContext(`Store.get(${J(k.slice(3))}, undefined)`, c) !== undefined) ks.push(k); }); return ks; },
      getOwnPropertyDescriptor(t, k) { if (typeof k === 'string' && VIEW[k]) { const v = vm.runInContext(`Store.get(${J(k.slice(3))}, undefined)`, c); return v === undefined ? undefined : { value: J(v), enumerable: true, configurable: true, writable: true }; } return Reflect.getOwnPropertyDescriptor(t, k); },
    });
  }
  const to = c.__armed ? { timeout: 400 } : {};
  for (const f of ['icons.js', 'data.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, Object.assign({ filename: f }, to));
  return c;
}
const run = (c, s) => vm.runInContext(s, c, c.__armed ? { timeout: 400 } : undefined);
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra !== undefined ? ' -> ' + extra : '')); } console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' -> ' + extra : '')); }
function noThrow(name, fn) { let err = null; try { fn(); } catch (e) { err = e.message; } ok(name, !err, err); }

// ---- fixtures ----
const W = (date, o = {}) => ({ type: o.type || 'PUSH_A', date, status: 'COMPLETED', startedAt: new Date(date + 'T' + (o.time || '18:00:00')).getTime(), endedAt: 0,
  durationSeconds: o.dur === undefined ? 2400 : o.dur,
  summary: { completedSets: o.sets === undefined ? 18 : o.sets, totalSetsPlanned: 21, completedExercises: 6, totalExercises: 7, skippedExercises: 0, skippedSets: 0 },
  ...(o.details === false ? {} : { details: { exercises: [{ name: 'Push-ups', type: 'REPS', target: 15, sets: 3 }, { name: 'Plank', type: 'TIME', target: 60, sets: 1 }],
    results: [{ exercise: 0, set: 1, status: 'completed', actual: o.reps === undefined ? 15 : o.reps }, { exercise: 0, set: 2, status: 'completed', actual: 12 }, { exercise: 1, set: 1, status: 'completed', actual: null }] }, durationMeasured: true }) });
const R = (date) => ({ type: 'REST', date, status: 'COMPLETED' });
const seed = (c, list) => run(c, `Store.set('history', ${J(list)})`);
const streak = (c, today) => run(c, `computeStreak('${today}')`);
const agg = (c) => J(run(c, "(function(){const idx=buildDayIndex();const d=Object.keys(idx);return ['sets','duration','reps','sessions'].map(m=>aggregate(idx,d,m).v)})()"));
const names = (c) => run(c, 'state.exerciseList.map(e=>e.name)');
const balanced = (h) => { const n = (re) => (h.match(re) || []).length; return n(/<div/g) === n(/<\/div>/g) && n(/<button/g) === n(/<\/button>/g) && n(/<svg/g) === n(/<\/svg>/g) && !/undefined|NaN/.test(h); };
const NOW = '2026-10-13T12:00:00';
const noMods = (s) => s.wa_exerciseMods === undefined || s.wa_exerciseMods === '{}'; // before the migration the key is absent; in a generation the plan always holds an (empty) object

// =====================================================================
console.log('\n== 1. DATA INTEGRITY ==');
let c = make(NOW);
ok('strict dates: rejects impossible/malformed', ['2026-02-30', '2026-13-01', '2026-00-10', '0000-01-01', '2026-1-5', '', 'x', null, 20261001].every((d) => run(c, `isValidDateStr(${J(d)})`) === false));
ok('strict dates: accepts real dates incl. leap day', ['2028-02-29', '2026-10-13', '2027-12-31'].every((d) => run(c, `isValidDateStr('${d}')`) === true) && run(c, "isValidDateStr('2027-02-29')") === false);
seed(c, [W('2026-02-30'), W('2026-13-01'), W('2026-10-12'), W('2026-10-13')]);
ok('impossible dates create no records or false streaks', run(c, 'validHistory().length') === 2 && streak(c, '2026-10-13').current === 2 && streak(c, '2026-10-13').best === 2);
seed(c, [W('2026-10-11'), R('2026-10-12')]);
let idx = run(c, 'buildDayIndex()');
ok('unknown day is absent, never workout/rest', idx['2026-10-13'] === undefined && idx['2026-10-10'] === undefined);
ok('explicit rest stays distinct from missing', idx['2026-10-12'].status === 'R' && idx['2026-10-13'] === undefined);
seed(c, [Object.assign(R('2026-10-12'), { summary: { completedSets: 99 }, durationSeconds: 99999, details: { results: [] } }), W('2026-10-11')]);
ok('rest day adds 0 sessions / 0 sets / 0 duration / 0 reps even if the record carries stray numbers',
  J(run(c, "(function(){const i=buildDayIndex();return ['sessions','sets','duration','reps'].map(m=>aggregate(i,['2026-10-12'],m))})()").map((a) => [a.kind, a.v])) === '[["zero",0],["zero",0],["zero",0],["zero",0]]');
seed(c, [W('2026-10-14'), W('2026-10-20'), W('2026-10-13')]);
ok('future-dated records never inflate streak', streak(c, '2026-10-13').current === 1);
ok('future-dated records are not shown on the calendar', !run(c, "(function(){goProgress();state.progress.month='2026-10';return renderProgress()})()").includes('aria-label="2026-10-14, workout recorded"'));
ok('future-dated records are not exported', !run(c, "buildProgressExport('30')").includes('2026-10-14 | WORKOUT'));
ok('future-dated records stay stored (not deleted)', run(c, "Store.get('history').length") === 3);
// malformed data never throws or produces NaN
const bad = [{ type: 'PUSH_A', date: '2026-10-10', status: 'COMPLETED', summary: null, durationSeconds: 'abc', details: { exercises: [null, 5], results: [null, 7, { exercise: 0, status: 'completed', actual: 'x' }] } },
  { type: 'PUSH_A', date: '2026-10-11', status: 'COMPLETED', summary: { completedSets: -4 }, durationSeconds: -50 },
  { type: 'PUSH_A', date: '2026-10-12', status: 'COMPLETED', summary: 'junk', details: 'junk', durationSeconds: NaN }, 'junk', null, 5, { date: '2026-10-09' }];
seed(c, bad);
noThrow('malformed history: progress, every metric/range, export, copy never throw', () => {
  run(c, 'goProgress()'); const h = run(c, 'renderProgress()');
  for (const r of ['daily', 'weekly', 'monthly']) for (const m of ['duration', 'sessions', 'sets', 'reps']) run(c, `setProgressRange('${r}');setProgressMetric('${m}');renderProgress()`);
  const ex = run(c, "buildProgressExport('all')"); run(c, 'validHistory().forEach(h=>entryToText(h))');
  if (/NaN|undefined/.test(h + ex)) throw new Error('NaN/undefined in output');
});
ok('malformed values are unavailable, never zero or negative', run(c, "validHistory().every(h=>entryReps(h)===null)") && run(c, "entryDuration(validHistory()[0]).sec") === null && J(run(c, "dayMetric(buildDayIndex()['2026-10-11'],'sets')")) === '{"k":"na"}');
// compaction
c = make(NOW);
const many = []; for (let i = 0; i < 200; i++) many.push(W(run(c, `addDaysStr('2026-10-13',${-i})`), { reps: 10 + (i % 5) }));
seed(c, many); const before = agg(c), sBefore = J(streak(c, '2026-10-13'));
run(c, "saveHistoryEntry(Object.assign({}, validHistory()[0], {date:'2026-10-14', startedAt: 1}))");
c.store.wa_history = J(run(c, "Store.get('history')").filter((h) => h.startedAt !== 1));
if (GEN_VIEW) run(c, "(function(){const h=Store.get('history');compactHistory(h);Store.set('history',h)})()"); // after the migration old records are condensed only when a generation is written, never by a routine save
ok('compaction preserves sets/duration/reps/sessions and the streak', agg(c) === before && J(streak(c, '2026-10-13')) === sBefore, before + ' | ' + agg(c));
const hist = run(c, "Store.get('history')");
ok('compaction drops only details; core fields and dates kept', !hist[170].details && hist[170].condensed === true && hist[170].status === 'COMPLETED' && hist[170].date === many[170].date && hist[170].summary.completedSets === 18 && isFinite(hist[170].durationSeconds));
const both = Object.assign(JSON.parse(J(hist[0])), { metrics: { repsLogged: 999, repsSets: 9 } });
ok('reps never double-counted (details win while they exist)', run(c, `entryReps(${J(both)})`).total === 22);
ok('condensed entry uses its stored total exactly once', run(c, `entryReps(${J(hist[170])})`).total === hist[170].metrics.repsLogged && run(c, "compactHistory(Store.get('history'))") === false);
// legacy durations
c = make(NOW);
seed(c, [W('2026-10-12', { details: false, dur: 5 * 3600 }), W('2026-10-11', { details: false, dur: 2700 }), W('2026-10-10', { dur: 6 * 3600 })]);
ok('legacy >3h excluded from measured totals, kept as session+sets, never zero', run(c, "entryDuration(validHistory()[0]).kind") === 'excluded' && run(c, "entryDuration(validHistory()[0]).sec") === null && run(c, "entrySets(validHistory()[0])") === 18);
ok('legacy plausible duration kept; new measured duration kept even if long', run(c, "entryDuration(validHistory()[1]).kind") === 'legacy' && run(c, "entryDuration(validHistory()[2]).kind") === 'measured');
ok('duration total excludes only the excluded record', J(run(c, "(function(){const i=buildDayIndex();return aggregate(i,Object.keys(i),'duration').v})()")) === J(2700 / 60 + 6 * 60));
const ex = run(c, "buildProgressExport('30')");
ok('export states how many durations were excluded and why', ex.includes('1 older session(s) excluded from the duration total') && ex.includes('over the 3 h limit'));
// ordering + cap
c = make(NOW);
run(c, "Store.set('history',[]);saveHistoryEntry(" + J(W('2026-10-10')) + ");saveHistoryEntry(" + J(W('2026-10-12')) + ");saveHistoryEntry(" + J(W('2026-10-05')) + ");saveHistoryEntry(" + J(W('2026-10-12', { time: '20:00:00' })) + ')');
ok('history is newest-first by date then start time, even for out-of-order saves', run(c, "Store.get('history').map(h=>h.date+'T'+new Date(h.startedAt).getHours()).join()") === '2026-10-12T20,2026-10-12T18,2026-10-10T18,2026-10-05T18');
c = make('2030-01-01T12:00:00'); run(c, "Store.set('history',[])");
for (let i = 0; i < 1600; i++) run(c, `saveHistoryEntry(${J(W(run(c, `addDaysStr('2024-01-01',${i})`)))})`);
ok('1500-record limit keeps the newest 1500 and sorts correctly', run(c, "Store.get('history').length") === 1500 && run(c, "Store.get('history')[0].date") === run(c, "addDaysStr('2024-01-01',1599)") && run(c, "Store.get('history')[1499].date") === run(c, "addDaysStr('2024-01-01',100)"));
// backup / import validation (nothing changes before confirmation)
c = make(NOW); seed(c, [W('2026-10-12'), R('2026-10-11')]);
const snapshot = J(c.store);
const plan = (txt) => run(c, `buildImportPlan(${J(txt)})`);
ok('import rejects bad JSON / wrong app / empty object / unusable history', ['not json', J({ app: 'Other', data: {} }), J({ app: 'WorkoutApp', data: {} }), J({ app: 'WorkoutApp', data: { history: 'x' } }),
  J({ app: 'WorkoutApp', data: { history: [{ type: 'X', date: '2026-10-01', status: 'COMPLETED' }, { type: 'PUSH_A', date: '2026-02-30', status: 'COMPLETED' }] } })].every((t) => plan(t).error));
c.setField('import-input', J({ app: 'WorkoutApp', data: { history: [{ type: 'PUSH_A', date: '2026-02-30', status: 'COMPLETED' }] } }));
run(c, "state.screen='settings';state.importOpen=true;applyImport()");
ok('invalid import cannot wipe existing history', c.store.wa_history === JSON.parse(snapshot).wa_history && run(c, 'state.importPreview') === null);
const good = J({ app: 'WorkoutApp', data: { history: [W('2026-09-01'), W('2026-09-01'), R('2026-09-02'), R('2026-09-02'), { type: 'PUSH_A', date: 'bad', status: 'COMPLETED' }, { type: 'PUSH_A', date: '2026-09-03', status: 'ABANDONED' }, { type: '<b>', date: '2026-09-04', status: 'COMPLETED' }] } });
c.setField('import-input', good); run(c, "state.importOpen=true;applyImport()");
ok('valid import shows a preview and changes NOTHING yet', J(c.store) === snapshot && run(c, 'state.importPreview.report.records') === 2 && run(c, 'state.importPreview.report.skipped') === 5 && run(c, 'renderImportPreview()').includes('REPLACE MY DATA'));
run(c, 'backToImportEdit()'); ok('going back keeps data untouched', J(c.store) === snapshot);
run(c, 'applyImport()'); run(c, 'commitImport()');
ok('confirmed import replaces matching data, deduped and newest-first', run(c, "Store.get('history').map(h=>h.date).join()") === '2026-09-02,2026-09-01' && run(c, "Store.get('schemaVersion')") === (GEN_VIEW ? 6 : 5));
// backup roundtrip incl. condensed history
c = make(NOW); seed(c, many); run(c, "saveHistoryEntry(Object.assign({}, validHistory()[0], {date:'2026-10-14', startedAt: 1}))"); c.store.wa_history = J(run(c, "Store.get('history')").filter((h) => h.startedAt !== 1));
const a1 = agg(c), bk = run(c, 'buildBackup()'); let c4 = make(NOW); c4.setField('import-input', bk); run(c4, "state.screen='settings';state.importOpen=true;applyImport();commitImport()");
ok('backup/restore keeps condensed history and every metric', run(c4, "Store.get('history').length") === 200 && agg(c4) === a1);

// =====================================================================
console.log('\n== 2. CUSTOM MODIFICATIONS ==');
const DB0 = J(vm.runInContext('EXERCISE_DB', make(NOW)));
c = make(NOW);
run(c, "selectSession('PUSH_A')");
ok('existing user with no saved data gets the exact defaults', J(run(c, 'state.exerciseList.map(e=>[e.name,e.type,e.sets,e.target])')) === J(JSON.parse(DB0).PUSH_A.exercises.map((e) => [e.name, e.type, e.sets, e.target])));
const i0 = 0; // Push-ups
run(c, `openEdit(${i0})`); c.setField('edit-name', 'Push-ups'); run(c, "editStep('sets',-1)");
ok('editing opens the sheet with scope text and BOTH choices', run(c, 'renderEditSheet()').includes('APPLY TO THIS WORKOUT') && run(c, 'renderEditSheet()').includes('SAVE AS CUSTOM') && run(c, 'renderEditSheet()').includes('PUSH A only'));
run(c, 'applyEditTemp()');
ok('temporary change affects this workout only', run(c, `state.exerciseList[${i0}].sets`) === 2 && noMods(c.store));
run(c, "selectSession('PUSH_A')"); ok('temporary change is gone in the next session', run(c, `state.exerciseList[${i0}].sets`) === 3);
run(c, `openEdit(${i0})`); c.setField('edit-name', 'Push-ups'); run(c, "editStep('sets',-1);saveEditCustom()");
ok('save as custom stores only the difference for that one exercise', J(run(c, "Store.get('exerciseMods')")) === J({ 'PUSH_A|Push-ups': { sets: 2 } }));
run(c, "selectSession('PUSH_A')"); ok('saved change applies to the next workout', run(c, `state.exerciseList[${i0}].sets`) === 2 && run(c, `state.exerciseList[${i0}].persist.sets`) === 2);
ok('only the intended exercise changed', J(run(c, 'state.exerciseList.map(e=>e.sets)')) === J([2, 3, 3, 3, 4, 3, 3]));
const pushB = JSON.parse(DB0).PUSH_B.exercises.map((e) => [e.name, e.sets]);
run(c, "selectSession('PUSH_B')"); ok('same-named exercise in another session is unaffected (whole PUSH B list equals its defaults)', J(run(c, 'state.exerciseList.map(e=>[e.name,e.sets])')) === J(pushB));
const bi = run(c, "state.exerciseList.findIndex(e=>e.name==='Push-ups')");
run(c, `openEdit(${bi})`); c.setField('edit-name', 'Push-ups'); run(c, "editStep('sets',2);saveEditCustom()");
ok('saving PUSH B Push-ups (2 -> 4) leaves PUSH A Push-ups at its own saved value', J(Object.keys(run(c, "Store.get('exerciseMods')")).sort()) === J(['PUSH_A|Push-ups', 'PUSH_B|Push-ups']) && run(c, "(selectSession('PUSH_A'), state.exerciseList[0].sets)") === 2 && run(c, `(selectSession('PUSH_B'), state.exerciseList[${bi}].sets)`) === 4);
run(c, "resetBuiltinMod('PUSH_B|Push-ups')");
ok('data.js definitions are never modified', J(run(c, 'EXERCISE_DB')) === DB0);
let c2 = make(NOW, JSON.parse(J(c.store))); run(c2, "selectSession('PUSH_A')");
ok('saved modification survives a reload', run(c2, `state.exerciseList[${i0}].sets`) === 2);
// temp change on top of a saved one: flags + stays temporary
run(c2, "changeSets(0,1)"); const html = run(c2, 'renderSetup()');
ok('UI distinguishes saved (CUSTOM) from temporary (THIS WORKOUT ONLY); a single save workflow (no per-row save link)', html.includes('flag-saved') && html.includes('THIS WORKOUT ONLY') && !html.includes('saveRowCustom') && html.includes('SAVE AS MY DEFAULT'));
run(c2, "resetExerciseSets()"); ok('undo of temporary sets returns to the SAVED value, not the default', run(c2, 'state.exerciseList[0].sets') === 2);
// history untouched by later changes
c2 = make(NOW, JSON.parse(J(c.store))); const oldHist = [W('2026-10-01')]; seed(c2, oldHist); const hSnap = c2.store.wa_history;
run(c2, "selectSession('PUSH_A');openEdit(0)"); c2.setField('edit-name', 'Renamed Push-ups'); run(c2, "editStep('sets',1);editStep('sets',1);saveEditCustom()");
ok('rename + sets saved; existing history is byte-for-byte unchanged', J(run(c2, "Store.get('exerciseMods')['PUSH_A|Push-ups']")) === J({ name: 'Renamed Push-ups', sets: 4 }) && c2.store.wa_history === hSnap);
// reset single (with confirmation)
run(c2, "selectSession('PUSH_A');openEdit(0)"); run(c2, 'askResetExercise()');
ok('single reset asks for confirmation first (nothing removed yet)', run(c2, 'state.confirmAction.kind') === 'resetExercise' && !!run(c2, "Store.get('exerciseMods')['PUSH_A|Push-ups']"));
run(c2, 'cancelConfirmAction()'); ok('cancel keeps the saved modification and the sheet', !!run(c2, "Store.get('exerciseMods')['PUSH_A|Push-ups']") && run(c2, 'state.editEx') !== null);
run(c2, 'askResetExercise();confirmResetExercise()');
ok('confirmed reset removes the saved customization and restores the defaults', run(c2, "Store.get('exerciseMods')['PUSH_A|Push-ups']") === undefined && run(c2, 'state.exerciseList[0].name') === 'Push-ups' && run(c2, 'state.exerciseList[0].sets') === 3);
// default-equal values remove the entry; clashes; validation
c2 = make(NOW); run(c2, "selectSession('PUSH_A');openEdit(0)"); c2.setField('edit-name', 'Push-ups'); run(c2, "saveEditCustom()");
ok('saving values identical to the default stores nothing', J(run(c2, "Store.get('exerciseMods')")) === '{}' || run(c2, "Store.get('exerciseMods')") === null || Object.keys(run(c2, "Store.get('exerciseMods')") || {}).length === 0);
run(c2, "openEdit(0)"); c2.setField('edit-name', 'Dips'); run(c2, 'saveEditCustom()');
ok('renaming onto an existing exercise name is allowed (Phase 3A: every exercise keeps its own id)', run(c2, 'state.editEx') === null && J(run(c2, "Store.get('exerciseMods')")) === J({ 'PUSH_A|Push-ups': { name: 'Dips' } })); run(c2, "resetBuiltinMod('PUSH_A|Push-ups')");
ok('validation: sets 0/11/2.5 and bad targets rejected', [0, 11, 2.5].every((n) => !run(c2, `validateExercise({name:'A',type:'REPS',sets:${n},target:10})`).ok) && !run(c2, "validateExercise({name:'A',type:'TIME',sets:2,target:3})").ok && !run(c2, "validateExercise({name:'A',type:'REPS',sets:2,target:[12,8]})").ok && run(c2, "validateExercise({name:'A',type:'REPS',sets:2,target:[8,12]})").ok);
// ranges / time targets
run(c2, "selectSession('PUSH_A');openEdit(0)"); c2.setField('edit-name', 'Push-ups'); run(c2, "editStep('tMin',-5);editStep('tMax',-2);saveEditCustom()");
ok('rep target range saved (min<max) and applied', J(run(c2, "Store.get('exerciseMods')['PUSH_A|Push-ups'].target")) === '[10,13]');
run(c2, "selectSession('PUSH_A')"); ok('range shows in the workout', run(c2, 'targetLabel(state.exerciseList[0])') === '10\u201313 REPS');
// orphan handling + migration + reset all
c2 = make(NOW, { wa_exerciseMods: J({ 'GONE_A|Old': { sets: 2 }, 'PUSH_A|No Such Exercise': { sets: 5 }, 'PUSH_A|Dips': { sets: 4 } }) });
run(c2, "selectSession('PUSH_A')"); ok('mods for removed/renamed exercises are ignored safely', J(run(c2, 'state.exerciseList.map(e=>e.sets)')) === J([3, 3, 3, 3, 4, 3, 4]));
run(c2, "openEdit(0)"); c2.setField('edit-name', 'Push-ups'); run(c2, "editStep('sets',1);saveEditCustom()");
ok('unrelated saves do not delete orphaned data', !!run(c2, "Store.get('exerciseMods')['GONE_A|Old']") && !!run(c2, "Store.get('exerciseMods')['PUSH_A|No Such Exercise']"));
run(c2, 'goCustomMods()'); const mh = run(c2, 'renderCustomMods()');
ok('hub: customized card shows original -> custom values, CUSTOM badge, scoped to the selected session, orphan note', /<s>3<\/s><i>\u2192<\/i><b>4<\/b>/.test(mh) && mh.includes('PUSH A') && mh.includes('flag-saved') && mh.includes('mod-card is-custom') && mh.includes('no longer exist') && balanced(mh));
run(c2, 'askResetAllMods()'); ok('reset-all asks for confirmation first', Object.keys(run(c2, "Store.get('exerciseMods')")).length === 4 && run(c2, 'renderConfirmOverlay(state.confirmAction)').includes('RESET ALL MODIFICATIONS?'));
run(c2, 'confirmResetAllMods()'); ok('confirmed reset-all restores every default', J(run(c2, "Store.get('exerciseMods')")) === '{}' && J(run(c2, "(selectSession('PUSH_A'), state.exerciseList.map(e=>e.sets))")) === J([3, 3, 3, 3, 4, 3, 3]));
ok('hub: polished empty state with actions when the session has no customizations', run(c2, 'renderCustomMods()').includes('NO CUSTOMIZATIONS FOR PUSH A') && run(c2, 'renderCustomMods()').includes('hubOpenWorkout()') && run(c2, 'renderCustomMods()').includes('hubAdd()'));
// legacy REPLACE feature migration
c2 = make(NOW, { wa_schemaVersion: '3', wa_exerciseSwaps: J({ PUSH_A: { 'Wide Push-ups': { name: 'Diamond Push-ups' }, Nope: { name: 'x' } }, GONE: { a: { name: 'b' } } }) }); run(c2, 'init()');
run(c2, "selectSession('PUSH_A')"); ok('old renamed exercises (REPLACE) are migrated into custom modifications', J(run(c2, "Store.get('exerciseMods')")) === J({ 'PUSH_A|Wide Push-ups': { name: 'Diamond Push-ups' } }) && names(c2).includes('Diamond Push-ups') && c2.store.wa_exerciseSwaps !== undefined);
// =====================================================================
console.log('\n== 3. ADDED EXERCISES (no hard limit since phase 3A) ==');
c = make(NOW); run(c, "selectSession('PUSH_A')");
const addUI = (name, type) => { run(c, 'openAdd()'); if (run(c, 'state.editEx') === null) return false; c.setField('edit-name', name); if (type) run(c, `editSetType('${type}')`); run(c, 'saveEditCustom()'); return run(c, 'state.editEx') === null; };
ok('the exercise count is shown without a limit', run(c, 'state.exerciseList.length') === 7 && !run(c, 'renderSetup()').includes('7/10') && run(c, 'renderSetup()').includes('<b>7</b>'));
ok('can add 3 (7 built-in + 3 = 10)', addUI('Pike Push-ups') && addUI('Hollow Hold', 'TIME') && addUI('Burpees', 'MAX') && run(c, 'state.exerciseList.length') === 10);
ok('added exercises are flagged and keep their type/target rules', run(c, 'state.exerciseList[8].type') === 'TIME' && run(c, 'targetLabel(state.exerciseList[8])') === '01:00' && run(c, 'renderSetup()').includes('flag-added'));
let h10 = run(c, 'renderSetup()'); ok('at 10: Add stays enabled and a non-blocking notice is shown', !/add-exercise" disabled/.test(h10) && h10.includes('This workout has 10 exercises') && h10.includes('<b>10</b>'));
run(c, 'openAdd()'); ok('the add sheet still opens at 10', run(c, 'state.editEx') !== null); run(c, 'closeEdit()');
const cn = make(NOW); run(cn, "selectSession('PUSH_A')"); for (let i = 0; i < 15; i++) run(cn, `addCustomExercise('PUSH_A',{name:'Extra ${i}',type:'REPS',sets:3,target:10})`); run(cn, "selectSession('PUSH_A')");
ok('there is no hard limit: 15 added exercises are all accepted, stored and used', run(cn, "getCustoms('PUSH_A').length") === 15 && run(cn, "exerciseCount('PUSH_A')") === 22 && run(cn, 'state.exerciseList.length') === 22 && run(cn, 'renderSetup()').includes('This workout has 22 exercises'));
run(cn, "addCustomExercise('PUSH_A',{name:'Dips',type:'REPS',sets:3,target:10})"); run(cn, "selectSession('PUSH_A')");
ok('an added exercise may reuse a built-in name; ids stay independent', names(cn).filter((n) => n === 'Dips').length === 2 && new Set(run(cn, 'state.exerciseList.map(e=>e.id)')).size === run(cn, 'state.exerciseList.length'));
const raw12 = []; for (let i = 0; i < 12; i++) raw12.push({ id: 'u_x' + i, name: 'E' + i, type: 'REPS', sets: 3, target: 10 });
ok('stored data with more than 10 added exercises is read in full (nothing is hidden)', run(make(NOW, { wa_customExercises: J({ PUSH_A: raw12 }) }), "exerciseCount('PUSH_A')") === 19);
// rapid double submit
let cr = make(NOW); run(cr, "selectSession('PUSH_A');openAdd()"); cr.setField('edit-name', 'Rapid'); run(cr, 'saveEditCustom();saveEditCustom();saveEditCustom()');
ok('rapid repeated submissions add exactly one exercise', run(cr, "getCustoms('PUSH_A').length") === 1 && run(cr, 'state.exerciseList.length') === 8);
const idDup = run(cr, "getCustoms('PUSH_A')[0].id"); ok('the same submission id is rejected as a duplicate', run(cr, `addCustomExercise('PUSH_A',{id:'${idDup}',name:'Other',type:'REPS',sets:3,target:10})`).error === 'DUPLICATE');
ok('duplicate names are accepted and get independent ids', run(cr, "addCustomExercise('PUSH_A',{name:'rapid',type:'REPS',sets:3,target:10})").ok === true && run(cr, "addCustomExercise('PUSH_A',{name:'dips',type:'REPS',sets:3,target:10})").ok === true && new Set(run(cr, "getCustoms('PUSH_A').map(c=>c.id)")).size === 3);
ok('invalid data is rejected before saving', ['{name:"",type:"REPS",sets:3,target:10}', '{name:"A",type:"BAD",sets:3,target:10}', '{name:"A",type:"TIME",sets:3,target:1}', '{name:"A",type:"REPS",sets:99,target:10}', '{name:"A",type:"REPS",sets:3,target:0}'].every((d) => run(cr, `addCustomExercise('PUSH_A',${d})`).ok === false));
// remove frees a slot + persistence
run(c, "openEdit(9)"); run(c, 'askRemoveExercise()'); ok('remove asks for confirmation', run(c, 'state.confirmAction.kind') === 'removeExercise' && run(c, "getCustoms('PUSH_A').length") === 3);
run(c, 'confirmRemoveExercise()'); ok('removing an added exercise frees a slot', run(c, "getCustoms('PUSH_A').length") === 2 && run(c, 'state.exerciseList.length') === 9);
ok('a new exercise can then be added', addUI('Archer Rows') && run(c, 'state.exerciseList.length') === 10);
c2 = make(NOW, JSON.parse(J(c.store))); run(c2, "selectSession('PUSH_A')");
ok('added exercises persist across a reload (after the built-ins, no duplicates)', run(c2, 'state.exerciseList.length') === 10 && J(names(c2).slice(7)) === J(['Pike Push-ups', 'Hollow Hold', 'Archer Rows']) && new Set(run(c2, 'state.exerciseList.map(e=>e.id)')).size === 10);
// separation + interaction with mods
run(c2, "openEdit(7)"); c2.setField('edit-name', 'Pike Push-ups'); run(c2, "editStep('sets',1);saveEditCustom()"); run(c2, "openEdit(0)"); c2.setField('edit-name', 'Push-ups'); run(c2, "editStep('sets',-1);saveEditCustom()");
ok('mods and added exercises are stored separately and do not overwrite each other', Object.keys(run(c2, "Store.get('exerciseMods')")).join() === 'PUSH_A|Push-ups' && run(c2, "getCustoms('PUSH_A')[0].sets") === 4);
const c3 = make(NOW, JSON.parse(J(c2.store))); run(c3, "selectSession('PUSH_A')");
ok('both are applied together after a reload', run(c3, 'state.exerciseList[0].sets') === 2 && run(c3, 'state.exerciseList[7].sets') === 4 && run(c3, 'state.exerciseList.length') === 10);
ok('limits are per session', run(c3, "selectSession('PULL_A'), state.exerciseList.length") === run(c3, "EXERCISE_DB.PULL_A.exercises.length"));
ok('home card shows the effective exercise count', run(c3, "sessionMeta('PUSH_A').sub") === '10 EXERCISES');
// backup restore of both stores, no duplication
const bk2 = run(c3, 'buildBackup()'); const c5 = make(NOW); c5.setField('import-input', bk2);
run(c5, "state.screen='settings';state.importOpen=true;applyImport();commitImport()"); c5.setField('import-input', bk2); run(c5, "state.importOpen=true;applyImport();commitImport()");
ok('backup restore (twice) brings back mods + added exercises without duplicating', run(c5, "getCustoms('PUSH_A').length") === 3 && Object.keys(run(c5, "Store.get('exerciseMods')")).length === 1);
// editing/removing an added exercise leaves history alone; manager screen
run(c3, "goCustomMods()"); const mh2 = run(c3, 'renderCustomMods()');
ok('hub shows added (ADDED, dashed) and customized (CUSTOM) cards distinctly, balanced markup', mh2.includes('flag-added') && mh2.includes('mod-card is-added') && mh2.includes('Pike Push-ups') && /<s>3<\/s><i>\u2192<\/i><b>2<\/b>/.test(mh2) && mh2.includes('mod-card is-custom') && balanced(mh2));
run(c3, "openEditManager('PUSH_A','u',getCustoms('PUSH_A')[0].id)"); c3.setField('edit-name', 'Pike Push-ups'); run(c3, "editStep('sets',-1);saveEditCustom()");
ok('editing an added exercise from the manager saves it', run(c3, "getCustoms('PUSH_A')[0].sets") === 3);

// =====================================================================
console.log('\n== 4. WORKOUT FLOW / HISTORY / PROGRESS (regression) ==');
c = make('2026-10-13T21:20:00'); run(c, "selectSession('PUSH_A')");
run(c, "openEdit(0)"); c.setField('edit-name', 'Push-ups'); run(c, "editStep('sets',-1);saveEditCustom()"); run(c, "openAdd()"); c.setField('edit-name', 'Pike Push-ups'); run(c, 'saveEditCustom()');
run(c, "changeSets(1,-1)"); // a temporary change on top
run(c, 'startWorkoutFlow()'); ok('workout starts with saved + added + temporary values', run(c, 'state.exerciseList.length') === 8 && run(c, 'state.exerciseList[0].sets') === 2 && run(c, 'state.exerciseList[1].sets') === 2 && run(c, "Store.get('activeSession').exerciseList.length") === 8);
run(c, "state.exerciseList.forEach((ex,i)=>{for(let s=1;s<=ex.sets;s++){state.curExerciseIdx=i;state.curSet=s;recordResult('completed',10+s)}})");
const last = run(c, 'state.exerciseList.length') - 1; run(c, `state.curExerciseIdx=${last};state.curSet=currentExercise().sets;state.screen='active';state.subState='repsInput'`); c.setField('actual-input', '9'); run(c, 'saveActualReps()');
ok('last set goes straight to the completion screen', run(c, 'state.screen') === 'complete' && run(c, 'state.subState') !== 'rest');
const entry = run(c, "Store.get('history')[0]");
ok('history stores the settings actually used (incl. stable ids, added flag)', entry.details.exercises.length === 8 && entry.details.exercises[0].sets === 2 && entry.details.exercises[7].custom === true && entry.details.exercises[7].id.startsWith('u_') && entry.details.exercises[0].id === 'PUSH_A|Push-ups');
ok('completion summary counts the added exercise and copy still works', run(c, 'state.lastSummary.totalExercises') === 8 && run(c, 'renderComplete()').includes('COPY SUMMARY') && run(c, 'entryToText(state.lastEntry)').includes('Pike Push-ups'));
const hAfter = c.store.wa_history; run(c, "selectSession('PUSH_A');openEdit(0)"); c.setField('edit-name', 'Push-ups'); run(c, "editStep('sets',2);saveEditCustom()");
ok('changing an exercise later does not rewrite the finished session', c.store.wa_history === hAfter && run(c, "Store.get('history')[0].details.exercises[0].sets") === 2);
run(c, "goProgress()"); ok('progress, calendar and export include the session', balanced(run(c, 'renderProgress()')) && run(c, "buildProgressExport('30')").includes('Pike Push-ups') && run(c, 'computeStreak().current') === 1);
run(c, "goHistoryDate('2026-10-13')"); ok('calendar date opens the matching history entry', run(c, 'renderHistory()').includes('history-row is-focus') && run(c, 'renderHistory()').includes('id="hist-focus"'));
run(c, "goProgress();selectProgressDay('2026-10-13')"); ok('day details link to history', run(c, 'renderProgress()').includes("goHistoryDate('2026-10-13')"));
// missing-data explanations
run(c, "setProgressMetric('reps');setProgressRange('weekly')"); c2 = make(NOW); seed(c2, [W('2026-10-12', { details: false })]); run(c2, "goProgress();setProgressMetric('reps')");
ok('chart explains unavailable metrics and empty periods', run(c2, 'renderProgress()').includes('has no reps data') && make(NOW) && (run(c2, "setProgressRange('monthly');setProgressMetric('sessions');state.progress.month='2026-10';1"), true));
c2 = make(NOW); run(c2, 'goProgress()'); ok('empty history says "unknown, not zero"', run(c2, 'renderProgress()').includes('Empty means unknown, not zero'));
// CSS sanity: new styles use theme variables only (no hard-coded colors) so every accent theme works
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'); const tail = css.slice(css.indexOf('Custom modifications, edit sheet'));
ok('new CSS uses theme variables only (no hard-coded hex colors)', !/#[0-9a-fA-F]{3,8}\b/.test(tail));
ok('new sheets fit narrow phones (max-width/percent widths, scrollable)', /\.overlay-card\.sheet\s*\{[^}]*width: 88%[^}]*max-height: 88vh[^}]*overflow-y: auto/.test(tail));

// =====================================================================
console.log('\n== 5. STREAK RULES / CALENDAR / PROGRESS (regression) ==');
c = make(NOW);
const cur = (today) => { const s = streak(c, today); return J([s.current, s.state, s.best, s.lastVerified && s.lastVerified.end]); };
seed(c, [W('2026-10-11'), W('2026-10-12'), W('2026-10-13')]); ok('workout-workout-workout', cur('2026-10-13') === '[3,"recorded-today",3,null]');
seed(c, [W('2026-10-11'), R('2026-10-12'), W('2026-10-13')]); ok('workout-rest-workout keeps continuity', cur('2026-10-13') === '[3,"recorded-today",3,null]');
seed(c, [W('2026-10-11'), W('2026-10-13')]); ok('workout-UNKNOWN-workout: continuity cannot be verified across the unknown day', cur('2026-10-13') === '[1,"recorded-today",1,null]');
seed(c, [R('2026-10-13')]); ok('planned rest alone never creates a streak', cur('2026-10-13') === '[0,"none",0,null]');
seed(c, [W('2026-10-10'), R('2026-10-11'), R('2026-10-12')]); ok('workout + consecutive rests, today not recorded yet: still current (pending)', cur('2026-10-13') === '[3,"today-pending",3,null]');
seed(c, [W('2026-10-09'), R('2026-10-10'), R('2026-10-11'), R('2026-10-12'), R('2026-10-13')]); ok('consecutive planned rests do not cut the streak', cur('2026-10-13') === '[5,"recorded-today",5,null]');
seed(c, [W('2026-10-09'), R('2026-10-10'), R('2026-10-11')]); ok('ended before yesterday: Current 0, Last Verified reported separately with its end date', cur('2026-10-13') === '[0,"none",3,"2026-10-11"]');
seed(c, [W('2026-10-08'), W('2026-10-09'), R('2026-10-12'), R('2026-10-13')]); ok('rest-only run after an unknown day starts no streak', cur('2026-10-13') === '[0,"none",2,"2026-10-09"]');
seed(c, [W('2026-10-12', { time: '07:00:00' }), W('2026-10-12', { time: '19:00:00' }), W('2026-10-13')]); ok('several sessions on one date = one streak day', streak(c, '2026-10-13').current === 2);
seed(c, [W('2026-12-30'), R('2026-12-31'), W('2027-01-01')]); ok('year boundary', cur('2027-01-01') === '[3,"recorded-today",3,null]');
seed(c, [W('2028-02-28'), W('2028-02-29'), W('2028-03-01')]); ok('leap day', streak(c, '2028-03-01').current === 3);
seed(c, [W('2027-02-28'), W('2027-03-01')]); ok('non-leap Feb 28 to Mar 1', streak(c, '2027-03-01').current === 2);
for (const [month, n] of [['2027-02', 28], ['2028-02', 29], ['2026-04', 30], ['2026-10', 31]]) {
  const cc = make(month + '-28T12:00:00'); cc.setNow(month + '-' + n + 'T12:00:00'); run(cc, `goProgress();state.progress.month='${month}'`);
  const html = run(cc, 'renderProgress()'), [y, m] = month.split('-').map(Number), off = (new Date(y, m - 1, 1).getDay() - 6 + 7) % 7;
  ok('calendar ' + month + ': ' + n + ' days, Saturday-first offset ' + off, (html.match(/class="cal-cell/g) || []).length === n && (html.match(/class="cal-blank"/g) || []).length === off);
}
c = make(NOW); seed(c, [W('2026-10-09'), W('2026-10-10'), R('2026-10-11')]); run(c, "goProgress();setProgressRange('weekly');setProgressMetric('sessions')");
const bars = run(c, "buildBars(buildDayIndex(),state.progress,'2026-10-13')");
ok('weeks start on Saturday (Friday and Saturday fall in different weeks)', bars[11].full.startsWith('WEEK 2026-10-10') && bars[10].full.startsWith('WEEK 2026-10-03') && bars[10].agg.v === 1 && bars[11].agg.v === 1);
ok('a week with no records is an unknown gap, not zero; coverage counts elapsed days only', bars[0].agg.kind === 'unknown' && bars[11].agg.total === 4 && bars[11].agg.recorded === 2);
run(c, "setProgressRange('daily')"); const db = run(c, "buildBars(buildDayIndex(),state.progress,'2026-10-13')");
ok('daily: workout = value, rest = recorded zero, unrecorded past day = unknown, future = nothing', [db[8], db[10], db[11], db[20]].map((b) => b.agg.kind).join() === 'value,zero,unknown,future');
const titles = ['duration', 'sessions', 'sets', 'reps'].map((m) => run(c, `setProgressMetric('${m}');renderProgress()`).match(/class="p-title">([^<]*DAILY[^<]*)</)[1]);
ok('switching the metric updates the graph title and unit', titles[0].includes('DURATION \u00b7 MIN') && titles[1].includes('SESSIONS \u00b7 SESSIONS') && titles[2].includes('SETS \u00b7 SETS') && titles[3].includes('REPS \u00b7 REPS'));
run(c, "selectProgressBar(11)"); ok('inspecting an unknown day says unknown, not zero', run(c, 'renderProgress()').includes('Unknown, not counted as zero'));
run(c, "selectProgressBar(10)"); ok('inspecting a rest day says recorded zero', run(c, 'renderProgress()').includes('recorded zero'));
const exp = run(c, "buildProgressExport('30')");
ok('range export has definitions, daily statuses, totals, limitations', ['DEFINITIONS', 'REST (planned, explicitly recorded)', 'UNKNOWN', 'TOTALS FOR THE PERIOD', 'LIMITATIONS'].every((x) => exp.includes(x)));
run(c, "goProgress();copyProgressExport()"); ok('range copy puts the text on the clipboard', c.copied.length === 1 && c.copied[0].startsWith('WORKOUT TRAINING LOG'));
seed(c, [W('2026-10-10'), R('2026-10-11')]); const cReload = make(NOW, JSON.parse(J(c.store)));
ok('everything derived is identical after a reload', J(streak(c, '2026-10-13')) === J(streak(cReload, '2026-10-13')) && agg(c) === agg(cReload));

// =====================================================================
console.log('\n== 6. QUICK SETUP / CUSTOMIZATION HUB / SESSION DEFAULTS ==');
const setsOf = (x) => run(x, 'state.exerciseList.map(e=>e.sets)');
const DEF_SETS = [3, 3, 3, 3, 4, 3, 3];
let qm = make(NOW); run(qm, "selectSession('PUSH_A')");
let qsHtml = run(qm, 'renderQuickSetup()');
ok('Quick Setup: fresh session selects DEFAULT; CUSTOM stays locked until something is saved (and the caption says how to unlock it)', run(qm, 'currentPreset()') === 'default' && /class="seg active"\s+onclick="applyPreset\('default'\)"/.test(qsHtml) && qsHtml.includes("disabled onclick=\"applyPreset('custom')\"") && qsHtml.includes('Edit an exercise, then save it as your default'));
ok('Quick Setup: UNDO / SAVE only appear when there is something to undo or save (no disabled clutter)', !qsHtml.includes('qs-actions') && !qsHtml.includes('saveSessionDefault()') && !qsHtml.includes('undoTemporary()') && (run(qm, "changeSets(0,1)"), run(qm, 'renderQuickSetup()')).includes('saveSessionDefault()') && run(qm, 'renderQuickSetup()').includes('undoTemporary()') && (run(qm, 'undoTemporary()'), !run(qm, 'renderQuickSetup()').includes('qs-actions')));
let qBefore = JSON.stringify(qm.store);
run(qm, "applyPreset('light')");
ok('LIGHT: every exercise gets 2 sets, LIGHT segment active, chip says TEMPORARY', J(setsOf(qm)) === J([2, 2, 2, 2, 2, 2, 2]) && run(qm, 'currentPreset()') === 'light' && /class="seg active"\s+onclick="applyPreset\('light'\)"/.test(run(qm, 'renderQuickSetup()')) && run(qm, 'renderQuickSetup()').includes('qs-status is-temp">TEMPORARY'));
run(qm, "applyPreset('standard')");
ok('STANDARD: every exercise gets 3 sets', J(setsOf(qm)) === J([3, 3, 3, 3, 3, 3, 3]) && run(qm, 'currentPreset()') === 'standard');
ok('presets are temporary: nothing is written to storage', JSON.stringify(qm.store) === qBefore);
run(qm, "applyPreset('default')"); ok('DEFAULT restores the original built-in values', J(setsOf(qm)) === J(DEF_SETS) && run(qm, 'currentPreset()') === 'default');
ok('EXERCISE_DB is never mutated by presets', J(run(qm, 'EXERCISE_DB')) === DB0);
// manual edits after a preset
run(qm, "applyPreset('light');changeSets(0,1)");
qsHtml = run(qm, 'renderQuickSetup()');
ok('manual edit after a preset: no preset stays selected, UI says MANUALLY ADJUSTED', run(qm, 'currentPreset()') === null && qsHtml.includes('MANUALLY ADJUSTED') && qsHtml.includes('is-manual') && !/class="seg active"/.test(qsHtml));
run(qm, "changeSets(0,-1);applyPreset('light');openEdit(2)"); qm.setField('edit-name', run(qm, 'state.exerciseList[2].name')); run(qm, "editStep('sets',1);applyEditTemp()");
ok('an "Apply to this workout" edit also marks the setup as manually adjusted', run(qm, 'currentPreset()') === null);
run(qm, "applyPreset('light');for(let i=0;i<7;i++)changeSets(i,1)");
ok('manual edits that happen to equal a preset are reported as that preset', run(qm, 'currentPreset()') === 'standard');
run(qm, "applyPreset('light');changeSets(0,1)"); run(qm, 'undoTemporary()');
ok('UNDO CHANGES returns to the saved setup (defaults when nothing is saved) and writes nothing', J(setsOf(qm)) === J(DEF_SETS) && run(qm, 'currentPreset()') === 'default' && JSON.stringify(qm.store) === qBefore && qm.toasts.includes('TEMPORARY CHANGES UNDONE'));
// presets alongside saved modifications and added exercises
let hm = make(NOW); run(hm, "selectSession('PUSH_A');openEdit(0)"); hm.setField('edit-name', 'Push-ups'); run(hm, "editStep('sets',-1);saveEditCustom()");
run(hm, "openAdd()"); hm.setField('edit-name', 'Pike Push-ups'); run(hm, "editStep('sets',1);saveEditCustom()");
const histKeep = J([W('2026-10-01')]); seed(hm, JSON.parse(histKeep)); const histSnap = hm.store.wa_history;
run(hm, "selectSession('PUSH_A')");
ok('with saved changes, the session opens on CUSTOM with the saved values (not a blanket number)', run(hm, 'currentPreset()') === 'custom' && J(setsOf(hm)) === J([2, 3, 3, 3, 4, 3, 3, 4]) && run(hm, 'savedModCount()') === 1);
const stSnap = JSON.stringify(hm.store);
run(hm, "applyPreset('standard')"); ok('STANDARD over saved changes is temporary: saved data untouched, added exercise included', J(setsOf(hm)) === J([3, 3, 3, 3, 3, 3, 3, 3]) && JSON.stringify(hm.store) === stSnap);
run(hm, "applyPreset('custom')"); ok('CUSTOM uses the saved personal settings, not a uniform set count', J(setsOf(hm)) === J([2, 3, 3, 3, 4, 3, 3, 4]) && run(hm, 'currentPreset()') === 'custom');
run(hm, "applyPreset('default')"); ok('DEFAULT: original built-in values, the added exercise is preserved (not deleted) with its saved settings', J(setsOf(hm)) === J([3, 3, 3, 3, 4, 3, 3, 4]) && run(hm, 'state.exerciseList.length') === 8 && run(hm, "state.exerciseList[7].name") === 'Pike Push-ups' && JSON.stringify(hm.store) === stSnap);
// explicit "Save as my default" for ONE session
let dm = make(NOW); seed(dm, JSON.parse(histKeep)); const dHist = dm.store.wa_history; run(dm, "selectSession('PUSH_A');applyPreset('light')"); const dBefore = JSON.stringify(dm.store);
ok('choosing a preset never saves anything by itself', JSON.stringify(dm.store) === dBefore && noMods(dm.store));
run(dm, 'saveSessionDefault()');
const modsAfter = run(dm, "Store.get('exerciseMods')");
ok('Save as My Default stores the whole current setup for this session only (via the existing exerciseMods store)', Object.keys(modsAfter).length === 7 && Object.keys(modsAfter).every((k) => k.indexOf('PUSH_A|') === 0) && Object.values(modsAfter).every((m) => m.sets === 2));
ok('after saving: feedback shown, nothing pending, CUSTOM selected', dm.toasts.some((x) => x.indexOf('SAVED AS MY DEFAULT') === 0) && run(dm, 'hasTempChanges()') === false && run(dm, 'currentPreset()') === 'custom');
ok('other sessions and history are untouched', run(dm, "(selectSession('PUSH_B'), state.exerciseList.map(e=>e.sets))").join() === JSON.parse(DB0).PUSH_B.exercises.map((e) => e.sets).join() && dm.store.wa_history === dHist);
const dReload = make(NOW, JSON.parse(J(dm.store))); run(dReload, "selectSession('PUSH_A')");
ok('saved session default survives a reload and opens on CUSTOM', J(setsOf(dReload)) === J([2, 2, 2, 2, 2, 2, 2]) && run(dReload, 'currentPreset()') === 'custom');
run(dReload, "applyPreset('default')"); ok('DEFAULT still restores the originals over a saved session default', J(setsOf(dReload)) === J(DEF_SETS));
const rBefore = JSON.stringify(dReload.store); run(dReload, "applyPreset('custom');saveSessionDefault()"); ok('saving when nothing changed is a no-op with a message', JSON.stringify(dReload.store) === rBefore && dReload.toasts.includes('NOTHING NEW TO SAVE'));
run(dReload, "applyPreset('default');saveSessionDefault()"); ok('saving the DEFAULT setup removes that session\'s saved changes (explicit choice)', Object.keys(run(dReload, "Store.get('exerciseMods')")).filter((k) => k.indexOf('PUSH_A|') === 0).length === 0);
// atomic: invalid setups never write
let am2 = make(NOW); run(am2, "selectSession('PUSH_A');changeSets(0,1);state.exerciseList[1].sets=99"); const am2b = JSON.stringify(am2.store); run(am2, 'saveSessionDefault()');
ok('save is all-or-nothing: an invalid setup is rejected and nothing is written', JSON.stringify(am2.store) === am2b && am2.toasts.length > 0);
// added exercises included in the session save
let am3 = make(NOW); run(am3, "selectSession('PUSH_A');openAdd()"); am3.setField('edit-name', 'Hollow Hold'); run(am3, "saveEditCustom();applyPreset('light');saveSessionDefault()");
ok('Save as My Default also updates added exercises', run(am3, "getCustoms('PUSH_A')[0].sets") === 2 && run(am3, "getCustoms('PUSH_A').length") === 1);
// per-session reset + reset all stay separate; added exercises are kept
let rm = make(NOW); run(rm, "selectSession('PUSH_A');applyPreset('light');saveSessionDefault();openAdd()"); rm.setField('edit-name', 'Hollow Hold'); run(rm, "saveEditCustom();selectSession('PUSH_B');applyPreset('standard');saveSessionDefault()");
run(rm, "goCustomMods();hubSelect('PUSH_A');askResetSession()"); const rsHtml = run(rm, 'renderConfirmOverlay(state.confirmAction)'); const rsStore = JSON.stringify(rm.store);
ok('reset session asks for confirmation (names the session) and changes nothing yet', rsHtml.includes('RESET PUSH A?') && rsHtml.includes('Exercises you added are kept') && JSON.stringify(rm.store) === rsStore);
run(rm, 'cancelConfirmAction()'); ok('cancel leaves everything as it was', JSON.stringify(rm.store) === rsStore);
run(rm, 'askResetSession();confirmResetSession()');
const keysLeft = Object.keys(run(rm, "Store.get('exerciseMods')"));
ok('confirmed session reset removes only that session\'s built-in changes; other session and added exercises stay', keysLeft.length > 0 && keysLeft.every((k) => k.indexOf('PUSH_B|') === 0) && run(rm, "getCustoms('PUSH_A').length") === 1);
run(rm, 'askResetAllMods()'); ok('Reset All is separate, asks first, and also keeps added exercises', run(rm, 'renderConfirmOverlay(state.confirmAction)').includes('RESET ALL MODIFICATIONS?') && Object.keys(run(rm, "Store.get('exerciseMods')")).length > 0);
run(rm, 'confirmResetAllMods()'); ok('confirmed Reset All clears every session\'s changes, added exercises remain', Object.keys(run(rm, "Store.get('exerciseMods')")).length === 0 && run(rm, "getCustoms('PUSH_A').length") === 1);
// hubHtml structure
let um = make(NOW); run(um, "selectSession('PUSH_A');openEdit(0)"); um.setField('edit-name', 'Push-ups'); run(um, "editStep('sets',-1);saveEditCustom();openAdd()"); um.setField('edit-name', 'Hollow Hold'); run(um, 'saveEditCustom()'); run(um, 'goCustomMods()');
let hubHtml = run(um, 'renderCustomMods()');
ok('hub opens on the first session that has customizations, with per-session counts on the tabs', run(um, 'state.hub.session') === 'PUSH_A' && /hub-tab is-active has-custom"[^>]*><b>PUSH A<\/b><span>1 MOD \u00b7 1 ADDED<\/span>/.test(hubHtml) && /<b>PUSH B<\/b><span>DEFAULT<\/span>/.test(hubHtml));
ok('hub uses the project\'s real session labels (6 tabs, no Rest)', (hubHtml.match(/class="hub-tab[ "]/g) || []).length === 6 && hubHtml.includes('<b>LEGS B</b>') && hubHtml.includes('LEGS B + CORE') === false && hubHtml.includes('<div class="hub-title">PUSH A</div>'));
ok('hub shows the session summary and filters with counts', hubHtml.includes('8 exercises') && hubHtml.includes('1 modified') && hubHtml.includes('1 added') && hubHtml.includes("hubFilter('modified')") && hubHtml.includes('MODIFIED 1') && hubHtml.includes('ADDED 1') && hubHtml.includes('ALL 8'));
ok('built-in modified, unmodified and added cards are visually distinct', hubHtml.includes('mod-card is-custom') && hubHtml.includes('mod-card is-default') && hubHtml.includes('mod-card is-added') && hubHtml.includes('askResetMod(') && hubHtml.includes('askRemoveCustom('));
run(um, "hubFilter('modified')"); hubHtml = run(um, 'renderCustomMods()'); ok('filter MODIFIED shows only modified built-ins', hubHtml.includes('mod-card is-custom') && !hubHtml.includes('is-default') && !hubHtml.includes('is-added'));
run(um, "hubFilter('added')"); hubHtml = run(um, 'renderCustomMods()'); ok('filter ADDED shows only added exercises', hubHtml.includes('mod-card is-added') && !hubHtml.includes('is-custom') && !hubHtml.includes('is-default'));
run(um, "hubSelect('PUSH_B')"); hubHtml = run(um, 'renderCustomMods()');
ok('a session with no customizations shows a purposeful empty state (open setup / add) and its default exercises', hubHtml.includes('NO CUSTOMIZATIONS FOR PUSH B') && hubHtml.includes('hubOpenWorkout()') && hubHtml.includes('hubAdd()') && (hubHtml.match(/mod-card is-default/g) || []).length === 7 && !hubHtml.includes('hubFilter('));
let oneAdded = make(NOW); run(oneAdded, "selectSession('PUSH_A');openAdd()"); oneAdded.setField('edit-name', 'Hollow Hold'); run(oneAdded, "saveEditCustom();goCustomMods();hubFilter('modified')");
hubHtml = run(oneAdded, 'renderCustomMods()'); ok('empty MODIFIED filter explains itself and offers SHOW ALL', hubHtml.includes('NO MODIFIED EXERCISES') && hubHtml.includes("hubFilter('all')"));
run(um, "hubSelect('PUSH_B');hubOpenWorkout()"); ok('OPEN SETUP from the hub starts that session\'s workout setup', run(um, 'state.screen') === 'setup' && run(um, 'state.sessionKey') === 'PUSH_B');
// editing from the hubHtml, limits, sht info
run(um, "goCustomMods();hubSelect('PUSH_A');openEditManager('PUSH_A','b',0)"); let sht = run(um, 'renderEditSheet()');
ok('edit sheet shows ORIGINAL vs SAVED values and per-field defaults', sht.includes('ORIGINAL') && sht.includes('SAVED') && sht.includes('DEFAULT 3') && sht.includes('>2<') === false || (sht.includes('3 SETS') && sht.includes('2 SETS')));
run(um, 'closeEdit();hubAdd()'); sht = run(um, 'renderEditSheet()'); ok('adding from the hub uses the real count in its scope text (shows 8 exercises)', run(um, 'state.editEx.ctx') === 'manager' && sht.includes('8 exercises in this workout'));
um.setField('edit-name', 'Archer Rows'); run(um, 'saveEditCustom()'); um.setField('edit-name', ''); ok('hub add saves exactly one exercise (no working list involved)', run(um, "getCustoms('PUSH_A').length") === 2 && run(um, 'state.editEx') === null);
run(um, 'hubAdd()'); um.setField('edit-name', 'Dragon Flag'); run(um, 'saveEditCustom()'); ok('10/10 reached from the hub', run(um, "exerciseCount('PUSH_A')") === 10);
const t10html = run(um, 'renderCustomMods()'); run(um, 'hubAdd()');
ok('at 10 the hub ADD stays enabled and opens the sheet (no limit)', !/class="swap-btn" disabled/.test(t10html) && run(um, 'state.editEx') !== null); run(um, 'closeEdit()');
run(um, "selectSession('PUSH_A');applyPreset('light');applyPreset('default')"); ok('presets never change the number of exercises (limit unaffected)', run(um, 'state.exerciseList.length') === 10 && run(um, "exerciseCount('PUSH_A')") === 10);
// backup + import still carry everything the hubHtml/presets use
const bkU = run(um, 'buildBackup()'); const um2 = make(NOW); um2.setField('import-input', bkU); run(um2, "state.screen='settings';state.importOpen=true;applyImport();commitImport();selectSession('PUSH_A')");
ok('export/import round-trips saved defaults and added exercises (limit still 10)', run(um2, 'state.exerciseList.length') === 10 && run(um2, 'savedModCount()') === 1 && run(um2, 'currentPreset()') === 'custom');
ok('EXERCISE_DB is still untouched after all hub/preset operations', J(run(um, 'EXERCISE_DB')) === DB0 && J(run(dm, 'EXERCISE_DB')) === DB0 && J(run(rm, 'EXERCISE_DB')) === DB0);
ok('history entries are unchanged by presets, session saves and resets', hm.store.wa_history === histSnap && dm.store.wa_history === dHist);
// UI consistency (the redesigned components share one language)
const settingsHtml = run(make(NOW), 'renderSettings()');
ok('Settings: new entries use the same row card as the toggles (no stray ghost/action-card buttons), grouped under titles', (settingsHtml.match(/class="settings-row"/g) || []).length === 3 && (settingsHtml.match(/class="settings-row link"/g) || []).length === 6 && settingsHtml.includes('DATA SAFETY') && !settingsHtml.includes('ghost-btn') && !settingsHtml.includes('action-card') && ['PREFERENCES', 'APPEARANCE', 'WORKOUT', 'DATA'].every((g) => settingsHtml.includes('settings-group-title">' + g)) && settingsHtml.includes('CUSTOMIZATION') && balanced(settingsHtml));
ok('Settings: every link row triggers its action', ['goThemeStudio()', 'goAdvancedSettings()', 'goCustomMods()', 'exportData()', 'openImport()'].every((f) => settingsHtml.includes('onclick="' + f + '"')));
let ui = make(NOW); run(ui, "selectSession('PUSH_A');openEdit(0)"); ui.setField('edit-name', 'Push-ups'); run(ui, "editStep('sets',-1);saveEditCustom();openAdd()"); ui.setField('edit-name', 'Pike Push-ups'); run(ui, 'saveEditCustom();changeSets(2,1)');
const setupUi = run(ui, 'renderSetup()');
ok('Setup rows: status flags sit inline on the target line (no separate hanging block)', /<div class="exercise-target"><span>15 REPS<\/span><span class="flag flag-saved">CUSTOM<\/span><\/div>/.test(setupUi) && /<span class="flag flag-temp">THIS WORKOUT ONLY<\/span><\/div>/.test(setupUi) && /<span class="flag flag-added">ADDED<\/span><\/div>/.test(setupUi) && !setupUi.includes('exercise-flags'));
ok('Setup: one save workflow (sheet or SAVE AS MY DEFAULT), no per-row save links, balanced markup', !/class="flag-save"/.test(setupUi) && !setupUi.includes('saveRowCustom') && setupUi.includes('saveSessionDefault()') && balanced(setupUi));
run(ui, 'goCustomMods()'); const hubUi = run(ui, 'renderCustomMods()');
ok('Hub: unmodified exercises are slim rows (name, sets/target, one icon button) with no repeated DEFAULT badge', /class="mod-card is-default"><div class="mod-main">/.test(hubUi) && !hubUi.includes('>DEFAULT</span></div>\n') && (hubUi.match(/class="icon-btn"/g) || []).length === 6);
ok('Hub: reset actions use the shared row component, the destructive one is marked danger, both labelled', /settings-row link"[^>]*onclick="askResetSession\(\)"/.test(hubUi) && /settings-row link danger"[^>]*onclick="askResetAllMods\(\)"/.test(hubUi) && hubUi.includes('RESET PUSH A TO DEFAULT') && hubUi.includes('RESET ALL MODIFICATIONS'));
ok('Hub: disabled reset rows when there is nothing to reset', (() => { const e = make(NOW); run(e, 'goCustomMods()'); const x = run(e, 'renderCustomMods()'); return /settings-row link"\s+disabled onclick="askResetSession\(\)"/.test(x) && /settings-row link danger"\s+disabled onclick="askResetAllMods\(\)"/.test(x); })());
run(ui, "openEditManager('PUSH_A','b',0)"); const sheetUi = run(ui, 'renderEditSheet()');
ok('Edit sheet: labelled NAME field, original-vs-saved, defaults, two clearly different save actions', sheetUi.includes('field-label name-label">NAME') && sheetUi.includes('ORIGINAL') && sheetUi.includes('DEFAULT 3') && sheetUi.includes('SAVE AS CUSTOM') && !sheetUi.includes('APPLY TO THIS WORKOUT') /* manager context has no temporary option */ && balanced(sheetUi));
const cssAll = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), unified = cssAll.slice(cssAll.indexOf('Unified components (final layer)'));
ok('Unified CSS: chips/pills/icon buttons share radius, border and typography tokens; flags are one size', /\.swap-btn \{[^}]*border-radius: var\(--radius-full\)/.test(unified) && /\.qs-btn, \.pill-btn \{[^}]*border-radius: var\(--radius-full\)/.test(unified) && /\.flag \{[^}]*height: 18px/.test(unified) && /\.settings-row\.link \{[^}]*width: 100%/.test(unified));
ok('Unified CSS: theme variables only (no hard-coded colors), so red/yellow/blue stay consistent', !/#[0-9a-fA-F]{3,8}\b/.test(unified));
ok('Progress export range labels fit one line each', ['MONTH', '30 DAYS', '90 DAYS', 'ALL'].every((l) => run(make(NOW), "(goProgress(), renderProgress())").includes('>' + l + '</button>')));

// UI hygiene
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), iconSrc = fs.readFileSync(path.join(ROOT, 'icons.js'), 'utf8');
const used = [...new Set([...appSrc.matchAll(/icon\('([a-zA-Z]+)'/g)].map((m) => m[1]))];
const unknown = run(make(NOW), "icon('zzz-not-an-icon',12)");
ok('every icon name used in the app exists in icons.js', used.every((n) => n === 'flame' || run(make(NOW), `icon('${n}',12)`) !== unknown), used.filter((n) => n !== 'flame' && run(make(NOW), `icon('${n}',12)`) === unknown).join());
const css2 = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), tail2 = css2.slice(css2.indexOf('Customization hub + Quick Setup'));
ok('hub/preset CSS: theme variables only, no hard-coded colors', !/#[0-9a-fA-F]{3,8}\b/.test(tail2));
ok('hub/preset CSS: narrow-screen safe (minmax(0,1fr) tab grid, ellipsis, flexible buttons)', /hub-tabs \{[^}]*minmax\(0, 1fr\)/.test(tail2) && /\.hub-tab span \{[^}]*text-overflow: ellipsis/.test(tail2) && /\.qs-btn \{[^}]*min-width: 0/.test(tail2));
ok('no browser alert/prompt/confirm used for editing', !/\b(alert|prompt|confirm)\(/.test(appSrc));

// =====================================================================
console.log('\n== 7. THEME ENGINE (phase 1): one central source, no hard-coded accent effects ==');
{
  const themes = run(make(NOW), 'ACCENT_THEMES.map((t) => Object.assign({}, t))');
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
  const glowRgb = (g) => (/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(g) || []).slice(1, 4).join(', ');
  const spyApply = (theme) => { const cc = make(NOW), props = {}; cc.document.documentElement.style.setProperty = (k, v) => { props[k] = v; }; run(cc, 'applyAccentTheme(' + J(theme) + ')'); return props; };

  ok('the three existing themes are still red, yellow and blue (same order)', J(themes.map((t) => t.name)) === '["red","yellow","blue"]');
  ok('every theme defines its own glow, and no two themes share one', themes.every((t) => typeof t.glow === 'string') && new Set(themes.map((t) => t.glow)).size === themes.length);
  ok('each glow is the theme accent colour (same RGB as accent)', themes.every((t) => glowRgb(t.glow) === rgbOf(t.accent)), J(themes.map((t) => [t.name, glowRgb(t.glow), rgbOf(t.accent)])));
  for (const t of themes) {
    const p = spyApply(t);
    ok('applying "' + t.name + '" sets accent, soft, press, text, shadow and glow from that theme only',
      p['--accent'] === t.accent && p['--accent-soft'] === t.soft && p['--accent-press'] === t.press && p['--accent-text'] === t.text && p['--shadow-accent'].includes(t.shadow) && p['--accent-glow'] === t.glow, J(p));
    if (t.name !== 'red') ok('"' + t.name + '" has no red (229, 48, 63) anywhere in what it applies', !Object.values(p).some((v) => v.includes('229, 48, 63') || v.toLowerCase().includes('#e5303f')), J(p));
  }
  const noGlow = spyApply({ name: 'x', accent: '#00aa00', soft: 'rgba(0, 170, 0, 0.16)', press: '#008800', text: '#fff', shadow: 'rgba(0, 170, 0, 0.30)' });
  ok('a theme without glow falls back to its own shadow colour, never the red default', noGlow['--accent-glow'] === 'rgba(0, 170, 0, 0.30)');

  // persistence: the saved theme is re-applied on start, glow included
  for (const t of themes) {
    const cc = make(NOW), props = {}; cc.document.documentElement.style.setProperty = (k, v) => { props[k] = v; };
    run(cc, "Store.set('accentTheme','" + t.name + "'); initAccentTheme()");
    ok('saved theme "' + t.name + '" is restored at startup with its glow', props['--accent-glow'] === t.glow && props['--accent'] === t.accent);
  }
  // backup round trip: the theme name is exported and, on import, re-applied together with its glow
  { const cc = make(NOW); run(cc, "Store.set('accentTheme','blue')"); const bk = run(cc, 'buildBackup()');
    ok('backup still carries the accent theme name unchanged', JSON.parse(bk).data.accentTheme === 'blue');
    const cc2 = make(NOW), props = {}; cc2.document.documentElement.style.setProperty = (k, v) => { props[k] = v; };
    cc2.setField('import-input', bk); run(cc2, "state.screen='settings';state.importOpen=true;applyImport();commitImport()");
    const blue = themes.find((t) => t.name === 'blue');
    ok('importing a backup re-applies its theme with the matching glow', run(cc2, "Store.get('accentTheme')") === 'blue' && props['--accent-glow'] === blue.glow, J(props)); }

  // static scan of the stylesheet
  const cssAll = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const outsideRoot = cssAll.replace(/:root\s*\{[^}]*\}/g, '');
  ok('style.css: no hex colour outside :root (every colour is a token)', !/#[0-9a-fA-F]{3,8}\b/.test(outsideRoot), (outsideRoot.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(','));
  ok('style.css: no rgb()/rgba() literal outside :root', !/rgba?\(/.test(outsideRoot), (outsideRoot.match(/rgba?\([^)]*\)/g) || []).join(' | '));
  ok('style.css: the red accent value appears only in :root defaults', !/229,\s*48,\s*63|e5303f|c72432/i.test(outsideRoot));
  const ringRule = (/\.ring-progress\s*\{[^}]*\}/.exec(cssAll) || [''])[0];
  ok('timer ring glow comes from --accent-glow (no literal colour)', /drop-shadow\(0 0 8px var\(--accent-glow\)\)/.test(ringRule) && !/rgba?\(|#[0-9a-f]{3,8}/i.test(ringRule), ringRule);
  ok('the effective overlay and bottom-nav backgrounds still resolve to the same values as before', /--scrim:\s*rgba\(0, 0, 0, 0\.66\)/.test(cssAll) && /--nav-bg:\s*rgba\(14, 14, 17, 0\.9\)/.test(cssAll) && /\.overlay \{ background: var\(--scrim\)/.test(cssAll) && /#bottom-nav \{ gap: 6px; background: var\(--nav-bg\)/.test(cssAll));
  const declared = new Set([...cssAll.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  [...appJs.matchAll(/setProperty\('(--[a-z0-9-]+)'/g)].forEach((m) => declared.add(m[1]));
  const usedVars = [...new Set([...cssAll.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const undefinedVars = usedVars.filter((v) => !declared.has(v));
  ok('every var(--token) used in style.css is declared in CSS or set by JS (no typos / dangling tokens)', undefinedVars.length === 0, undefinedVars.join(','));
  ok('app.js: no hard-coded colour attributes in SVG markup (stroke/fill white or hex)', !/(?:stroke|fill)="(?:white|#[0-9a-fA-F]{3,8})"/.test(appJs));
  ok('rest-screen line art uses the motiv-stroke / motiv-axis classes, defined as tokens', /class="motiv-stroke"/.test(appJs) && /class="motiv-axis"/.test(appJs) && /\.motiv-stroke \{ stroke: var\(--motiv-stroke\); \}/.test(cssAll) && /\.motiv-axis \{ stroke: var\(--motiv-axis\); \}/.test(cssAll));
  const ring = run(make(NOW), 'ringSvg(90,180)');
  ok('ring markup carries no inline colour or filter (glow is theme-driven)', /class="ring-progress"/.test(ring) && !/style=|filter|stroke="#|rgba?\(/.test(ring));
  ok('warm-up, set timer and rest all draw their ring through the same timerBlock/ringSvg', ['renderWarmup', 'renderActive', 'renderRest'].every((f) => run(make(NOW), f + '.toString()').includes('timerBlock(')));
}

// =====================================================================
console.log('\n== 8. THEME STUDIO (phase 2): presets, validation, preview, save/cancel, storage, backup ==');
{
  const T8 = (store) => { const cc = make(NOW, Object.assign({}, store || {})), props = {}, cls = {}, el = cc.document.documentElement;
    el.style.setProperty = (k, v) => { props[k] = v; }; el.classList = { add: (x) => { cls[x] = true; }, remove: (x) => { delete cls[x]; } };
    return { cc, props, cls }; };
  const RED = { wa_accentTheme: J('red') };
  const copyStore = (cc) => JSON.parse(J(cc.store));
  const toast = (cc) => cc.toasts[cc.toasts.length - 1];
  const D = run(make(NOW), 'Object.assign({}, DEFAULT_TOKENS)');
  const css8 = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const trainKeys = ['wa_history', 'wa_exerciseMods', 'wa_customExercises', 'wa_settings'];
  const trainSnap = (cc) => J(trainKeys.map((k) => cc.store[k]));

  // ---- presets: order, original values, new ones ----
  const presets = run(make(NOW), 'THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, t: Object.assign({}, p.tokens) }))');
  const legacy = run(make(NOW), 'ACCENT_THEMES.map((t) => Object.assign({}, t))');
  ok('8 presets: Red, Yellow, Blue keep their order, then Purple, Emerald, Cyan, Orange, Rose', J(presets.map((p) => p.id)) === '["red","yellow","blue","purple","emerald","cyan","orange","rose"]');
  ok('Red, Yellow and Blue carry exactly their original accent values', presets.slice(0, 3).every((p, i) => p.t.accent === legacy[i].accent && p.t.accentPress === legacy[i].press && p.t.accentText === (legacy[i].text === '#fff' ? '#ffffff' : legacy[i].text)));
  presets.forEach((p) => {
    const v = run(make(NOW), "validateTheme(THEME_PRESETS.find((x) => x.id === '" + p.id + "').tokens)");
    ok('preset "' + p.id + '" is valid with no readability warnings', v.ok && v.warnings.length === 0, J(v));
    ok('preset "' + p.id + '" starts with Glass off and the current blur values (6px / 10px)', p.t.glass === false && p.t.blurOverlay === 6 && p.t.blurNav === 10);
    if (p.id !== 'red') { const t = T8(RED); run(t.cc, "applyThemeTokens(THEME_PRESETS.find((x) => x.id === '" + p.id + "').tokens, false)");
      ok('preset "' + p.id + '" applies no red anywhere', !Object.values(t.props).some((x) => /229, 48, 63|#e5303f|#c72432/i.test(x))); }
  });
  { // the design must not change: applying Red reproduces the stylesheet defaults exactly
    const rootDecl = {};
    [...css8.matchAll(/:root\s*\{([^}]*)\}/g)].forEach((m) => [...m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].forEach((d) => { rootDecl[d[1]] = d[2].trim(); }));
    const nv = (v) => v.toLowerCase().replace(/\s+/g, ' ').replace(/^#fff$/, '#ffffff');
    const t = T8(RED); run(t.cc, 'applyThemeTokens(THEME_PRESETS[0].tokens, false)');
    const mism = Object.keys(t.props).filter((k) => rootDecl[k] === undefined || nv(t.props[k]) !== nv(rootDecl[k]));
    ok('applying Red sets all ' + Object.keys(t.props).length + ' variables to exactly the stylesheet defaults (the app looks the same)', mism.length === 0 && Object.keys(t.props).length >= 20, J(mism.map((k) => [k, t.props[k], rootDecl[k]])));
  }

  // ---- HEX and value validation ----
  const nh = (v) => run(make(NOW), 'normHex(' + J(v) + ')');
  ok('HEX accepted and normalised: #fff, FFF, #E5303F, " #abc ", e5303f', nh('#fff') === '#ffffff' && nh('FFF') === '#ffffff' && nh('#E5303F') === '#e5303f' && nh(' #abc ') === '#aabbcc' && nh('e5303f') === '#e5303f');
  ok('HEX rejected: empty, short, long, non-hex, names, numbers, null, markup', ['', '#12', '#12345', '#1234567', '#gggggg', 'red', 'rgb(1,2,3)', 123, null, undefined, '<script>alert(1)</script>', '#ff00zz'].every((v) => nh(v) === null));
  const vt = (patch) => run(make(NOW), 'validateTheme(Object.assign({}, DEFAULT_TOKENS, ' + J(patch) + '))');
  ok('the default theme is valid with no warnings', vt({}).ok && vt({}).warnings.length === 0);
  ok('light backgrounds and surfaces are rejected with a clear reason', ['bg', 'bgTop', 'card', 'cardTop', 'track', 'navBg'].every((k) => { const r = vt({ [k]: '#ffffff' }); return !r.ok && r.errors.some((e) => e.code === 'LIGHT' && /dark/i.test(e.text)); }) && vt({ bg: '#777777' }).errors.some((e) => e.code === 'LIGHT'));
  ok('the dark limit is a luminance ceiling: a dark grey passes it, a light grey does not', !vt({ card: '#2a2a2e' }).errors.some((e) => e.code === 'LIGHT') && vt({ card: '#808080' }).errors.some((e) => e.code === 'LIGHT'));
  ok('contrast below 3:1 is rejected (text, secondary text, text on accent, accent on surface)', !vt({ text: '#2a2a2a' }).ok && vt({ text: '#2a2a2a' }).errors.some((e) => e.code === 'CONTRAST') && !vt({ textSecondary: '#1f1f22' }).ok && !vt({ accentText: '#e5303f' }).ok && !vt({ accent: '#111111', glowColor: '#111111' }).ok);
  let grey = null;
  { const cc = make(NOW); for (let g = 0x60; g < 0xf0 && !grey; g++) { const hx = '#' + g.toString(16).padStart(2, '0').repeat(3), r = run(cc, "contrastRatio('" + hx + "', '#1a1a1d')"); if (r >= 3.3 && r < 4.2) grey = hx; } }
  ok('a test grey between 3:1 and 4.5:1 exists for the warning band', !!grey, grey);
  const warnR = vt({ text: grey });
  ok('contrast from 3:1 up to 4.5:1 is allowed but warns (with the ratio and the 4.5:1 target)', warnR.ok && warnR.warnings.length >= 1 && /below the recommended 4\.5:1/.test(warnR.warnings[0].text) && /\d\.\d:1/.test(warnR.warnings[0].text));
  ok('4.5:1 or more: accepted with no warning (default text is above 15:1)', vt({}).warnings.length === 0);
  ok('the original Red does not warn (its white-on-red is 4.35:1: accent pairs only reject below 3:1)', run(make(NOW), 'validateTheme(THEME_PRESETS[0].tokens)').warnings.length === 0);
  ok('invalid values are rejected: alpha out of range, NaN, text, px non-integer or out of range, wrong boolean type', [{ accentSoft: 0.9 }, { glowAlpha: -1 }, { borderAlpha: 'x' }, { navAlpha: 0.1 }, { blurNav: 2.5 }, { blurOverlay: 99 }, { glassBlur: 0 }, { glass: 'yes' }, { accent: 'red' }, { cardShadow: 5 }].every((p) => !vt(p).ok));
  ok('relative luminance / contrast math: black on white is 21:1, same colour is 1:1', Math.abs(run(make(NOW), "contrastRatio('#000000', '#ffffff')") - 21) < 0.01 && Math.abs(run(make(NOW), "contrastRatio('#336699', '#336699')") - 1) < 0.001);

  // ---- preview is temporary; nothing is stored until SAVE; leaving restores the saved theme ----
  { const t = T8(RED); run(t.cc, 'goThemeStudio()');
    const snap = J(t.cc.store);
    run(t.cc, "studioSelect('p:purple')");
    ok('previewing a preset applies it live but writes NOTHING to storage', t.props['--accent'] === '#7c4dff' && J(t.cc.store) === snap && run(t.cc, 'studioPreviewing()') === true && run(t.cc, 'renderThemeStudio()').includes('PREVIEW \u00b7 NOT SAVED'));
    run(t.cc, "goThemeAdvanced(); studioSetColor('text', '#eeeeee')");
    ok('advanced edits are previewed and not stored either', t.props['--text'] === '#eeeeee' && J(t.cc.store) === snap);
    run(t.cc, 'studioCancel()');
    ok('CANCEL drops the draft and brings back the last saved theme (Red)', run(t.cc, 'state.screen') === 'settings' && run(t.cc, 'state.studio') === null && t.props['--accent'] === '#e5303f' && t.props['--text'] === '#f2f2f0' && J(t.cc.store) === snap);
    for (const leave of ['goHome()', 'goHistory()', 'goProgress()', 'goSettings()']) {
      const u = T8(RED); run(u.cc, "goThemeStudio(); studioSelect('p:cyan')"); const before = J(u.cc.store); run(u.cc, leave);
      ok('leaving the studio with ' + leave + ' also restores the saved theme without saving', u.props['--accent'] === '#e5303f' && run(u.cc, 'state.studio') === null && J(u.cc.store) === before);
    }
  }
  // ---- save: built-in presets, custom copies ----
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:emerald'); studioSave()");
    const st = JSON.parse(t.cc.store.wa_theme);
    ok('SAVE of an unchanged preset makes it the active theme (no custom copy)', st.active === 'p:emerald' && st.customs.length === 0 && t.props['--accent'] === '#10b981' && run(t.cc, 'studioPreviewing()') === false && toast(t.cc) === 'THEME SAVED');
    ok('a new-style preset keeps a valid legacy accent for older app versions', JSON.parse(t.cc.store.wa_accentTheme) === 'red');
    run(t.cc, "studioSelect('p:blue'); studioSave()");
    ok('saving Blue (one of the original three) mirrors the legacy accentTheme key', JSON.parse(t.cc.store.wa_accentTheme) === 'blue' && JSON.parse(t.cc.store.wa_theme).active === 'p:blue');
  }
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:blue'); goThemeAdvanced(); studioSetColor('glowColor', '#22aacc')"); t.cc.setField('studio-name', 'My teal');
    const blueBefore = J(presets[2].t);
    run(t.cc, 'studioSave()');
    const st = JSON.parse(t.cc.store.wa_theme), c = st.customs[0];
    ok('editing a built-in theme saves a CUSTOM copy and makes it active', st.customs.length === 1 && c.name === 'My teal' && c.from === 'blue' && st.active === 'c:' + c.id && c.tokens.glowColor === '#22aacc');
    ok('the original built-in theme is never changed', J(run(t.cc, "THEME_PRESETS.find((x) => x.id === 'blue').tokens")) === blueBefore && J(run(t.cc, "THEME_PRESETS[2].tokens")) === blueBefore);
    ok('the custom theme is applied', t.props['--accent-glow'] === 'rgba(34, 170, 204, 0.55)' && t.props['--accent'] === '#3468f0');
    run(t.cc, "studioSelect('c:" + c.id + "'); goThemeAdvanced(); studioSetColor('glowColor', '#aa44cc')"); t.cc.setField('studio-name', 'Renamed'); run(t.cc, 'studioSave()');
    const st2 = JSON.parse(t.cc.store.wa_theme);
    ok('SAVE on a custom theme updates it in place (no extra copy) and can rename it', st2.customs.length === 1 && st2.customs[0].name === 'Renamed' && st2.customs[0].tokens.glowColor === '#aa44cc' && st2.customs[0].id === c.id);
  }
  // ---- naming and the 5-theme limit ----
  { const t = T8(RED); run(t.cc, 'goThemeStudio()');
    const accents = ['#22aa77', '#2299dd', '#dd8822', '#aa44cc', '#cc3366'];
    accents.forEach((a, i) => { run(t.cc, "studioSelect('p:red'); studioBasicAccent('" + a + "')"); t.cc.setField('studio-name', 'Theme ' + (i + 1)); run(t.cc, 'studioSave()'); });
    ok('up to 5 custom themes can be saved', JSON.parse(t.cc.store.wa_theme).customs.length === 5);
    run(t.cc, "studioSelect('p:red'); studioBasicAccent('#44aadd')"); t.cc.setField('studio-name', 'Sixth'); const beforeSix = t.cc.store.wa_theme; run(t.cc, 'studioSave()');
    ok('a 6th is refused with a clear message and nothing is stored', toast(t.cc) === 'LIMIT: 5 CUSTOM THEMES' && t.cc.store.wa_theme === beforeSix);
    run(t.cc, "studioSelect('c:" + JSON.parse(t.cc.store.wa_theme).customs[0].id + "'); studioBasicAccent('#33bb88')"); t.cc.setField('studio-name', 'Theme 1'); run(t.cc, 'studioSave()');
    ok('editing an existing custom theme still works at the limit', toast(t.cc) === 'THEME SAVED' && JSON.parse(t.cc.store.wa_theme).customs.length === 5);
    run(t.cc, "studioSelect('p:red'); studioBasicAccent('#44aadd')");
    t.cc.setField('studio-name', 'theme 3'); run(t.cc, 'studioSave()'); ok('duplicate names are refused (case-insensitive)', toast(t.cc) === 'NAME ALREADY USED');
  }
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:red'); studioBasicAccent('#22aa77')");
    t.cc.setField('studio-name', 'Purple'); run(t.cc, 'studioSave()'); ok('a name equal to a built-in theme is refused', toast(t.cc) === 'NAME ALREADY USED' && t.cc.store.wa_theme === undefined);
    t.cc.setField('studio-name', '   '); run(t.cc, 'studioSave()'); ok('an empty name is refused', toast(t.cc) === 'ENTER A NAME' && t.cc.store.wa_theme === undefined);
    t.cc.setField('studio-name', '<b>Evil "name"</b> that is way too long to keep'); run(t.cc, 'studioSave()');
    const nm = JSON.parse(t.cc.store.wa_theme).customs[0].name;
    ok('names are sanitised (no markup characters) and limited to 20 characters', nm.length <= 20 && !/[<>"&]/.test(nm) && nm.length > 0, nm);
    ok('the name is escaped wherever it is shown', !run(t.cc, 'renderThemeStudio()').includes('<b>Evil'));
  }
  // ---- wrong values never break the app ----
  { const t = T8(RED); run(t.cc, "goThemeStudio(); goThemeAdvanced()");
    const draft0 = J(run(t.cc, 'state.studio.draft'));
    ['', '#12', 'zzz', 'red', '<img src=x onerror=alert(1)>', '#1234567', null].forEach((v) => { run(t.cc, 'studioSetColor("accent", ' + J(v) + ')'); });
    ok('invalid HEX input is rejected with a message and the draft is unchanged', J(run(t.cc, 'state.studio.draft')) === draft0 && /Invalid color/.test(run(t.cc, 'state.studio.msg')) && toast(t.cc) === 'INVALID COLOR');
    run(t.cc, "studioSetColor('bg', '#ffffff')");
    ok('a light background is refused with a clear explanation (dark only, system bars)', run(t.cc, 'state.studio.draft.bg') === '#0b0b0d' && /too light/i.test(run(t.cc, 'state.studio.msg')) && /system bars/i.test(run(t.cc, 'state.studio.msg')) && toast(t.cc) === 'TOO LIGHT \u00b7 DARK ONLY');
    ok('the explanation is shown on screen', run(t.cc, 'renderThemeAdvanced()').includes('too light'));
    run(t.cc, "studioSetColor('card', '#999999')"); ok('a light surface is refused too', run(t.cc, 'state.studio.draft.card') === '#1a1a1d');
    run(t.cc, "studioSetColor('text', '#2a2a2a')"); ok('unreadable text is refused (below 3:1) and the draft keeps the last readable value', run(t.cc, 'state.studio.draft.text') === '#f2f2f0' && /3:1/.test(run(t.cc, 'state.studio.msg')) && toast(t.cc) === 'LOW CONTRAST');
    ok('the live app was never switched to a rejected value', t.props['--bg'] !== '#ffffff' && t.props['--text'] !== '#2a2a2a');
    run(t.cc, "studioSetColor('text', '" + grey + "')");
    ok('a borderline text colour is accepted and the warning is shown', run(t.cc, 'state.studio.draft.text') === grey && run(t.cc, 'renderThemeAdvanced()').includes('below the recommended 4.5:1') && t.props['--text'] === grey);
    t.cc.setField('studio-name', 'Dim text'); run(t.cc, 'studioSave()');
    ok('...and it can be saved (3:1 up to 4.5:1 is allowed)', JSON.parse(t.cc.store.wa_theme).customs.length === 1);
    const forced = T8(RED); run(forced.cc, "goThemeStudio(); state.studio.draft = Object.assign({}, state.studio.draft, { text: '#202020' }); studioSave()");
    ok('SAVE re-checks: a draft that somehow became unreadable is refused', forced.cc.store.wa_theme === undefined && /CANNOT SAVE/.test(toast(forced.cc)));
    run(t.cc, "studioBasicAccent('#101010')"); ok('Basic accent: an accent too dark for the surfaces is refused', run(t.cc, 'state.studio.draft.accent') !== '#101010');
  }
  // ---- Basic accent picker ----
  { const t = T8(RED); run(t.cc, 'goThemeStudio()'); const snap = J(t.cc.store);
    run(t.cc, "studioBasicAccent('#ff8800')");
    const d = run(t.cc, 'state.studio.draft');
    ok('Basic accent sets the accent and derives pressed colour, glow colour and readable button text', d.accent === '#ff8800' && d.glowColor === '#ff8800' && d.accentPress !== d.accent && /^#[0-9a-f]{6}$/.test(d.accentPress) && run(t.cc, 'validateTheme(state.studio.draft)').ok && run(t.cc, "contrastRatio(state.studio.draft.accentText, state.studio.draft.accent)") >= 3);
    run(t.cc, "studioPickerInput('h', 200); studioPickerInput('s', 70); studioPickerInput('l', 45)");
    ok('dragging the picker sliders previews live without storing or re-rendering', run(t.cc, 'state.studio.draft.accent') === run(t.cc, 'hslToHex(200, 70, 45)') && t.props['--accent'] === run(t.cc, 'hslToHex(200, 70, 45)') && J(t.cc.store) === snap);
    ok('HSL round trip is stable', ['#e5303f', '#3468f0', '#10b981'].every((h) => { const hs = run(t.cc, "hexToHsl('" + h + "')"); const back = run(t.cc, 'hslToHex(' + hs.join(',') + ')'); return Math.abs(parseInt(back.slice(1, 3), 16) - parseInt(h.slice(1, 3), 16)) <= 4 && Math.abs(parseInt(back.slice(5, 7), 16) - parseInt(h.slice(5, 7), 16)) <= 4; }));
  }
  // ---- reset values, Reset to Red, delete ----
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:blue'); goThemeAdvanced(); studioSetColor('glowColor', '#22aacc'); studioStep('glowAlpha', -1)");
    ok('per-value reset restores that value to the theme\u2019s original', run(t.cc, 'state.studio.draft.glowAlpha') === 0.5 && (run(t.cc, "studioResetToken('glowAlpha')"), run(t.cc, 'state.studio.draft.glowAlpha') === 0.55) && run(t.cc, 'state.studio.draft.glowColor') === '#22aacc');
    run(t.cc, 'studioResetAll()'); ok('RESET ALL VALUES returns the whole draft to the theme\u2019s original', J(run(t.cc, 'state.studio.draft')) === J(presets[2].t) && run(t.cc, 'studioDirty()') === false);
    run(t.cc, "studioSelect('p:blue'); studioSetColor('glowColor', '#22aacc')"); t.cc.setField('studio-name', 'Teal glow'); run(t.cc, 'studioSave()');
    const id = JSON.parse(t.cc.store.wa_theme).customs[0].id;
    run(t.cc, "studioSelect('c:" + id + "'); studioSetColor('glowColor', '#aa44cc'); studioResetAll()");
    ok('for a custom theme, "original" means the built-in theme it was made from', J(run(t.cc, 'state.studio.draft')) === J(presets[2].t));
    run(t.cc, 'studioReset()');
    const st = JSON.parse(t.cc.store.wa_theme);
    ok('RESET TO RED makes Red active, keeps every custom theme, and re-applies Red', st.active === 'p:red' && st.customs.length === 1 && t.props['--accent'] === '#e5303f' && JSON.parse(t.cc.store.wa_accentTheme) === 'red' && toast(t.cc) === 'RESET TO RED');
    run(t.cc, "askDeleteTheme('" + id + "')");
    ok('delete asks for confirmation first and removes nothing yet', run(t.cc, 'state.confirmAction.kind') === 'deleteTheme' && JSON.parse(t.cc.store.wa_theme).customs.length === 1 && run(t.cc, 'renderConfirmOverlay(state.confirmAction)').includes('DELETE THEME?'));
    run(t.cc, 'cancelConfirmAction()'); ok('cancel keeps the theme', JSON.parse(t.cc.store.wa_theme).customs.length === 1);
    run(t.cc, "askDeleteTheme('" + id + "'); confirmDeleteTheme()");
    ok('confirmed delete of an inactive custom theme leaves the active theme alone', JSON.parse(t.cc.store.wa_theme).customs.length === 0 && JSON.parse(t.cc.store.wa_theme).active === 'p:red');
  }
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:blue'); studioSetColor('glowColor', '#22aacc')"); t.cc.setField('studio-name', 'Mine'); run(t.cc, 'studioSave()');
    const id = JSON.parse(t.cc.store.wa_theme).customs[0].id;
    ok('the custom theme is active before deleting', JSON.parse(t.cc.store.wa_theme).active === 'c:' + id);
    run(t.cc, "askDeleteTheme('" + id + "'); confirmDeleteTheme()");
    const st = JSON.parse(t.cc.store.wa_theme);
    ok('deleting the ACTIVE custom theme moves the app to a valid built-in theme (the one it came from)', st.active === 'p:blue' && st.customs.length === 0 && t.props['--accent'] === '#3468f0' && JSON.parse(t.cc.store.wa_accentTheme) === 'blue');
    ok('the studio re-opens on the new active theme without a stale draft', run(t.cc, 'state.studio.baseId') === 'p:blue' && run(t.cc, 'studioPreviewing()') === false);
  }
  // ---- Glass and Blur ----
  { const t = T8(RED); run(t.cc, 'initAccentTheme()');
    ok('by default Glass is off and blur kill-switch is off (no effect classes)', !t.cls['fx-glass'] && !t.cls['fx-noblur']);
    run(t.cc, "goThemeStudio(); studioSelect('p:red'); goThemeAdvanced(); studioToggle('glass')");
    ok('Glass can be previewed (class on), and is not stored until SAVE', t.cls['fx-glass'] === true && t.cc.store.wa_theme === undefined);
    t.cc.setField('studio-name', 'Glassy'); run(t.cc, 'studioSave()');
    ok('saved Glass theme keeps the effect on', t.cls['fx-glass'] === true && JSON.parse(t.cc.store.wa_theme).customs[0].tokens.glass === true);
    run(t.cc, 'studioToggleBlur()');
    ok('DISABLE ALL BLUR turns every blur off immediately and also switches Glass off', t.cls['fx-noblur'] === true && !t.cls['fx-glass'] && JSON.parse(t.cc.store.wa_theme).disableBlur === true && toast(t.cc) === 'ALL BLUR OFF');
    const re = T8(copyStore(t.cc)); run(re.cc, 'initAccentTheme()');
    ok('the kill switch survives a restart', re.cls['fx-noblur'] === true && !re.cls['fx-glass']);
    run(t.cc, 'studioToggleBlur()');
    ok('turning it back off restores blur and the saved Glass choice', !t.cls['fx-noblur'] && t.cls['fx-glass'] === true);
    const cu = T8(RED); run(cu.cc, "goThemeStudio(); goThemeAdvanced(); studioStep('blurNav', 1); studioStep('blurOverlay', -1)");
    ok('blur amounts are adjustable within 0..20 and previewed', run(cu.cc, 'state.studio.draft.blurNav') === 11 && cu.props['--blur-nav'] === '11px' && cu.props['--blur-overlay'] === '5px');
    for (let i = 0; i < 30; i++) run(cu.cc, "studioStep('blurNav', 1)");
    ok('steppers clamp at their limits and never produce an invalid theme', run(cu.cc, 'state.studio.draft.blurNav') === 20 && run(cu.cc, 'validateTheme(state.studio.draft)').ok);
    const unsupported = T8(RED); run(unsupported.cc, "CSS = { supports: () => false }; goThemeStudio(); goThemeAdvanced(); studioToggle('glass')");
    ok('where the WebView lacks backdrop blur, Glass is unavailable and says so', run(unsupported.cc, 'state.studio.draft.glass') === false && toast(unsupported.cc) === 'NOT SUPPORTED ON THIS DEVICE' && run(unsupported.cc, 'renderThemeAdvanced()').includes('does not support backdrop blur'));
  }
  // ---- persistence, existing users, first run ----
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:blue'); studioSetColor('glowColor', '#22aacc')"); t.cc.setField('studio-name', 'Persist'); run(t.cc, 'studioSave()');
    const re = T8(copyStore(t.cc)); run(re.cc, 'initAccentTheme()');
    ok('the saved custom theme is applied again after a restart', re.props['--accent-glow'] === 'rgba(34, 170, 204, 0.55)' && re.props['--accent'] === '#3468f0');
    const ex = T8({ wa_accentTheme: J('yellow') }); run(ex.cc, 'initAccentTheme()');
    ok('existing users keep their current theme (legacy accent only: Yellow stays Yellow)', ex.props['--accent'] === '#e8b023' && ex.cc.store.wa_theme === undefined && run(ex.cc, "(goThemeStudio(), state.studio.baseId)") === 'p:yellow');
    const fresh = T8({}); run(fresh.cc, 'initAccentTheme()');
    ok('a fresh install still gets one random original accent and creates no theme data', ['red', 'yellow', 'blue'].includes(JSON.parse(fresh.cc.store.wa_accentTheme)) && fresh.cc.store.wa_theme === undefined);
  }
  { // corrupt or tampered stored data
    const garbage = ['"x"', '[]', '123', 'null', '{"active":5}', J({ active: 'c:nope', customs: 'x' }), J({ active: 'p:zzz', customs: [null, 5, 'a', { id: 1 }] }),
      J({ active: 'c:c_bad', customs: [{ id: 'c_bad', name: 'Light', tokens: Object.assign({}, D, { bg: '#ffffff' }) }] }),
      J({ active: 'c:c_bad2', customs: [{ id: 'c_bad2', name: 'Unreadable', tokens: Object.assign({}, D, { text: '#202020' }) }] })];
    garbage.forEach((g, i) => {
      const t = T8({ wa_theme: g, wa_accentTheme: J('blue') });
      let err = null; try { run(t.cc, "initAccentTheme(); goThemeStudio(); renderThemeStudio(); goThemeAdvanced(); renderThemeAdvanced()"); } catch (e) { err = e.message; }
      ok('corrupt saved theme #' + (i + 1) + ' never breaks the app and falls back to a valid built-in theme', !err && t.props['--accent'] === '#3468f0' && run(t.cc, 'getThemeStore().customs.length') === 0, err || '');
    });
    const keep = T8({ wa_theme: J({ active: 'c:c_ok', customs: [{ id: 'c_ok', name: 'Fine', from: 'purple', tokens: { accent: '#1e8e63', junk: 1 } }, { id: 'c_ok2', name: 'fine', tokens: D }] }) });
    const st = run(keep.cc, 'getThemeStore()');
    ok('a custom theme with a few bad values is repaired (not discarded); duplicate names are made unique', st.customs.length === 2 && st.customs[0].tokens.accent === '#1e8e63' && st.customs[0].tokens.bg === '#0b0b0d' && st.customs[1].name !== 'fine' && st.active === 'c:c_ok');
    const over = T8({ wa_theme: J({ active: 'p:red', customs: Array.from({ length: 8 }, (_, i) => ({ id: 'c_x' + i, name: 'T' + i, tokens: D })) }) });
    ok('more than 5 saved custom themes are capped at 5', run(over.cc, 'getThemeStore().customs.length') === 5);
  }
  // ---- backup / import / migration ----
  { const t = T8(RED); run(t.cc, "goThemeStudio(); studioSelect('p:blue'); studioSetColor('glowColor', '#22aacc')"); t.cc.setField('studio-name', 'Backed up'); run(t.cc, 'studioSave()');
    const bk = run(t.cc, 'buildBackup()'), parsed = JSON.parse(bk);
    ok('backups carry the theme and schemaVersion 5, still with the legacy accentTheme', parsed.schemaVersion === (GEN_VIEW ? 6 : 5) && parsed.data.theme.customs.length === 1 && parsed.data.accentTheme === 'red');
    const t2 = T8({}); t2.cc.setField('import-input', bk); run(t2.cc, "state.screen='settings';state.importOpen=true;applyImport()");
    ok('the import preview lists the Theme Studio data and changes nothing yet', run(t2.cc, 'renderImportPreview()').includes('Theme Studio: 1 custom theme(s)') && t2.cc.store.wa_theme === undefined);
    run(t2.cc, 'commitImport()');
    ok('importing restores custom themes, the active theme and applies it', run(t2.cc, 'getThemeStore().customs[0].name') === 'Backed up' && t2.props['--accent-glow'] === 'rgba(34, 170, 204, 0.55)' && JSON.parse(t2.cc.store.wa_theme).active.indexOf('c:') === 0);
    // old v4 backup (accentTheme only) keeps the existing theme data
    const t3 = T8(copyStore(t.cc)); const v4 = J({ app: 'WorkoutApp', schemaVersion: 4, data: { accentTheme: 'yellow', history: [W('2026-09-01')] } });
    t3.cc.setField('import-input', v4); run(t3.cc, "state.screen='settings';state.importOpen=true;applyImport();commitImport()");
    ok('an old backup (v4, accentTheme only) imports normally and leaves saved custom themes alone', run(t3.cc, "Store.get('history').length") === 1 && run(t3.cc, 'getThemeStore().customs.length') === 1 && JSON.parse(t3.cc.store.wa_accentTheme) === 'yellow');
    // invalid theme data: reported, skipped, rest imported
    const bad = J({ app: 'WorkoutApp', schemaVersion: 5, data: { history: [W('2026-09-02')], theme: { active: 'c:c_a', customs: [{ id: 'c_a', name: 'Light', tokens: Object.assign({}, D, { bg: '#ffffff' }) }, { id: 'c_b', name: 'Good', tokens: D }, { id: 'bad id', name: 'x', tokens: D }] } } });
    const t4 = T8({}); t4.cc.setField('import-input', bad); run(t4.cc, "state.screen='settings';state.importOpen=true;applyImport()");
    const pv = run(t4.cc, 'renderImportPreview()');
    ok('invalid imported themes are skipped and reported in the preview; the rest of the backup is kept', pv.includes('2 invalid skipped') && pv.includes('1 custom theme(s)') && pv.includes('1 workout/rest records'));
    run(t4.cc, 'commitImport()');
    ok('the light-background theme is never imported or applied', run(t4.cc, 'getThemeStore().customs.map((c) => c.name).join()') === 'Good' && run(t4.cc, "Store.get('history').length") === 1 && t4.props['--bg'] !== '#ffffff');
    const junk = T8({}); junk.cc.setField('import-input', J({ app: 'WorkoutApp', data: { theme: 'nonsense', history: [W('2026-09-03')] } })); run(junk.cc, "state.screen='settings';state.importOpen=true;applyImport()");
    ok('a malformed theme object in a backup is ignored (and said so) without dropping other data', run(junk.cc, 'renderImportPreview()').includes('Theme Studio data was invalid and is ignored') && run(junk.cc, 'state.importPreview.report.records') === 1);
  }
  { // training data is never touched by the studio; migration is additive
    const t = T8(RED); run(t.cc, "Store.set('history', " + J([W('2026-10-01'), R('2026-10-02')]) + "); Store.set('exerciseMods', {'PUSH_A|Push-ups': {sets: 2}}); Store.set('customExercises', {}); Store.set('settings', {keepAwake:false})");
    run(t.cc, "selectSession('PUSH_A'); openAdd()"); t.cc.setField('edit-name', 'Pike'); run(t.cc, 'saveEditCustom(); goHome()');
    const before = trainSnap(t.cc);
    run(t.cc, "goThemeStudio(); studioSelect('p:purple'); studioSave(); studioSelect('p:red'); studioBasicAccent('#22aa77')"); t.cc.setField('studio-name', 'Green'); run(t.cc, "studioSave(); goThemeAdvanced(); studioToggle('glass'); studioStep('glassBlur', 3); studioToggleBlur(); studioToggleBlur(); studioResetAll(); studioCancel()");
    run(t.cc, "goThemeStudio(); askDeleteTheme(getThemeStore().customs[0].id); confirmDeleteTheme(); studioReset(); goHome()");
    t.cc.setField('import-input', J({ app: 'WorkoutApp', data: { theme: { active: 'p:cyan', customs: [] } } })); run(t.cc, "state.screen='settings';state.importOpen=true;applyImport();commitImport()");
    ok('history, saved exercise changes, added exercises and settings are byte-for-byte identical after every theme operation', trainSnap(t.cc) === before);
    const mg = T8({ wa_schemaVersion: J(4), wa_history: J([W('2026-10-01')]), wa_accentTheme: J('blue'), wa_exerciseMods: J({ 'PUSH_A|Push-ups': { sets: 2 } }) });
    const h0 = mg.cc.store.wa_history, m0 = mg.cc.store.wa_exerciseMods, a0 = mg.cc.store.wa_accentTheme; run(mg.cc, 'init()');
    ok('migration to schema 5 only bumps the version: no theme key is created and no data is rewritten', run(mg.cc, "Store.get('schemaVersion')") === (GEN_VIEW ? 6 : 5) && mg.cc.store.wa_theme === undefined && (GEN_VIEW ? (mg.cc.rawStore.wa_history === J([W('2026-10-01')]) && mg.cc.rawStore.wa_exerciseMods === J({ 'PUSH_A|Push-ups': { sets: 2 } }) && mg.cc.rawStore.wa_accentTheme === J('blue')) : (mg.cc.store.wa_history === h0 && mg.cc.store.wa_exerciseMods === m0 && mg.cc.store.wa_accentTheme === a0)));
  }
  // ---- screens and stylesheet ----
  { const t = T8(RED); run(t.cc, 'goThemeStudio()');
    for (const p of presets) { run(t.cc, "studioSelect('p:" + p.id + "')"); const h = run(t.cc, 'renderThemeStudio()'), a = run(t.cc, 'renderThemeAdvanced()');
      ok('Theme Studio and Advanced render cleanly for "' + p.id + '" (balanced markup, no undefined/NaN)', balanced(h) && balanced(a)); }
    const h = run(t.cc, 'renderThemeStudio()'), a = run(t.cc, 'renderThemeAdvanced()');
    ok('Basic shows all 8 presets in order, MY THEMES with the limit, accent picker + HEX, blur switch, Save/Cancel, Advanced and Reset to Red', (h.match(/class="theme-chip/g) || []).length === 8 && h.indexOf('>Red<') < h.indexOf('>Yellow<') && h.indexOf('>Yellow<') < h.indexOf('>Blue<') && h.includes('MY THEMES \u00b7 0/5') && h.includes('studio-hex-accent') && (h.match(/type="range"/g) || []).length === 3 && h.includes('DISABLE ALL BLUR') && h.includes('studioCancel()') && h.includes('goThemeAdvanced()') && h.includes('studioReset()'));
    const labels = run(t.cc, 'TOKEN_DEFS.map((d) => d.label)'), groups = run(t.cc, 'THEME_GROUPS');
    ok('Advanced lists every token with a label and a reset button, in the planned groups', labels.every((l) => a.includes(l)) && groups.every((g) => a.includes('settings-group-title">' + g + '<')) && (a.match(/studioResetToken\(/g) || []).length === labels.length && a.includes('RESET ALL VALUES'));
    ok('Settings has a THEME STUDIO row in its own APPEARANCE group', run(make(NOW), 'renderSettings()').includes('settings-group-title">APPEARANCE') && run(make(NOW), 'renderSettings()').includes('onclick="goThemeStudio()"'));
    run(t.cc, "studioSelect('p:red')"); ok('Save is disabled while there is nothing to save', /<button class="primary-btn" disabled/.test(run(t.cc, 'renderThemeStudio()')));
    run(t.cc, "studioSelect('p:orange')"); ok('Save is enabled for a previewed theme and says what it will do', /<button class="primary-btn"\s+onclick="studioSave\(\)"/.test(run(t.cc, 'renderThemeStudio()')) && run(t.cc, 'renderThemeStudio()').includes('SAVE AND USE ORANGE'));
    run(t.cc, "studioBasicAccent('#22aa77')"); ok('an edited preset offers SAVE AS CUSTOM THEME with a name field and a copy notice', run(t.cc, 'renderThemeStudio()').includes('SAVE AS CUSTOM THEME') && run(t.cc, 'renderThemeStudio()').includes('id="studio-name"') && run(t.cc, 'renderThemeStudio()').includes('The original is never changed'));
  }
  ok('stylesheet: dialog and bottom-bar blur read tokens whose defaults equal the previous fixed values (6px / 10px)', /\.overlay \{[^}]*blur\(var\(--blur-overlay\)\)/.test(css8) && /#bottom-nav \{[^}]*blur\(var\(--blur-nav\)\)/.test(css8) && /--blur-overlay:\s*6px/.test(css8) && /--blur-nav:\s*10px/.test(css8) && !/blur\((?:6|10)px\)/.test(css8));
  ok('stylesheet: DISABLE ALL BLUR rule removes every backdrop-filter', /html\.fx-noblur \* \{[^}]*backdrop-filter: none !important/.test(css8));
  ok('stylesheet: Glass reads tokens and only applies under html.fx-glass', /html\.fx-glass \.streak-card[^{]*\{[^}]*background: var\(--glass-bg\)[^}]*blur\(var\(--glass-blur\)\)/.test(css8));
}

// =====================================================================
console.log('\n== 9. DATA SAFETY (phase 3A): generations, migration, Quarantine, Recovery Center ==');
if (!GEN_VIEW) {
  const G = (store, o) => make(NOW, store, Object.assign({ dataSafety: true }, o || {}));
  const clone = (o) => JSON.parse(J(o));
  const withLabel = (e, label) => Object.assign(e, { summary: Object.assign({}, e.summary, { sessionLabel: label }) });
  const legacyStore = () => ({
    wa_history: J([W('2026-10-12'), R('2026-10-11'), W('2026-10-10', { type: 'PULL_A' }), withLabel(W('2026-10-09'), 'OLD NAME')]),
    wa_exerciseMods: J({ 'PUSH_A|Push-ups': { sets: 2 } }),
    wa_customExercises: J({ PUSH_A: [{ id: 'u_abc1', name: 'Pike Push-ups', type: 'REPS', sets: 3, target: 10 }] }),
    wa_settings: J({ keepAwake: false }), wa_accentTheme: J('blue'), wa_schemaVersion: '5',
  });
  const LEG = ['wa_history', 'wa_exerciseMods', 'wa_customExercises', 'wa_settings', 'wa_accentTheme'];
  const legacyBytes = (store) => J(LEG.map((k) => store[k]));
  const gens = (store) => Object.keys(store).filter((k) => /^wa_g\d+_/.test(k)).sort();
  const names9 = (c) => run(c, "Store.get('history').map(h=>h.type==='REST'?'REST':historySessionName(h))");
  const readGen = (c, n) => run(c, `dsReadGen(${n})`);
  const present = (list, c) => { const q = run(c, 'dsQuarantineGet()').map((x) => J(x.record)); const h = run(c, "Store.get('history')").map((x) => J(x)); return list.every((r) => h.includes(J(r)) || q.includes(J(r)) || h.some((x) => J(JSON.parse(x)) === J(r))); };

  // ---- migration ----
  const L0 = legacyStore(); let c9 = G(clone(L0));
  ok('migration: legacy data moves to generation 1 and the pointer names it', run(c9, 'DS.mode') === 'gen' && run(c9, 'DS.gen') === 1 && run(c9, 'DS.prev') === 0 && gens(c9.store).join() === 'wa_g1_config,wa_g1_history,wa_g1_plan,wa_g1_quarantine');
  ok('migration: the original keys are untouched byte for byte', legacyBytes(c9.store) === legacyBytes(L0));
  ok('migration: history, modifications, added exercises, settings, theme are all carried over', run(c9, "Store.get('history').length") === 4 && J(run(c9, "Store.get('exerciseMods')")) === J({ 'PUSH_A|Push-ups': { sets: 2 } }) && run(c9, "getCustoms('PUSH_A').length") === 1 && run(c9, "Store.get('settings').keepAwake") === false && run(c9, "Store.get('accentTheme')") === 'blue');
  ok('migration: every record keeps the session name it had (recorded label first, then the built-in name)', J(names9(c9)) === J(['PUSH A', 'REST', 'PULL A', 'OLD NAME']) && run(c9, "Store.get('history')[0].sessionId") === 'PUSH_A');
  const pl9 = readGen(c9, 1).plan;
  ok('migration: plan has the six sessions with their current names and order', J(pl9.sessions.map((s) => [s.id, s.name, s.order])) === J(['PUSH_A', 'PULL_A', 'LEGS_A', 'PUSH_B', 'PULL_B', 'LEGS_B'].map((id, i) => [id, run(c9, `EXERCISE_DB.${id}.label`), i])));
  const WU = run(c9, 'JSON.parse(JSON.stringify(WARMUP_DB))'), EDB = run(c9, 'JSON.parse(JSON.stringify(EXERCISE_DB))');
  ok('migration: every session keeps its current warm-up exercise by exercise (name and seconds), as its own copy', pl9.sessions.every((s) => J(s.warmup.items.map((w) => [w.name, w.duration])) === J(WU[EDB[s.id].warmup].map((w) => [w.name, w.duration]))) && pl9.sessions[0].warmup.items !== pl9.sessions[3].warmup.items);
  ok('migration: warm-up library holds each built-in routine', J(pl9.warmupLibrary.map((r) => r.name).sort()) === J(Object.keys(WU).sort()) && pl9.warmupLibrary.every((r) => r.items.every((w) => w.type === 'TIME')));
  const keysBefore = J(Object.keys(c9.store).sort()), c9b = G(clone(c9.store));
  ok('migration runs once: a second start changes nothing', J(Object.keys(c9b.store).sort()) === keysBefore && run(c9b, 'DS.gen') === 1 && J(c9b.store) === J(c9.store));
  const fresh = G({});
  ok('a new installation starts in generation mode with empty history', run(fresh, 'DS.mode') === 'gen' && run(fresh, "Store.get('history',[]).length") === 0 && balanced(run(fresh, 'renderHome()')));
  const legacy200 = []; for (let i = 0; i < 200; i++) legacy200.push(W(run(fresh, `addDaysStr('2026-10-13',${-i})`), { reps: 10 }));
  const cBig = G({ wa_history: J(legacy200), wa_schemaVersion: '5' });
  ok('migration condenses old details only in the NEW generation; the original keeps them', !run(cBig, "Store.get('history')[190].details") && !!JSON.parse(cBig.store.wa_history)[190].details && run(cBig, "Store.get('history').length") === 200);
  const cCorrupt = G({ wa_history: '{not json', wa_schemaVersion: '5' });
  ok('migration refuses to touch unreadable original data (stays in the original mode, nothing written)', run(cCorrupt, 'DS.mode') === 'legacy' && gens(cCorrupt.store).length === 0 && cCorrupt.store.wa_history === '{not json');

  // ---- interruption during migration ----
  const crashLoop = (build, act, check, label) => {
    let tested = 0, last = null;
    for (let k = 0; k < 80; k++) {
      let n = 0, crashed = false; const store = build();
      const o = { frozen: (key) => { if (!/^wa_/.test(key)) return false; if (n >= k) { crashed = true; return true; } n++; return false; } };
      const ctx = act(store, o); tested++; last = { k, crashed };
      check(clone(store), k, ctx);
      if (!crashed) break;
    }
    ok(label + ': interrupted at every write (' + tested + ' points) and the final run completed', tested >= 4 && last && last.crashed === false);
  };
  let migBad = [];
  crashLoop(() => clone(L0), (store, o) => G(store, o), (img, k) => {
    const r = G(clone(img));
    const h = run(r, "Store.get('history')");
    if (legacyBytes(img) !== legacyBytes(L0)) migBad.push('legacy changed @' + k);
    if (run(r, 'DS.mode') !== 'gen') migBad.push('no generation after restart @' + k);
    if (h.length !== 4 || J(names9(r)) !== J(['PUSH A', 'REST', 'PULL A', 'OLD NAME'])) migBad.push('history wrong @' + k);
    if (J(run(r, "Store.get('exerciseMods')")) !== J({ 'PUSH_A|Push-ups': { sets: 2 } })) migBad.push('mods wrong @' + k);
    if (legacyBytes(r.store) !== legacyBytes(L0)) migBad.push('legacy changed after restart @' + k);
  }, 'migration');
  ok('migration interruption: the original is never modified and the restart always ends with complete, equal data', migBad.length === 0, migBad.join('; '));

  // ---- pointer integrity at start-up ----
  const ptrOld = clone(c9.store); // generation 1
  const cA = G(clone(ptrOld)); run(cA, "saveHistoryEntry(" + J(W('2026-10-13')) + ")");
  const rr = run(cA, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('a restore creates generation 2 and keeps generation 1 as the previous one', rr.ok && run(cA, 'DS.gen') === 2 && run(cA, 'DS.prev') === 1 && !!cA.store.wa_ptr_bak && gens(cA.store).length === 8);
  const two = clone(cA.store);
  let r1 = G(Object.assign(clone(two), { wa_ptr: '{"v":1,"gen":2,"pr' }));
  ok('truncated pointer: the backup pointer is used and the notice is shown', run(r1, 'DS.mode') === 'gen' && run(r1, 'DS.gen') === 1 && run(r1, 'DS.notices[0].code') === 'POINTER_RECOVERED');
  r1 = G(Object.assign(clone(two), { wa_ptr: 'garbage', wa_ptr_bak: 'garbage' }));
  const degradedBefore = J(r1.store);
  ok('both pointers damaged: degraded mode reads the original data and writes nothing', run(r1, 'DS.mode') === 'degraded' && run(r1, "Store.get('history').length") === 4 && run(r1, "Store.setChecked('history', [])") === false && run(r1, "saveHistoryEntry(" + J(W('2026-10-14')) + ")") === false && J(r1.store) === degradedBefore);
  const damaged = clone(two); damaged.wa_g2_history = damaged.wa_g2_history.replace('"d":[', '"d":[null,');
  r1 = G(damaged);
  ok('a changed byte in a generation part fails its checksum: that generation is not used', run(r1, 'DS.mode') === 'gen' && run(r1, 'DS.gen') === 1);
  const missing = clone(two); delete missing.wa_g2_plan; r1 = G(missing);
  ok('a missing part: the pointer falls back to the backup pointer, nothing is invented', run(r1, 'DS.mode') === 'gen' && run(r1, 'DS.gen') === 1);
  const orphan = clone(two); orphan.wa_g3_history = '[]'; r1 = G(orphan);
  ok('an unfinished generation is reported, never used and never deleted', run(r1, 'DS.orphans.join()') === '3' && run(r1, 'DS.gen') === 2 && orphan.wa_g3_history === '[]' && r1.store.wa_g3_history === '[]');

  // ---- routine writes: verified, and finishWorkout never loses the workout ----
  const finishAll = (c) => { run(c, "selectSession('PUSH_A');startWorkoutFlow()"); run(c, "state.exerciseList.forEach((ex,i)=>{for(let s=1;s<=ex.sets;s++){state.curExerciseIdx=i;state.curSet=s;recordResult('completed',10+s)}})"); };
  let failNext = false, silent = false;
  const cF = G(clone(L0), { onWrite: (k, v) => { if (/_history$/.test(k) && failNext) { if (silent) return v.slice(0, -3); throw new Error('quota'); } } });
  finishAll(cF); const histBefore = cF.store.wa_g1_history; failNext = true;
  run(cF, 'finishWorkout()');
  ok('write failure: the workout is NOT cleared, the user is told, history is untouched', run(cF, 'state.saveFailed') !== null && !!run(cF, "Store.get('activeSession')") && cF.store.wa_g1_history === histBefore && run(cF, 'state.screen') !== 'complete');
  ok('the failure screen offers TRY AGAIN and COPY SUMMARY and is well-formed', run(cF, 'renderSaveFailed()').includes('WORKOUT NOT SAVED') && run(cF, 'renderSaveFailed()').includes('TRY AGAIN') && run(cF, 'renderSaveFailed()').includes('COPY SUMMARY') && balanced(run(cF, 'renderSaveFailed()')));
  failNext = false; run(cF, 'finishWorkout()');
  ok('TRY AGAIN saves exactly one record and then clears the running workout', run(cF, "Store.get('history').length") === 5 && run(cF, "Store.get('activeSession')") === null && run(cF, 'state.screen') === 'complete' && run(cF, 'state.saveFailed') === null);
  run(cF, 'finishWorkout()'); ok('finishing again never creates a duplicate record', run(cF, "Store.get('history').length") === 5);
  ok('the saved record carries the session id and the name at that time', run(cF, "Store.get('history')[0].sessionId") === 'PUSH_A' && run(cF, "Store.get('history')[0].sessionName") === 'PUSH A');
  const cS = G(clone(L0), { onWrite: (k, v) => { if (/_history$/.test(k) && silent) return v.slice(0, -3); } }); finishAll(cS); silent = true; run(cS, 'finishWorkout()');
  ok('a value that is stored differently from what was written counts as a failure too', run(cS, 'state.saveFailed') !== null && !!run(cS, "Store.get('activeSession')")); silent = false;
  let fl = false; const cLeg = make(NOW, clone(L0), { onWrite: (k) => { if (fl && k === 'wa_history') throw new Error('quota'); } });
  finishAll(cLeg); fl = true; run(cLeg, 'finishWorkout()');
  ok('the same protection applies before the upgrade (original storage mode)', run(cLeg, 'DS.mode') === 'legacy' && run(cLeg, 'state.saveFailed') !== null && !!run(cLeg, "Store.get('activeSession')"));
  const cNb = G({ wa_history: J(legacy200), wa_schemaVersion: '5' }); const dBefore = J(readGen(cNb, 1).history);
  run(cNb, "saveHistoryEntry(" + J(W('2026-10-14')) + ")"); const dAfter = readGen(cNb, 1).history;
  ok('generation mode: a routine save changes only the new record (nothing older is rewritten)', dAfter.length === 201 && J(dAfter.slice(1)) === dBefore);

  // ---- session names and the running workout ----
  const cR = G(clone(L0)); finishAll(cR); const act = cR.store.wa_activeSession ? JSON.parse(cR.store.wa_activeSession) : null;
  ok('a running workout stores its own session name and warm-up copy', act && act.sessionName === 'PUSH A' && act.warmupList.length === WU.PUSH.length);
  const planX = readGen(cR, 1).plan; planX.sessions[0].name = 'ZZ'; planX.sessions[0].warmup = null;
  run(cR, `Store.rawWrite(dsKey(1,'plan'), dsEnvelope(${J(planX)}))`);
  const cR2 = G(clone(cR.store)); run(cR2, 'resumeSession()');
  ok('changing the plan does not touch a running workout (name and warm-up come from its own snapshot)', run(cR2, 'state.sessionName') === 'PUSH A' && run(cR2, 'state.warmupList.length') === WU.PUSH.length);
  run(cR2, "state.exerciseList.forEach((ex,i)=>{for(let s=1;s<=ex.sets;s++){state.curExerciseIdx=i;state.curSet=s;recordResult('completed',9)}})"); run(cR2, 'finishWorkout()');
  ok('the finished workout is recorded under the name it had when it started', run(cR2, "Store.get('history')[0].sessionName") === 'PUSH A');
  run(cR2, "selectSession('PUSH_A');startWorkoutFlow()");
  ok('a new workout uses the plan as it is now: new name, no warm-up', run(cR2, 'state.sessionName') === 'ZZ' && run(cR2, 'state.warmupList.length') === 0);
  noThrow('a session without warm-up goes straight to the workout (no warm-up screen, no error)', () => { run(cR2, 'beginWarmupStep()'); if (run(cR2, 'state.screen') !== 'active') throw new Error('screen=' + run(cR2, 'state.screen')); });
  run(cR2, "state.warmupList=[{name:'A',duration:30},{name:'B',duration:45}];state.warmupIdx=0;beginWarmupStep()");
  ok('a session with a warm-up still shows it', run(cR2, 'state.screen') === 'warmup');
  const hOld = run(cR2, "Store.get('history')").find((h) => h.sessionName === 'OLD NAME');
  planX.sessions[0].deleted = true; run(cR2, `Store.rawWrite(dsKey(DS.gen,'plan'), dsEnvelope(${J(planX)}))`);
  ok('deleting or renaming a session never changes old records (name is read from the record)', run(cR2, `historySessionName(${J(hOld)})`) === 'OLD NAME' && run(cR2, "historySessionName({type:'GONE_X',sessionName:'My Split',date:'2026-10-01'})") === 'My Split');
  run(cR2, "goHistory()"); const hh = run(cR2, 'renderHistory()');
  ok('the history screen shows recorded names and stays well-formed', hh.includes('OLD NAME') && balanced(hh));
  ok('copy summary and export use the recorded name', run(cR2, `entryToText(${J(hOld)})`).includes('OLD NAME') && run(cR2, "buildProgressExport('all')").includes('OLD NAME'));
  const cW = G(clone(L0));
  const plW = readGen(cW, 1).plan; plW.sessions[0].warmup.items = [{ id: 'x1', name: 'Custom move', type: 'TIME', duration: 17 }]; run(cW, `Store.rawWrite(dsKey(1,'plan'), dsEnvelope(${J(plW)}))`);
  run(cW, "selectSession('PUSH_A');startWorkoutFlow()");
  ok('the warm-up is read from the session\'s own copy in the plan, not from data.js', run(cW, "state.warmupList.map(w=>w.name).join()") === 'Custom move' && run(cW, 'resolveWarmupDuration(state.warmupList[0])') === 17);

  // ---- exercises: no limit, duplicate names, in generation mode ----
  const cX = G(clone(L0)); run(cX, "selectSession('PUSH_A')");
  for (let i = 0; i < 14; i++) run(cX, `addCustomExercise('PUSH_A',{name:'Dips',type:'REPS',sets:3,target:10})`);
  const cX2 = G(clone(cX.store)); run(cX2, "selectSession('PUSH_A')");
  ok('generation mode: 15 added exercises (several named alike) persist across a restart, each with its own id', run(cX2, "getCustoms('PUSH_A').length") === 15 && new Set(run(cX2, 'state.exerciseList.map(e=>e.id)')).size === 22 && readGen(cX2, 1).plan.customExercises.PUSH_A.length === 15);

  // ---- Quarantine and the Recovery Center ----
  const baseRec = () => { const c = G(clone(L0)); run(c, "saveHistoryEntry(" + J(W('2026-10-13')) + ")"); run(c, "saveHistoryEntry(" + J(W('2026-10-14', { type: 'LEGS_A' })) + ")"); return c; };
  const cB = baseRec(), snapB = clone(cB.store);
  let wcount = 0, rcount = 0; const cDry = G(clone(snapB), { onWrite: () => { wcount++; }, onRemove: () => { rcount++; } });
  const w0 = wcount, r0 = rcount, imgBefore = J(cDry.store);
  const dryLeg = run(cDry, "recoveryDryRun({kind:'legacy'})");
  ok('Dry Run (original data as source): reads only, nothing written or removed, every key identical', dryLeg.ok && wcount === w0 && rcount === r0 && J(cDry.store) === imgBefore);
  ok('Dry Run classifies history: 4 stay, 4 identical copies ignored, the 2 newer records go to Quarantine', dryLeg.counts.stay === 4 && dryLeg.counts.identical === 4 && dryLeg.counts.quarantine === 2 && dryLeg.counts.notInSource === 2 && dryLeg.qItems.every((x) => x.reason === 'NOT_IN_SOURCE'));
  ok('Dry Run Before / After rows cover plan, history, quarantine, settings and theme', J(dryLeg.rows.map((r) => r.section)) === J(['Plan', 'History', 'Quarantine', 'Settings', 'Theme']) && dryLeg.rows[1].before === '6 records' && dryLeg.rows[1].after === '4 records' && dryLeg.rows[2].after === '2 items');
  ok('Dry Run keeps a complete text of the details (every record, every change)', dryLeg.detailsText.includes('QUARANTINE (NOT_IN_SOURCE)') && dryLeg.detailsText.split('\n').filter((l) => /^STAY \|/.test(l)).length === 4 && dryLeg.detailsText.includes('History: 4 stay'));
  ok('every record of the current data and the source is accounted for (new history or Quarantine)', run(cDry, 'dsConserved(Store.get("history"), dsLegacyState().parts.history, recoveryDryRun({kind:"legacy"}).cls)') === true);
  const dryGen = run(cDry, "recoveryDryRun({kind:'generation', gen: 1})");
  ok('Dry Run for the current generation reports no change', dryGen.ok && dryGen.rows.every((r) => r.status === 'SAME') && dryGen.counts.quarantine === 0 && dryGen.counts.identical === 6);
  ok('Dry Run refuses a missing or damaged source and writes nothing', run(cDry, "recoveryDryRun({kind:'generation', gen: 9})").errors[0] === 'SOURCE_UNREADABLE' && J(cDry.store) === imgBefore);

  const cH = G(clone(snapB)), hashA = run(cH, "recoveryDryRun({kind:'legacy'})").hash; run(cH, "saveHistoryEntry(" + J(W('2026-10-20')) + ")");
  ok('the Dry Run fingerprint depends on the data it saw (it changes when the data changes)', run(cH, "recoveryDryRun({kind:'legacy'})").hash !== hashA && run(cH, "recoveryDryRun({kind:'legacy'})").hash === run(cH, "recoveryDryRun({kind:'legacy'})").hash);
  const cApply = G(clone(snapB));
  run(cApply, "Store.set('settings', {keepAwake: true, alertSound: false})");
  const preGen = clone(cApply.store), dryB = run(cApply, "recoveryDryRun({kind:'legacy'})");
  const ap = run(cApply, `recoveryApply({kind:'legacy'}, ${J(dryB.hash)}, 'RESTORE')`);
  ok('restore commits: new generation, previous generation byte-identical, history/settings/plan come from the source', ap.ok && run(cApply, 'DS.gen') === 2 && cApply.store.wa_g1_history === preGen.wa_g1_history && cApply.store.wa_g1_plan === preGen.wa_g1_plan && cApply.store.wa_g1_config === preGen.wa_g1_config && run(cApply, "Store.get('history').length") === 4 && run(cApply, "Store.get('settings').keepAwake") === false);
  ok('the moved records are in Quarantine, complete and unchanged', run(cApply, 'dsQuarantineGet().length') === 2 && present([W('2026-10-13'), W('2026-10-14', { type: 'LEGS_A' })].map((x) => run(cApply, `dsBackfillRecord(${J(x)})`)), cApply));
  const rep = JSON.parse(cApply.store.wa_recovery_last);
  ok('Recovery Report: stored after the operation with outcome, generations, sections, counts and checks', rep.outcome === 'COMMITTED' && rep.genBefore === 1 && rep.genAfter === 2 && rep.counts.quarantine === 2 && rep.rows.length === 5 && rep.integrity.every((x) => x.ok) && rep.saved === true);
  ok('the report text lists the result, counts and checks', run(cApply, `dsReportText(${J(rep)})`).includes('Result: COMMITTED') && run(cApply, `dsReportText(${J(rep)})`).includes('2 moved to Quarantine'));
  const stale = run(cApply, `recoveryApply({kind:'legacy'}, 'deadbeef:1', 'RESTORE')`);
  ok('a changed preview is refused: nothing is written', stale.ok === false && stale.report.reason === 'CHANGED_SINCE_PREVIEW' && run(cApply, 'DS.gen') === 2);
  ok('only the LAST report is kept (the next operation replaces it)', JSON.parse(cApply.store.wa_recovery_last).outcome === 'ABORTED');
  const gensNow = gens(cApply.store).join();
  ok('nothing is deleted automatically: both generations, the original keys and the Quarantine are still there', gensNow.includes('wa_g1_plan') && gensNow.includes('wa_g2_plan') && legacyBytes(cApply.store) === legacyBytes(L0) && run(cApply, 'dsQuarantineGet().length') === 2);

  // interruption and failure at every write of an apply
  let recBad = [];
  const beforeRecs = run(baseRec(), "Store.get('history')");
  crashLoop(() => clone(snapB), (store, o) => { const c = G(store, o); run(c, "recoveryApply({kind:'legacy'}, null, 'RESTORE')"); return c; }, (img, k) => {
    const r = G(clone(img)); const hh2 = run(r, "Store.get('history')");
    const gen = run(r, 'DS.gen');
    if (gen === 1 && (img.wa_g1_history !== snapB.wa_g1_history || img.wa_g1_plan !== snapB.wa_g1_plan || img.wa_g1_config !== snapB.wa_g1_config || img.wa_ptr !== snapB.wa_ptr)) recBad.push('generation 1 changed @' + k);
    if (gen === 2 && (hh2.length !== 4 || run(r, 'dsQuarantineGet().length') !== 2)) recBad.push('generation 2 incomplete @' + k);
    if (gen !== 1 && gen !== 2) recBad.push('unexpected generation ' + gen + ' @' + k);
    if (!present(beforeRecs, r)) recBad.push('a record is missing @' + k);
    if (legacyBytes(img) !== legacyBytes(snapB)) recBad.push('original keys changed @' + k);
  }, 'restore');
  ok('restore interruption: the restart is always generation 1 exactly as before, or complete generation 2; no record is ever missing', recBad.length === 0, recBad.join('; '));
  let failBad = [], failedAt = 0;
  for (let k = 0; k < 40; k++) {
    let n = 0, failed = false; const store = clone(snapB);
    const c = G(store, { onWrite: (key) => { if (!/^wa_/.test(key)) return; if (n++ === k) { failed = true; throw new Error('disk'); } } });
    const out = run(c, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
    if (!failed) break; if (out.report.outcome === 'COMMITTED') break;
    failedAt++;
    const a = clone(store), b = clone(snapB); delete a.wa_recovery_last;
    if (J(Object.keys(a).sort().map((x) => [x, a[x]])) !== J(Object.keys(b).sort().map((x) => [x, b[x]]))) failBad.push('store changed after failure @' + k);
    if (out.report.outcome !== 'FAILED') failBad.push('outcome ' + out.report.outcome + ' @' + k);
  }
  ok('a failed write before the pointer switch leaves EVERY key as it was (' + failedAt + ' failure points), outcome FAILED', failBad.length === 0 && failedAt >= 5, failBad.join('; '));
  const cRep = G(clone(snapB), { onWrite: (key) => { if (key === 'wa_recovery_last') throw new Error('disk'); } }); const outRep = run(cRep, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('if the report itself cannot be saved the operation result is unchanged and the report is returned for copying', outRep.ok === true && outRep.report.saved === false && run(cRep, 'DS.gen') === 2);

  // storage space
  const cSp = G(clone(snapB)); const need = run(cSp, "recoveryDryRun({kind:'legacy'})").space;
  cSp.WA_STORAGE_LIMIT_CHARS = Math.floor((need.used + need.needed - 1) / 0.95); const spBefore = J(cSp.store);
  const dSp = run(cSp, "recoveryDryRun({kind:'legacy'})"), aSp = run(cSp, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('not enough space: Dry Run says so, apply is refused as a whole and nothing changes', dSp.ok === false && dSp.errors[0] === 'NOT_ENOUGH_SPACE' && aSp.ok === false && aSp.report.reason === 'NOT_ENOUGH_SPACE' && J(Object.keys(cSp.store).filter((k) => k !== 'wa_recovery_last').sort().map((k) => cSp.store[k])) === J(Object.keys(JSON.parse(spBefore)).sort().map((k) => JSON.parse(spBefore)[k])));
  ok('the space message tells the user what to do', run(cSp, "(state.screen='settings',openDataSafety(),dsStartRecovery({kind:'legacy'}),renderDataSafety())").includes('NOT ENOUGH STORAGE SPACE'));
  // the 1500 limit during a recovery: overflow goes to Quarantine, or everything is refused
  const big = []; for (let i = 0; i < 1600; i++) big.push(W(run(fresh, `addDaysStr('2024-01-01',${i})`), { reps: 10, type: 'PULL_B' }));
  const bigStore = clone(snapB); bigStore.wa_history = J(big);
  const cBg = G(bigStore); const t0 = Date.now(); const dBg = run(cBg, "recoveryDryRun({kind:'legacy'})"); const ms = Date.now() - t0;
  console.log('INFO 1600-record Dry Run: ' + ms + ' ms, ' + Math.round(dBg.space.needed / 1024) + ' KB needed, ' + Math.round(dBg.space.used / 1024) + ' KB used');
  ok('over the 1500 limit: the 1500 newest stay, the 100 oldest and the 6 current records not in the source go to Quarantine (nothing is dropped)', dBg.ok && dBg.counts.stay === 1500 && dBg.counts.overflow === 100 && dBg.counts.quarantine === 106 && dBg.qItems.filter((x) => x.reason === 'OVERFLOW_OVER_LIMIT').length === 100 && run(cBg, 'dsConserved(Store.get("history"), dsLegacyState().parts.history, recoveryDryRun({kind:"legacy"}).cls)') === true);
  cBg.WA_STORAGE_LIMIT_CHARS = Math.floor((dBg.space.used + dBg.space.needed - 1) / 0.95); const bgBefore = J(cBg.store);
  const aBg = run(cBg, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('if the moved records do not fit, the WHOLE operation is refused before any write', aBg.ok === false && aBg.report.reason === 'NOT_ENOUGH_SPACE' && J(Object.keys(cBg.store).filter((k) => k !== 'wa_recovery_last').sort().map((k) => cBg.store[k])) === J(Object.keys(JSON.parse(bgBefore)).sort().map((k) => JSON.parse(bgBefore)[k])) && run(cBg, 'dsQuarantineGet().length') === 0);
  cBg.WA_STORAGE_LIMIT_CHARS = undefined; const aBg2 = run(cBg, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('with enough space the same restore completes and Quarantine holds the 106 records', aBg2.ok && run(cBg, 'dsQuarantineGet().length') === 106 && run(cBg, "Store.get('history').length") === 1500);

  // a running workout blocks the commit but never the review
  const cRun = G(clone(snapB)); finishAll(cRun); const runBefore = J(cRun.store);
  const dRun = run(cRun, "recoveryDryRun({kind:'legacy'})"), aRun = run(cRun, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('workout running: the Dry Run works, the commit is blocked, nothing changes', dRun.ok && dRun.blocked === 'WORKOUT_RUNNING' && aRun.ok === false && aRun.report.reason === 'WORKOUT_RUNNING' && run(cRun, 'DS.gen') === 1);
  ok('the summary screen disables CONTINUE while a workout is running', /<button class="primary-btn" disabled onclick="dsConfirmStep\(\)"/.test(run(cRun, "(state.screen='settings',openDataSafety(),dsStartRecovery({kind:'legacy'}),renderDataSafety())")));

  // conflicts, invalid and unknown sessions in a backup
  const cI = G(clone(L0)); const own = run(cI, "Store.get('history')")[0];
  const conflict = Object.assign(clone(own), { durationSeconds: 1 });
  const fileHist = [conflict, W('2026-09-01'), W('2026-09-01'), { type: 'PUSH_A', date: 'bad', status: 'COMPLETED' }, Object.assign(W('2026-09-02', { type: 'MY_SPLIT_1' }), { sessionName: 'My Split' }), W('2026-09-03', { type: 'NO_NAME_X' }), 'junk'];
  const bk9 = J({ app: 'WorkoutApp', schemaVersion: 5, data: { history: fileHist } });
  const planI = run(cI, `buildImportPlan(${J(bk9)})`); const dI = run(cI, `recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(bk9)})})`);
  ok('import: unknown session ids are accepted when the record carries its own name, otherwise quarantined', !planI.error && dI.ok && dI.cls.stay.some((h) => h.sessionName === 'My Split') && dI.qItems.some((x) => x.reason === 'INVALID_IN_SOURCE' && x.record && x.record.type === 'NO_NAME_X'));
  ok('import: a conflicting version keeps the file\'s record and quarantines the current one; identical duplicates are ignored once', dI.qItems.some((x) => x.reason === 'CONFLICT_CURRENT_VERSION') && dI.counts.identical >= 1 && dI.counts.notInSource === 3);
  ok('import: every record of the file and of the current data is accounted for', run(cI, `dsConserved(Store.get('history'), ${J(fileHist)}, recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(bk9)})}).cls)`) === true);
  ok('import of an unusable file still cannot wipe history', run(cI, `buildImportPlan(${J(J({ app: 'WorkoutApp', data: { history: [{ type: 'X', date: '2026-02-30', status: 'COMPLETED' }] } }))})`).error === 'NO VALID RECORDS');
  const ex1 = run(cApply, 'buildBackup()'), exo = JSON.parse(ex1);
  ok('the full export carries the plan and the Quarantine', exo.data.plan.sessions.length === 6 && exo.data.quarantine.length === 2 && exo.data.history.length === 4);
  const cMove = G({}); const planM = run(cMove, `buildImportPlan(${J(ex1)})`);
  const rm1 = run(cMove, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(ex1)})}, null, 'IMPORT')`);
  ok('moving to another install: history, plan and Quarantine arrive, with a report', !planM.error && rm1.ok && run(cMove, "Store.get('history').length") === 4 && run(cMove, 'dsQuarantineGet().length') === 2 && run(cMove, "Store.get('exerciseMods')") !== undefined);
  const rm2 = run(cMove, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(ex1)})}, null, 'IMPORT')`);
  ok('importing the same file again never duplicates records or Quarantine items', rm2.ok && run(cMove, "Store.get('history').length") === 4 && run(cMove, 'dsQuarantineGet().length') === 2);
  const dTh = run(cMove, `recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(J({ app: 'WorkoutApp', data: { settings: { keepAwake: true }, accentTheme: 'yellow' } }))})})`);
  ok('import of settings and theme only: those sections change, History and Plan are kept as they are', dTh.ok && dTh.rows[1].status === 'KEPT' && dTh.rows[3].status === 'CHANGES' && dTh.rows[4].status === 'CHANGES' && dTh.rows[0].status === 'SAME');

  // generations list and manual deletion
  const lst = run(cApply, 'dsListGenerations()');
  ok('the generations list shows original data, generation 1 (previous) and generation 2 (in use)', J(lst.map((g) => [g.gen, g.role])) === J([[0, 'ORIGINAL'], [1, 'PREVIOUS'], [2, 'CURRENT']]));
  ok('the current and the previous generation cannot be deleted', run(cApply, 'dsCanDelete(2)') === false && run(cApply, 'dsCanDelete(1)') === false && run(cApply, 'dsDeleteGeneration(2)') === false && !!cApply.store.wa_g2_plan);
  const cMany = G(clone(cApply.store)); for (let i = 0; i < 2; i++) run(cMany, "recoveryApply({kind:'generation', gen: DS.gen - 1}, null, 'RESTORE')");
  ok('older generations and the original keys become deletable only once they are older than the previous one', run(cMany, 'DS.gen') === 4 && run(cMany, 'dsCanDelete(1)') === true && run(cMany, 'dsCanDelete(0)') === true && run(cMany, 'dsCanDelete(3)') === false);
  const k1 = run(cMany, 'dsDeleteGeneration(1)'); ok('deleting an old generation removes only that one', k1 === true && !cMany.store.wa_g1_plan && !!cMany.store.wa_g2_plan && !!cMany.store.wa_g3_plan && !!cMany.store.wa_g4_plan);

  // screens
  const cU = G(clone(cApply.store)); run(cU, "state.screen='settings';openDataSafety()");
  const uiMain = run(cU, 'renderDataSafety()');
  ok('DATA SAFETY shows the generation in use, the list, storage, last export and the actions', uiMain.includes('DATA SAFETY') && uiMain.includes('generation 2') && uiMain.includes('GENERATION 1') && uiMain.includes('ORIGINAL DATA') && uiMain.includes('Storage used') && uiMain.includes('QUARANTINE (2)') && uiMain.includes('EXPORT BACKUP') && uiMain.includes('IMPORT BACKUP') && balanced(uiMain));
  run(cU, "dsRestoreGen(1)"); const uiSum = run(cU, 'renderDataSafety()');
  ok('the review screen shows Before / After, history counts and what is kept', uiSum.includes('REVIEW RESTORE') && uiSum.includes('WILL CHANGE') && uiSum.includes('stay in History') && uiSum.includes('Quarantine') && uiSum.includes('COPY DETAILS') && balanced(uiSum));
  run(cU, 'dsCopyDetails()'); ok('COPY DETAILS copies the complete text', cU.copied.length === 1 && cU.copied[0].includes('Generation 3'));
  run(cU, 'dsConfirmStep()'); const uiConf = run(cU, 'renderDataSafety()');
  ok('a second confirmation screen follows (two steps before anything is written)', uiConf.includes('RESTORE NOW?') && run(cU, 'DS.gen') === 2 && balanced(uiConf));
  const bridgeBack = (c) => run(c, 'state.importOpen ? (state.importPreview ? (backToImportEdit(), "step") : (closeImport(), "closed")) : "none"');
  ok('Android Back steps back through confirm, review and DATA SAFETY, then closes', bridgeBack(cU) === 'step' && run(cU, 'state.ds.view') === 'summary' && bridgeBack(cU) === 'step' && run(cU, 'state.ds.view') === 'main' && bridgeBack(cU) === 'closed' && run(cU, 'state.importOpen') === false && run(cU, 'state.dsOpen') === false);
  run(cU, "openDataSafety();dsRestoreGen(1);dsConfirmStep();dsExecute()"); const uiRep = run(cU, 'renderDataSafety()');
  ok('after RESTORE the report is shown (result, sections, checks) and can be copied', uiRep.includes('RECOVERY REPORT') && uiRep.includes('COMMITTED') && uiRep.includes('Report saved') && run(cU, 'DS.gen') === 3 && balanced(uiRep));
  ok('Back from the report closes everything', bridgeBack(cU) === 'step' && run(cU, 'state.importOpen') === false);
  run(cU, "openDataSafety();dsViewLastReport()"); ok('LAST REPORT shows the stored report', run(cU, 'renderDataSafety()').includes('RECOVERY REPORT') && run(cU, 'dsLastReport().genAfter') === 3);
  run(cU, "closeImport();openDataSafety();dsNav('quarantine')"); const uiQ = run(cU, 'renderDataSafety()');
  ok('Quarantine screen lists the items and offers COPY ALL and a two-tap DELETE ALL', uiQ.includes('QUARANTINE') && uiQ.includes('COPY ALL') && uiQ.includes('DELETE ALL') && balanced(uiQ));
  run(cU, 'dsCopyQuarantine()'); run(cU, 'dsQuarantineStep()'); const qStill = run(cU, 'dsQuarantineGet().length'); run(cU, 'dsQuarantineStep()');
  ok('DELETE ALL needs a second tap and only then removes the items', qStill === 2 && run(cU, 'dsQuarantineGet().length') === 0 && cU.copied.length === 2 && cU.copied[1].includes('NOT_IN_SOURCE'));
  const cImp = G(clone(L0)); run(cImp, "state.screen='settings';openImport()");
  ok('IMPORT BACKUP opens the Recovery Center import step, and the review comes before any write', run(cImp, 'state.dsOpen') === true && run(cImp, 'state.ds.view') === 'import' && run(cImp, 'renderDataSafety()').includes('import-input'));
  cImp.setField('import-input', bk9); const impBefore = J(cImp.store); run(cImp, 'applyImport()');
  ok('importing from Settings shows the review (Dry Run) and changes nothing yet', run(cImp, 'state.ds.view') === 'summary' && run(cImp, 'renderDataSafety()').includes('REVIEW IMPORT') && J(cImp.store) === impBefore);
  run(cImp, 'dsConfirmStep();dsExecute()'); ok('after confirming, the import is applied as one new generation', run(cImp, 'DS.gen') === 2 && run(cImp, "Store.get('history').length") === 3);

  // settings screen
  const sh = run(G(clone(L0)), 'renderSettings()');
  ok('Settings has a DATA SAFETY row in the DATA group', sh.indexOf('DATA SAFETY') > sh.indexOf('settings-group-title">DATA') && sh.includes('openDataSafety()'));
  ok('every Phase 2 settings function is still present (toggles, Theme Studio, Advanced, Customization, export, import)', ['toggleSetting', 'goThemeStudio', 'goAdvancedSettings', 'goCustomMods', 'exportData', 'openImport'].every((f) => sh.includes(f + '(')));
  // routine settings/theme writes in generation mode
  const cT = G(clone(L0)); run(cT, "toggleSetting('keepAwake')"); const cT2 = G(clone(cT.store));
  ok('a setting changed in generation mode is stored in the generation and survives a restart; the original keys stay untouched', run(cT2, "Store.get('settings').keepAwake") === true && readGen(cT2, 1).config.settings.keepAwake === true && legacyBytes(cT2.store) === legacyBytes(L0));
  run(cT, "Store.set('accentTheme','yellow')"); ok('theme storage works through the generation', run(G(clone(cT.store)), "Store.get('accentTheme')") === 'yellow');
  // full backup / import round trip in generation mode
  const cRt = G(clone(L0)); run(cRt, "saveHistoryEntry(" + J(W('2026-10-13')) + ")"); const bkRt = run(cRt, 'buildBackup()'); const cRt2 = G({});
  run(cRt2, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(bkRt)})}, null, 'IMPORT')`);
  ok('backup round trip in generation mode: history, modifications, added exercises, settings and theme are equal', J(run(cRt2, "Store.get('history')").map((h) => h.date + h.type)) === J(run(cRt, "Store.get('history')").map((h) => h.date + h.type)) && J(run(cRt2, "Store.get('exerciseMods')")) === J(run(cRt, "Store.get('exerciseMods')")) && run(cRt2, "getCustoms('PUSH_A').length") === 1 && run(cRt2, "Store.get('settings').keepAwake") === false && run(cRt2, "Store.get('accentTheme')") === 'blue');
  // in-memory preview (no localStorage): nothing breaks, nothing claims to be safe
  ok('smoke: all main screens render in generation mode without errors', ['goHome()', 'goSettings()', 'goHistory()', 'goProgress()', 'goCustomMods()', "selectSession('LEGS_B')"].every((f) => { try { run(cRt, f); const h = run(cRt, 'document.getElementById("app").innerHTML'); return !/undefined|NaN/.test(h); } catch (e) { return false; } }));

  // =====================================================================
  console.log('\n== 10. CORRECTION PASS: envelopes, plan section, validated migration, schema 6, atomic Quarantine, degraded recovery ==');
  const wroteKeys = (store, o, act) => { const keys = []; const c = G(store, Object.assign({ onWrite: (k) => { if (/^wa_/.test(k)) keys.push(k); } }, o || {})); const n0 = keys.length; act(c); return keys.slice(n0); };
  const genNums = (store) => Array.from(new Set(Object.keys(store).map((k) => (/^wa_g(\d+)_plan$/.exec(k) || [])[1]).filter(Boolean))).map(Number).sort((a, b) => a - b);
  const bigRec = () => { const r = W('2026-08-01'); r.details.padding = 'x'.repeat(70 * 1024); return r; };

  // ---- 1. both backup envelopes (WorkoutApp and WOH), strict structure and version ----
  const envPlan = (c, o) => run(c, `buildImportPlan(${J(J(o))})`);
  for (const [label, mk9] of [['original storage', () => make(NOW, {}, { legacy: true })], ['generation storage', () => G({})]]) {
    const ce = mk9();
    ok(label + ': a backup with the old name WorkoutApp is accepted', !envPlan(ce, { app: 'WorkoutApp', schemaVersion: 5, data: { settings: { keepAwake: true } } }).error);
    ok(label + ': a backup with the new name WOH is accepted', !envPlan(ce, { app: 'WOH', schemaVersion: 6, data: { settings: { keepAwake: true } } }).error);
    ok(label + ': a backup without a version number (very old) is still accepted', !envPlan(ce, { app: 'WorkoutApp', data: { settings: { keepAwake: true } } }).error);
    ok(label + ': other or malformed names are refused', [{ app: 'Other' }, { app: 'woh' }, { app: 'WOHX' }, { app: '' }, { app: null }, {}, { app: ['WOH'] }].every((e) => envPlan(ce, Object.assign({ schemaVersion: 5, data: { settings: { keepAwake: true } } }, e)).error === 'INVALID BACKUP'));
    ok(label + ': a missing or malformed data section is refused for both names', ['WOH', 'WorkoutApp'].every((app) => [undefined, null, [], 'x', 5].every((d) => envPlan(ce, { app, schemaVersion: 5, data: d }).error === 'INVALID BACKUP')));
    ok(label + ': a version from a newer app or a damaged version number is refused for both names', ['WOH', 'WorkoutApp'].every((app) => [7, 99, 0, -1, 5.5, '6', null, true].every((v) => envPlan(ce, { app, schemaVersion: v, data: { settings: { keepAwake: true } } }).error === 'UNSUPPORTED BACKUP VERSION')));
    ok(label + ': versions 1 to 6 are accepted for both names', ['WOH', 'WorkoutApp'].every((app) => [1, 2, 3, 4, 5, 6].every((v) => !envPlan(ce, { app, schemaVersion: v, data: { settings: { keepAwake: true } } }).error)));
  }
  const cEnv = G(clone(L0));
  const woh = J({ app: 'WOH', schemaVersion: 6, data: { history: [W('2026-09-05')], accentTheme: 'yellow' } }), wa = J({ app: 'WorkoutApp', schemaVersion: 5, data: { history: [W('2026-09-06')], accentTheme: 'red' } });
  const e1 = run(cEnv, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(woh)})}, null, 'IMPORT')`), e2 = run(cEnv, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(wa)})}, null, 'IMPORT')`);
  ok('both envelopes import end to end into generation storage (WOH, then the old WorkoutApp)', e1.ok && e2.ok && run(cEnv, "Store.get('history')[0].date") === '2026-09-06' && run(cEnv, "Store.get('accentTheme')") === 'red' && run(cEnv, 'DS.gen') === 3);
  ok('an old WorkoutApp backup is converted on import: records get their session name', run(cEnv, "Store.get('history')[0].sessionName") === 'PUSH A');

  // ---- 2. an invalid Plan section never blocks the valid sections ----
  const okPlan = () => clone(readGen(G(clone(L0)), 1).plan);
  const goodFile = (extra) => J({ app: 'WOH', schemaVersion: 6, data: Object.assign({ history: [W('2026-09-05')], settings: { keepAwake: true }, accentTheme: 'yellow' }, extra) });
  const badPlans = { 'not an object': 'x', 'no sessions': { sessions: [] }, 'more than 12 sessions': { sessions: Array.from({ length: 13 }, (_, i) => ({ id: 'S' + i, name: 'N' + i, warmup: null })) },
    'duplicate id': { sessions: [{ id: 'A', name: 'One', warmup: null }, { id: 'A', name: 'Two', warmup: null }] }, 'duplicate name': { sessions: [{ id: 'A', name: 'Same', warmup: null }, { id: 'B', name: 'Same', warmup: null }] },
    'name over 24 characters': { sessions: [{ id: 'A', name: 'x'.repeat(25), warmup: null }] }, 'bad warm-up time': { sessions: [{ id: 'A', name: 'One', warmup: { sourceId: 'x', sourceName: 'x', items: [{ name: 'Move', duration: 0 }] } }] } };
  const planReason = { 'not an object': 'PLAN_NOT_AN_OBJECT', 'no sessions': 'SESSIONS_MISSING_OR_OVER_12', 'more than 12 sessions': 'SESSIONS_MISSING_OR_OVER_12', 'duplicate id': 'SESSION_ID_INVALID_OR_DUPLICATE', 'duplicate name': 'SESSION_NAME_INVALID_OR_DUPLICATE', 'name over 24 characters': 'SESSION_NAME_INVALID_OR_DUPLICATE', 'bad warm-up time': 'WARMUP_INVALID' };
  Object.keys(badPlans).forEach((k) => {
    const cP = G(clone(L0)), before = clone(cP.store), pl0 = J(readGen(cP, 1).plan.sessions);
    const pl = run(cP, `buildImportPlan(${J(goodFile({ plan: badPlans[k] }))})`), d = run(cP, `recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: badPlans[k] }))})})`);
    ok('invalid Plan (' + k + '): refused on its own, the other sections stay importable, reason is ' + planReason[k], !pl.error && pl.report.planIgnored === planReason[k] && !('plan' in pl.next) && d.ok && d.ignored.length === 1 && d.ignored[0].reason === planReason[k] && d.rows[0].status === 'SAME' && d.rows[1].status === 'CHANGES' && d.rows[3].status === 'CHANGES' && d.rows[4].status === 'CHANGES');
    if (k === 'duplicate name') {
      const keys = []; const cA = G(clone(before), { onWrite: (key) => { if (/^wa_/.test(key)) keys.push(key); } });
      const out = run(cA, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: badPlans[k] }))})}, null, 'IMPORT')`);
      ok('invalid Plan: the valid data is imported as ONE new generation; the current Plan is unchanged', out.ok && J(genNums(cA.store)) === '[1,2]' && J(readGen(cA, 2).plan.sessions) === pl0 && J(readGen(cA, 2).plan.warmupLibrary) === J(readGen(cA, 1).plan.warmupLibrary) && run(cA, "Store.get('history')[0].date") === '2026-09-05' && run(cA, "Store.get('settings').keepAwake") === true && run(cA, "Store.get('accentTheme')") === 'yellow');
      ok('invalid Plan: every write belongs to the one new generation (no separate section writes, no original keys touched)', keys.every((x) => /^wa_g2_(plan|history|config|quarantine)$/.test(x) || ['wa_ptr', 'wa_ptr_bak', 'wa_recovery_last'].includes(x)) && keys.filter((x) => x === 'wa_ptr').length === 1 && legacyBytes(cA.store) === legacyBytes(L0));
      ok('invalid Plan: the report states that Plan was ignored and why, and the review screen shows it', out.report.ignored.length === 1 && run(cA, `dsReportText(${J(out.report)})`).includes('Ignored: Plan (SESSION_NAME_INVALID_OR_DUPLICATE)') && JSON.parse(cA.store.wa_recovery_last).ignored[0].section === 'Plan' && run(cA, `(state.screen='settings',openDataSafety(),dsStartRecovery({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: badPlans[k] }))})}),renderDataSafety())`).includes('Plan was ignored'));
    }
  });
  ok('a file whose only section is an invalid Plan is refused with a clear message', run(G({}), `buildImportPlan(${J(J({ app: 'WOH', schemaVersion: 6, data: { plan: badPlans['no sessions'] } }))})`).error === 'NOTHING VALID TO IMPORT');
  const newNames = okPlan(); newNames.sessions[0].name = 'MY PUSH';
  const cPv = G(clone(L0)); run(cPv, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: newNames }))})}, null, 'IMPORT')`);
  ok('a valid Plan section is applied together with the others', readGen(cPv, 2).plan.sessions[0].name === 'MY PUSH' && run(cPv, "Store.get('accentTheme')") === 'yellow');

  // ---- 3. the migration checks every old record; nothing is dropped silently ----
  const dirty = [W('2026-10-12'), R('2026-10-11'), W('2026-10-12'), { type: 'PUSH_A', date: '2026-02-30', status: 'COMPLETED', startedAt: 5 }, { type: 'PUSH_A', date: '2026-10-05', status: 'ABANDONED', startedAt: 6 },
    { type: 'NOT_A_SESSION', date: '2026-10-04', status: 'COMPLETED', startedAt: 7 }, 'junk', null, 7, bigRec(), { type: 'bad type!', date: '2026-10-03', status: 'COMPLETED' }, W('2026-10-10', { type: 'PULL_A' })];
  const dirtyStore = () => Object.assign(legacyStore(), { wa_history: J(dirty) });
  const cD = G(dirtyStore()), qD = run(cD, 'dsQuarantineGet()'), metaD = readGen(cD, 1).plan.meta;
  ok('migration: valid records are kept (2 workouts, 1 rest; the identical duplicate is counted, not silently lost)', run(cD, "Store.get('history').length") === 3 && metaD.migration.total === 12 && metaD.migration.kept === 3 && metaD.migration.identicalIgnored === 1 && metaD.migration.quarantined === 8);
  const byDetail = {}; qD.forEach((x) => { byDetail[x.detail] = (byDetail[x.detail] || 0) + 1; });
  ok('migration: every refused record is in Quarantine with its reason (date, status, session id, not an object, size)', qD.length === 8 && byDetail.BAD_DATE === 1 && byDetail.BAD_STATUS === 1 && byDetail.UNKNOWN_SESSION === 1 && byDetail.NOT_AN_OBJECT === 3 && byDetail.BAD_SESSION_ID === 1 && byDetail.RECORD_TOO_LARGE === 1 && qD.every((x) => x.reason === 'INVALID_IN_SOURCE' && x.source === 'Migration'));
  ok('migration: Quarantine keeps the raw data of each refused record (including the one over 64 KB) exactly', qD.some((x) => J(x.record) === J(dirty[3])) && qD.some((x) => x.record === 'junk') && qD.some((x) => x.record === null) && qD.some((x) => J(x.record) === J(dirty[9]) && JSON.stringify(x.record).length > 64 * 1024));
  ok('migration: the original keys stay byte for byte; the DATA SAFETY screen tells the user what moved', legacyBytes(cD.store) === legacyBytes(Object.assign(dirtyStore())) && run(cD, "(state.screen='settings',openDataSafety(),renderDataSafety())").includes('moved 8 of 12 old records to Quarantine'));
  const cDa = G(Object.assign(legacyStore(), { wa_history: J(dirty.slice(3, 10)) }));
  ok('migration with no valid record at all still completes: empty History, everything in Quarantine', run(cDa, 'DS.mode') === 'gen' && run(cDa, "Store.get('history').length") === 0 && run(cDa, 'dsQuarantineGet().length') === 7);
  const many1600 = []; for (let i = 0; i < 1600; i++) many1600.push(W(run(fresh, `addDaysStr('2024-01-01',${i})`), { reps: 10 }));
  const cO = G(Object.assign(legacyStore(), { wa_history: J(many1600) })), qO = run(cO, 'dsQuarantineGet()');
  ok('migration: records over the 1500 limit are moved to Quarantine, the 1500 newest stay', run(cO, "Store.get('history').length") === 1500 && qO.length === 100 && qO.every((x) => x.reason === 'OVERFLOW_OVER_LIMIT') && run(cO, "Store.get('history')[1499].date") === run(fresh, "addDaysStr('2024-01-01',100)") && qO.every((x) => x.record.date < run(fresh, "addDaysStr('2024-01-01',100)")));
  const sizeL = legacyBytes(Object.assign(legacyStore(), { wa_history: J(many1600) }));
  const cNo = G(Object.assign(legacyStore(), { wa_history: J(many1600) }), { limit: 1500000 });
  ok('migration that cannot store its Quarantine/generation stops safely: nothing adopted, original data in use', run(cNo, 'DS.mode') === 'legacy' && genNums(cNo.store).length === 0 && !cNo.store.wa_ptr && run(cNo, 'DS.notices.some(n => n.code === "MIGRATION_FAILED" && n.step === "SPACE")') && legacyBytes(cNo.store) === sizeL && run(cNo, "Store.get('history').length") === 1600);
  ok('...and the app keeps working on the original storage (render, save a workout)', balanced(run(cNo, 'renderHome()')) && run(cNo, "saveHistoryEntry(" + J(W('2026-10-14')) + ")") === true && run(cNo, "Store.get('history').length") === 1500 && run(cNo, "Store.get('history').some(h => h.date === '2026-10-14')") === true);
  const cNq = G(Object.assign(legacyStore(), { wa_history: J(dirty) }), { onWrite: (k) => { if (/_quarantine$/.test(k)) throw new Error('disk'); } });
  ok('migration whose Quarantine write fails: no pointer, no generation, original data in use', run(cNq, 'DS.mode') === 'legacy' && !cNq.store.wa_ptr && genNums(cNq.store).length === 0 && run(cNq, 'DS.notices.some(n => n.code === "MIGRATION_FAILED")'));

  // ---- 4. schema version 6 is written only after the generation is adopted ----
  ok('the schema version of the program is 6', run(G({}), 'SCHEMA_VERSION') === 6);
  const cV = G(clone(Object.assign(legacyStore(), { wa_schemaVersion: '5' })));
  ok('after a successful migration the stored version is 6 and exports say 6', cV.store.wa_schemaVersion === '6' && JSON.parse(run(cV, 'buildBackup()')).schemaVersion === 6);
  const cVf = G(Object.assign(legacyStore(), { wa_schemaVersion: '5' }), { onWrite: (k) => { if (/_history$/.test(k)) throw new Error('disk'); } });
  ok('a failed migration never claims version 6: stored version stays 5, exports say 5, original storage in use', run(cVf, 'DS.mode') === 'legacy' && cVf.store.wa_schemaVersion === '5' && JSON.parse(run(cVf, 'buildBackup()')).schemaVersion === 5 && !cVf.store.wa_ptr);
  const cVn = G(Object.assign(legacyStore(), { wa_history: J(many1600) }), { limit: 1500000 });
  ok('a migration refused for lack of space also keeps version 5', cVn.store.wa_schemaVersion === '5' && JSON.parse(run(cVn, 'buildBackup()')).schemaVersion === 5);
  const oldV = G(Object.assign(legacyStore(), { wa_schemaVersion: '3', wa_exerciseSwaps: J({ PUSH_A: { 'Wide Push-ups': { name: 'Diamond Push-ups' } } }) }));
  ok('an old store (version 3) is upgraded through the old steps and then ends at version 6', oldV.store.wa_schemaVersion === '6' && run(oldV, "Store.get('exerciseMods')['PUSH_A|Wide Push-ups'].name") === 'Diamond Push-ups');

  // ---- crash simulation: the program is stopped abruptly (no rollback code runs) after k writes, then restarted from the storage that was left ----
  const crashAbort = (build, act, check, label, minPoints) => {
    let tested = 0, last = null;
    for (let k = 0; k < 90; k++) {
      const store = build(); let crashed = false, ctx = null;
      try { ctx = act(store, { crashAt: k }); } catch (e) { if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') crashed = true; else throw e; }
      tested++; last = { k, crashed }; check(clone(store), k, ctx);
      if (!crashed) break;
    }
    ok(label + ': stopped abruptly at every write (' + tested + ' points), the last run finished normally', tested >= (minPoints || 5) && last && last.crashed === false);
  };
  const cmpOnly = (img, keys) => J(keys.map((k) => img[k]));
  // migration with Quarantine content
  let bad5 = [];
  crashAbort(() => Object.assign(dirtyStore(), { wa_schemaVersion: '5' }), (store, o) => G(store, o), (img, k) => {
    const hasPtr = !!img.wa_ptr;
    if (legacyBytes(img) !== legacyBytes(dirtyStore())) bad5.push('original changed @' + k);
    if (!hasPtr && img.wa_schemaVersion === '6') bad5.push('version 6 before the pointer @' + k);
    if (!hasPtr && ('wa_quarantine' in img)) bad5.push('stand-alone quarantine written @' + k);
    const r = G(clone(img));
    if (run(r, 'DS.mode') !== 'gen') bad5.push('no generation after restart @' + k);
    else if (run(r, "Store.get('history').length") !== 3 || run(r, 'dsQuarantineGet().length') !== 8) bad5.push('history/quarantine incomplete after restart @' + k + ' ' + run(r, "Store.get('history').length") + '/' + run(r, 'dsQuarantineGet().length'));
    if (r.store.wa_schemaVersion !== '6') bad5.push('restart did not reach version 6 @' + k);
    if ('wa_quarantine' in r.store) bad5.push('stand-alone quarantine @' + k);
  }, 'migration with Quarantine records', 6);
  ok('migration stop: never version 6 before the pointer, never a mixed state, the restart always ends with complete History + Quarantine', bad5.length === 0, bad5.join('; '));
  // restore (Quarantine part of the generation)
  const baseQ = () => { const c = baseRec(); return clone(c.store); };
  const baseSnap = baseQ(); let bad6 = [];
  const before = G(clone(baseSnap)); const beforeHist = run(before, "Store.get('history')"), beforeQ = J(run(before, 'dsQuarantineGet()'));
  crashAbort(() => clone(baseSnap), (store, o) => { const c = G(store, o); run(c, "recoveryApply({kind:'legacy'}, null, 'RESTORE')"); return c; }, (img, k) => {
    const r = G(clone(img)); const gen = run(r, 'DS.gen');
    if (gen === 1) {
      if (cmpOnly(img, ['wa_g1_plan', 'wa_g1_history', 'wa_g1_config', 'wa_g1_quarantine', 'wa_ptr']) !== cmpOnly(baseSnap, ['wa_g1_plan', 'wa_g1_history', 'wa_g1_config', 'wa_g1_quarantine', 'wa_ptr'])) bad6.push('generation 1 or its pointer changed @' + k);
      if (J(run(r, 'dsQuarantineGet()')) !== beforeQ) bad6.push('active Quarantine changed before the commit @' + k);
      if (J(run(r, "Store.get('history')")) !== J(beforeHist)) bad6.push('active History changed before the commit @' + k);
    } else if (gen === 2) {
      if (run(r, "Store.get('history').length") !== 4 || run(r, 'dsQuarantineGet().length') !== 2) bad6.push('generation 2 incomplete @' + k);
    } else bad6.push('unexpected generation @' + k);
    if (!present(beforeHist, r)) bad6.push('a record is missing @' + k);
    if ('wa_quarantine' in img) bad6.push('stand-alone quarantine written @' + k);
  }, 'restore', 6);
  ok('restore stop: the restart sees generation 1 exactly as it was (History AND Quarantine) or complete generation 2, never a mix', bad6.length === 0, bad6.join('; '));
  // import with conflicts
  let bad7 = [];
  const impFile = J({ app: 'WOH', schemaVersion: 6, data: { history: [Object.assign(clone(run(before, "Store.get('history')")[0]), { durationSeconds: 1 }), W('2026-09-01'), { type: 'NO_NAME_X', date: '2026-09-03', status: 'COMPLETED', startedAt: 9 }], settings: { keepAwake: true }, accentTheme: 'yellow' } });
  crashAbort(() => clone(baseSnap), (store, o) => { const c = G(store, o); run(c, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(impFile)})}, null, 'IMPORT')`); return c; }, (img, k) => {
    const r = G(clone(img)); const gen = run(r, 'DS.gen');
    const oldView = J([run(r, "Store.get('settings')"), run(r, "Store.get('accentTheme')"), run(r, "Store.get('history').length")]);
    if (gen === 1 && oldView !== J([run(before, "Store.get('settings')"), run(before, "Store.get('accentTheme')"), 6])) bad7.push('mixed old/new sections @' + k);
    if (gen === 2 && (run(r, "Store.get('settings').keepAwake") !== true || run(r, "Store.get('accentTheme')") !== 'yellow')) bad7.push('new generation lacks settings/theme @' + k);
    if (gen !== 1 && gen !== 2) bad7.push('unexpected generation @' + k);
    if (!present(beforeHist, r)) bad7.push('a record is missing @' + k);
  }, 'import', 6);
  ok('import stop: History, Plan, Theme, Settings and Quarantine switch together or not at all', bad7.length === 0, bad7.join('; '));
  // deleting the Quarantine is one write
  const cDq = G(clone(cApply.store)); const dq = wroteKeys(clone(cApply.store), {}, (c) => run(c, 'dsQuarantineDelete(dsQuarantineGet().map(q=>q.qid))'));
  ok('deleting Quarantine items is a single atomic write into the generation in use', J(dq) === '["wa_g2_quarantine"]' && run(cDq, 'dsQuarantineDelete(dsQuarantineGet().map(q=>q.qid))') === true && run(cDq, 'dsQuarantineGet().length') === 0);
  const legacyQ = clone(L0); legacyQ.wa_quarantine = J({ v: 1, h: run(G({}), `dsHash(JSON.stringify({items:[{qid:'q_old',ts:1,reason:'X',source:'old',record:{a:1}}]}))`), d: { items: [{ qid: 'q_old', ts: 1, reason: 'X', source: 'old', record: { a: 1 } }] } });
  const cQs = G(legacyQ);
  ok('a stand-alone Quarantine written by an earlier build is merged into the new generation (nothing lost, key left untouched)', run(cQs, 'dsQuarantineGet().some(q => q.qid === "q_old")') === true && cQs.store.wa_quarantine === legacyQ.wa_quarantine);
  const cQi = G(clone(cApply.store)); run(cQi, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
  ok('Quarantine is carried forward by every generation (a restore never drops items)', run(cQi, 'dsQuarantineGet().length') >= 2 && run(cQi, 'DS.gen') === 3);

  // ---- 6. degraded mode: verified generations can still be restored ----
  const twoGens = clone(cApply.store); // gens 1 and 2, ptr -> 2
  const corruptPtrs = (st) => Object.assign(st, { wa_ptr: 'garbage', wa_ptr_bak: 'garbage' });
  const cDg = G(corruptPtrs(clone(twoGens))); const dgBefore = J(cDg.store);
  const gl = run(cDg, 'dsListGenerations()');
  ok('degraded: the app is read-only and lists the generations that passed their checksums', run(cDg, 'DS.mode') === 'degraded' && J(gl.map((g) => [g.gen, g.role, g.ok])) === J([[1, 'AVAILABLE', true], [2, 'AVAILABLE', true]]));
  const dgDry = run(cDg, "recoveryDryRun({kind:'generation', gen: 2})");
  ok('degraded: the Dry Run of a verified generation works and writes nothing', dgDry.ok && dgDry.degraded === true && dgDry.counts.stay === 4 && J(cDg.store) === dgBefore && dgDry.rows[0].before.includes('not available'));
  ok('degraded: the original keys cannot be used as a source (they carry no checksum)', run(cDg, "recoveryDryRun({kind:'legacy'})").errors[0] === 'NO_GENERATIONS');
  const dgApply = run(cDg, `recoveryApply({kind:'generation', gen: 2}, ${J(dgDry.hash)}, 'RESTORE')`);
  ok('degraded: restoring creates a NEW generation with a NEW pointer; the old generations are untouched', dgApply.ok && J(genNums(cDg.store)) === '[1,2,3]' && run(cDg, 'DS.mode') === 'gen' && run(cDg, 'DS.gen') === 3 && cmpOnly(cDg.store, ['wa_g1_plan', 'wa_g1_history', 'wa_g2_plan', 'wa_g2_history', 'wa_g2_quarantine']) === cmpOnly(twoGens, ['wa_g1_plan', 'wa_g1_history', 'wa_g2_plan', 'wa_g2_history', 'wa_g2_quarantine']));
  const cDg2 = G(clone(cDg.store));
  ok('degraded: after the restore the app starts normally and has the restored data, with the report', run(cDg2, 'DS.mode') === 'gen' && run(cDg2, "Store.get('history').length") === 4 && run(cDg2, 'dsQuarantineGet().length') === 2 && dgApply.report.degraded === true && dgApply.report.outcome === 'COMMITTED');
  const noValid = corruptPtrs(clone(twoGens)); noValid.wa_g1_history = noValid.wa_g1_history.replace('"d":[', '"d":[null,'); noValid.wa_g2_config = 'garbage';
  const cNv = G(noValid), nvBefore = J(cNv.store);
  ok('degraded without any verified generation: stays read-only and lists nothing restorable', run(cNv, 'DS.mode') === 'degraded' && run(cNv, 'dsListGenerations().length') === 2 && run(cNv, 'dsListGenerations().every(g => !g.ok)'));
  ok('degraded without any verified generation: every Dry Run is refused as unreadable', [1, 2].every((n) => run(cNv, `recoveryDryRun({kind:'generation', gen: ${n}})`).errors[0] === 'SOURCE_UNREADABLE'));
  const nvApply = run(cNv, `recoveryApply({kind:'generation', gen: 2}, null, 'RESTORE')`);
  const nvKeysNow = Object.keys(cNv.store).filter((k) => k !== 'wa_recovery_last').sort(), nvKeysThen = Object.keys(JSON.parse(nvBefore)).filter((k) => k !== 'wa_recovery_last').sort(); // the report of the refused attempt replaces the previous report: that is the only key allowed to change
  ok('degraded without any verified generation: a restore attempt is refused (aborted report)', nvApply.ok === false && nvApply.report.outcome === 'ABORTED', J([nvApply.ok, nvApply.report.outcome, nvApply.report.reason]));
  ok('degraded without any verified generation: no key was added or removed', J(nvKeysNow) === J(nvKeysThen), J(nvKeysNow.filter((k) => !nvKeysThen.includes(k))) + ' / ' + J(nvKeysThen.filter((k) => !nvKeysNow.includes(k))));
  ok('degraded without any verified generation: no value changed', nvKeysThen.filter((k) => k !== 'wa_recovery_last').every((k) => cNv.store[k] === JSON.parse(nvBefore)[k]), J(nvKeysThen.filter((k) => cNv.store[k] !== JSON.parse(nvBefore)[k])));
  ok('degraded without any verified generation: the screen says why', run(cNv, "(state.screen='settings',openDataSafety(),renderDataSafety())").includes('No verified generation'));
  const oneBad = corruptPtrs(clone(twoGens)); oneBad.wa_g2_plan = oneBad.wa_g2_plan.replace('"d":{', '"d":{"x":1,');
  const cOb = G(oneBad); const lo = run(cOb, 'dsListGenerations()');
  ok('degraded with one damaged and one valid generation: the damaged one is flagged and cannot be restored, the valid one can', J(lo.map((g) => [g.gen, g.ok, g.role])) === J([[1, true, 'AVAILABLE'], [2, false, 'DAMAGED']]) && run(cOb, "recoveryDryRun({kind:'generation', gen: 2})").errors[0] === 'SOURCE_UNREADABLE' && run(cOb, "recoveryDryRun({kind:'generation', gen: 1})").ok === true);
  const gaps = corruptPtrs({}); ['plan', 'history', 'config', 'quarantine'].forEach((p) => { gaps['wa_g30_' + p] = twoGens['wa_g2_' + p]; gaps['wa_g31_' + p] = twoGens['wa_g1_' + p]; });
  const cGp = G(gaps); const gpApply = run(cGp, "recoveryApply({kind:'generation', gen: 31}, null, 'RESTORE')");
  ok('degraded: generations far apart are found, and the new one never overwrites an existing number', J(run(cGp, 'dsScan()')) === '[30,31,32]' && gpApply.ok && run(cGp, 'DS.gen') === 32 && cGp.store.wa_g30_plan === twoGens.wa_g2_plan && cGp.store.wa_g31_plan === twoGens.wa_g1_plan);
  const badSum = corruptPtrs(clone(twoGens)); badSum.wa_g2_history = badSum.wa_g2_history.replace(/"h":"[0-9a-f]+:\d+"/, '"h":"00000000:1"');
  ok('degraded: a generation with a wrong checksum is never restored', run(G(badSum), "recoveryDryRun({kind:'generation', gen: 2})").errors[0] === 'SOURCE_UNREADABLE');
  ok('degraded: the Recovery screen offers RESTORE only for verified generations', (() => { const c = G(corruptPtrs(clone(oneBad))); const h = run(c, "(state.screen='settings',openDataSafety(),renderDataSafety())"); return h.includes('dsRestoreGen(1)') && !h.includes('dsRestoreGen(2)') && h.includes('DAMAGED') && h.includes('VERIFIED') && balanced(h); })());

  // ---- 7. INIT_ERROR is a real fault injected into the start-up path ----
  const cIe = G(clone(L0), { deferInit: true });
  run(cIe, "Object.defineProperty(Store, 'persistent', { get() { throw new Error('injected fault'); } })");
  noThrow('start-up with a fault inside Data Safety does not stop the app', () => { cIe.document.__init(); });
  ok('INIT_ERROR: the app falls back to the original storage, tells so, and writes no generation', run(cIe, 'DS.mode') === 'legacy' && run(cIe, 'DS.notices.some(n => n.code === "INIT_ERROR")') && genNums(cIe.store).length === 0 && !cIe.store.wa_ptr && legacyBytes(cIe.store) === legacyBytes(L0));
  ok('INIT_ERROR: the app still works (screens render, the original History is read, a workout can be saved)', balanced(run(cIe, 'renderHome()')) && run(cIe, "Store.get('history').length") === 4 && run(cIe, "saveHistoryEntry(" + J(W('2026-10-14')) + ")") === true && run(cIe, "Store.get('history').length") === 5);
  const cIe2 = G(clone(L0), { deferInit: true }); run(cIe2, "compactHistory = function () { throw new Error('injected fault in the migration'); }");
  noThrow('a fault inside the migration itself does not stop the app either', () => { cIe2.document.__init(); });
  ok('INIT_ERROR after a fault in the migration: nothing was written, the original data is in use', run(cIe2, 'DS.mode') === 'legacy' && genNums(cIe2.store).length === 0 && !cIe2.store.wa_ptr && legacyBytes(cIe2.store) === legacyBytes(L0) && cIe2.store.wa_schemaVersion !== '6');

  // ---- 8. a finished workout is never lost, even if the app is killed between the two writes ----
  let bad8 = [], seenWith = 0, seenWithout = 0;
  const runningStore = () => { const c = G(clone(L0)); finishAll(c); return clone(c.store); };
  const histOnly = (c) => run(c, "Store.get('history').length");
  crashAbort(() => runningStore(), (store, o) => { const c = G(store, o); run(c, 'resumeSession()'); run(c, 'finishWorkout()'); return c; }, (img, k) => {
    const r = G(clone(img)); const saved = histOnly(r) === 5, still = !!run(r, "Store.get('activeSession')");
    if (!saved && !still) bad8.push('workout lost @' + k);
    if (saved) seenWith++; else seenWithout++;
    if (saved && still) { run(r, 'resumeSession()'); run(r, 'finishWorkout()'); if (histOnly(r) !== 5) bad8.push('duplicate record after resume @' + k); }
    if (!saved && still) { run(r, 'resumeSession()'); run(r, 'finishWorkout()'); if (histOnly(r) !== 5) bad8.push('could not finish after restart @' + k); }
  }, 'finishWorkout', 2);
  ok('finishWorkout stop: the workout is either still there to finish or already saved, never lost, never saved twice', bad8.length === 0 && seenWith >= 1 && seenWithout >= 1, bad8.join('; '));

  // =====================================================================
  console.log('\n== 11. FINAL VALIDATION FIX: session names, routine names, warm-up exercises (TIME / REPS) ==');
  const cVP = G({});
  const vp = (pl) => run(cVP, `dsValidatePlan(${J(pl)})`);
  const S_NAME = 'SESSION_NAME_INVALID_OR_DUPLICATE', L_NAME = 'WARMUP_LIBRARY_NAME_INVALID_OR_DUPLICATE';
  const planS = (names) => ({ sessions: names.map((n, i) => ({ id: 'S' + i, name: n, warmup: null })) });
  const planL = (routines) => ({ sessions: [{ id: 'A', name: 'One', warmup: null }], warmupLibrary: routines });
  const planW = (items) => ({ sessions: [{ id: 'A', name: 'One', warmup: { sourceId: 'x', sourceName: 'x', items } }] });
  const reason = (pl) => { const r = vp(pl); return r.ok ? null : r.reason; };
  const X = (n) => 'x'.repeat(n);
  // ---- session names ----
  ok('session name length 1..24 counts the TRIMMED name: 1, 24, padded 24, tab/newline padded are accepted', ['x', X(24), ' ' + X(24) + ' ', '\tAB\n', '  a  '].every((n) => vp(planS([n])).ok));
  ok('session name: empty, spaces only, tabs/newlines only, 25 chars, padded 25 chars, non-strings are refused', ['', '   ', '\t\n ', X(25), ' ' + X(25) + ' ', null, 5, undefined, ['a']].every((n) => reason(planS([n])) === S_NAME));
  ok('accepted session names are stored trimmed', J(vp(planS(['  Push  ', '\tPull\n'])).plan.sessions.map((s) => s.name)) === J(['Push', 'Pull']));
  ok('session names that differ only in letter case are duplicates (Push/push, PUSH/push, Push/" Push ")', [['Push', 'push'], ['PUSH', 'push'], ['Push', ' Push '], ['\u00c4bc', '\u00e4BC'], ['a', 'A']].every((p) => reason(planS(p)) === S_NAME));
  ok('different session names are accepted (Push/Pull, inner spaces count)', vp(planS(['Push', 'Pull'])).ok && vp(planS(['Pu sh', 'Push'])).ok);
  ok('12 sessions with 12 different names are accepted, 13 are refused', vp(planS(Array.from({ length: 12 }, (_, i) => 'N' + i))).ok && reason(planS(Array.from({ length: 13 }, (_, i) => 'N' + i))) === 'SESSIONS_MISSING_OR_OVER_12');
  // ---- routine names ----
  const R1 = (name, items) => ({ name, items: items || [{ name: 'Move', duration: 30 }] });
  ok('routine name length 1..24 counts the trimmed name: 1, 24, padded 24 are accepted', ['x', X(24), ' ' + X(24) + ' ', '\tAB\n'].every((n) => vp(planL([R1(n)])).ok));
  ok('routine name: empty, spaces only, 25 chars, padded 25 chars, non-strings are refused', ['', '   ', '\t\n', X(25), ' ' + X(25) + ' ', null, 7, undefined].every((n) => reason(planL([R1(n)])) === L_NAME));
  ok('accepted routine names are stored trimmed', J(vp(planL([R1('  Push  ')])).plan.warmupLibrary.map((r) => r.name)) === J(['Push']));
  ok('routine names are unique with letter case counting: Push and push are both accepted', vp(planL([R1('Push'), R1('push')])).ok && vp(planL([R1('PUSH'), R1('Push'), R1('push')])).ok);
  ok('routine names that are equal after trim are duplicates (Push/" Push ", identical names)', reason(planL([R1('Push'), R1(' Push ')])) === L_NAME && reason(planL([R1('A'), R1('A')])) === L_NAME);
  ok('a routine with no exercises and a routine with 300 exercises are both accepted (no fixed limit per routine)', vp(planL([R1('Empty', [])])).ok && vp(planL([R1('Big', Array.from({ length: 300 }, (_, i) => ({ name: 'E' + i, type: i % 2 ? 'REPS' : 'TIME', duration: 30, reps: 10 })))])).ok);
  ok('a malformed library entry is refused as an invalid library', ['x', null, 5, []].every((r) => reason(planL([r])) === 'WARMUP_LIBRARY_INVALID') && reason({ sessions: [{ id: 'A', name: 'One', warmup: null }], warmupLibrary: 'x' }) === 'WARMUP_LIBRARY_INVALID');
  // ---- warm-up exercises, in a session warm-up and in a library routine ----
  for (const [where, mk9, bad] of [['session warm-up', (items) => planW(items), 'WARMUP_INVALID'], ['library routine', (items) => planL([{ name: 'R', items }]), 'WARMUP_LIBRARY_INVALID']]) {
    const good = (items) => vp(mk9(items)).ok, no = (items) => reason(mk9(items)) === bad;
    ok(where + ': TIME accepts 5, 30 and 600 seconds', good([{ name: 'A', type: 'TIME', duration: 5 }]) && good([{ name: 'A', type: 'TIME', duration: 30 }]) && good([{ name: 'A', type: 'TIME', duration: 600 }]));
    ok(where + ': TIME refuses 4, 0, -5, 601, 5.5, text, null and a missing duration', [4, 0, -5, 601, 5.5, '30', null, undefined, 3600].every((d) => no([{ name: 'A', type: 'TIME', duration: d }])));
    ok(where + ': REPS accepts 1, 10 and 100 repetitions', good([{ name: 'A', type: 'REPS', reps: 1 }]) && good([{ name: 'A', type: 'REPS', reps: 10 }]) && good([{ name: 'A', type: 'REPS', reps: 100 }]));
    ok(where + ': REPS refuses 0, -1, 101, 1.5, text, null and a missing reps', [0, -1, 101, 1.5, '10', null, undefined, 1000].every((r) => no([{ name: 'A', type: 'REPS', reps: r }])));
    ok(where + ': a REPS exercise needs no duration (missing duration is accepted; an extra duration is ignored)', good([{ name: 'A', type: 'REPS', reps: 12 }]) && good([{ name: 'A', type: 'REPS', reps: 12, duration: 45 }]) && no([{ name: 'A', type: 'REPS', duration: 45 }]));
    ok(where + ': the exercise type must be exactly TIME or REPS', ['HOLD', 'time', 'Reps', 'REP', '', null, 5, ['TIME']].every((t) => no([{ name: 'A', type: t, duration: 30, reps: 10 }])));
    ok(where + ': an older exercise (name + duration, no type) is accepted as TIME and keeps its seconds', (() => { const r = vp(mk9([{ name: 'Jumping Jacks', duration: 60 }, { name: 'Shoulder', duration: 30 }])); const it = where === 'library routine' ? r.plan.warmupLibrary[0].items : r.plan.sessions[0].warmup.items; return r.ok && J(it.map((w) => [w.name, w.type, w.duration])) === J([['Jumping Jacks', 'TIME', 60], ['Shoulder', 'TIME', 30]]); })());
    ok(where + ': an older exercise with a bad or missing duration is refused', [{ name: 'A' }, { name: 'A', duration: 0 }, { name: 'A', duration: 700 }, { name: 'A', duration: 2.5 }].every((w) => no([w])));
    ok(where + ': exercise name is checked after trim (1..60): spaces only, empty and 61 characters are refused; 60 accepted and stored trimmed', ['', '   ', X(61), null, 4].every((n) => no([{ name: n, type: 'TIME', duration: 30 }])) && good([{ name: X(60), duration: 30 }]) && (() => { const r = vp(mk9([{ name: '  Arm  ', duration: 30 }])); return (where === 'library routine' ? r.plan.warmupLibrary[0].items[0].name : r.plan.sessions[0].warmup.items[0].name) === 'Arm'; })());
    ok(where + ': items that are not objects are refused; a list may mix TIME and REPS', [null, 'x', 5, []].every((w) => no([w])) && good([{ name: 'A', type: 'TIME', duration: 20 }, { name: 'B', type: 'REPS', reps: 15 }, { name: 'C', duration: 60 }]) && no([{ name: 'A', type: 'TIME', duration: 20 }, { name: 'B', type: 'REPS', reps: 0 }]));
  }
  // ---- compatibility with the built-in routines and with plans made by the app ----
  const wdb = run(cVP, 'JSON.parse(JSON.stringify(WARMUP_DB))');
  ok('every built-in routine of data.js (name + duration only) is accepted as it is, as a session warm-up and as a library routine', Object.keys(wdb).every((k) => vp(planW(wdb[k])).ok && vp(planL([{ name: k, items: wdb[k] }])).ok) && Object.keys(wdb).length === 3);
  ok('a plan produced by the app itself (migration) is accepted unchanged in meaning', (() => { const r = vp(okPlan()); return r.ok && J(r.plan.sessions.map((s) => s.warmup.items.map((w) => [w.name, w.duration]))) === J(okPlan().sessions.map((s) => s.warmup.items.map((w) => [w.name, w.duration]))); })());
  // ---- import and restore of old-style and new-style routines ----
  const newStyle = okPlan();
  newStyle.sessions[0].name = '  My Push  '; newStyle.sessions[0].warmup = { sourceId: 'wl_X', sourceName: 'X', items: [{ id: 'n1', name: ' Arm circles ', type: 'REPS', reps: 12 }, { id: 'n2', name: 'Hold', type: 'TIME', duration: 45 }] };
  newStyle.warmupLibrary = [{ id: 'l1', name: ' Mobility ', items: [{ id: 'm1', name: 'Cat cow', type: 'REPS', reps: 10 }, { id: 'm2', name: 'Plank', type: 'TIME', duration: 20 }] }, { id: 'l2', name: 'mobility', items: [{ name: 'Old style', duration: 30 }] }];
  const cIm = G(clone(L0));
  const imOut = run(cIm, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: newStyle }))})}, null, 'IMPORT')`);
  const pl2 = readGen(cIm, 2).plan;
  ok('import of new-style routines: committed, names stored trimmed, TIME and REPS items kept as they are', imOut.ok && imOut.report.ignored.length === 0 && pl2.sessions[0].name === 'My Push' && J(pl2.sessions[0].warmup.items.map((w) => [w.name, w.type, w.reps === undefined ? w.duration : w.reps])) === J([['Arm circles', 'REPS', 12], ['Hold', 'TIME', 45]]) && pl2.warmupLibrary[0].name === 'Mobility' && pl2.warmupLibrary[1].name === 'mobility');
  ok('import: an old-style exercise (no type) inside a new plan is stored as TIME with its seconds', pl2.warmupLibrary[1].items[0].type === 'TIME' && pl2.warmupLibrary[1].items[0].duration === 30);
  const oldStyle = okPlan(); oldStyle.sessions.forEach((s) => { s.warmup.items = s.warmup.items.map((w) => ({ name: w.name, duration: w.duration })); }); oldStyle.warmupLibrary = oldStyle.warmupLibrary.map((r) => ({ name: r.name, items: r.items.map((w) => ({ name: w.name, duration: w.duration })) }));
  const cOs = G(clone(L0)); const osOut = run(cOs, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: oldStyle }))})}, null, 'IMPORT')`);
  ok('import of an old-style plan (items with name + duration only) works and every item becomes TIME with the same seconds', osOut.ok && readGen(cOs, 2).plan.sessions.every((s, i) => J(s.warmup.items.map((w) => [w.name, w.type, w.duration])) === J(oldStyle.sessions[i].warmup.items.map((w) => [w.name, 'TIME', w.duration]))));
  const cRs = G(clone(L0)); run(cRs, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: newStyle }))})}, null, 'IMPORT')`);
  const rs1 = run(cRs, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')"), plan1 = readGen(cRs, 3).plan;
  const rs2 = run(cRs, "recoveryApply({kind:'generation', gen: 2}, null, 'RESTORE')"), plan2 = readGen(cRs, 4).plan;
  ok('restore: the previous generation (older plan) and then the generation with REPS exercises both come back as they were', rs1.ok && rs2.ok && J(plan1.sessions) === J(readGen(cRs, 1).plan.sessions) && J(plan2.sessions) === J(readGen(cRs, 2).plan.sessions) && J(plan2.warmupLibrary) === J(readGen(cRs, 2).plan.warmupLibrary) && plan2.sessions[0].warmup.items[0].type === 'REPS');
  const cBk = G(clone(cRs.store)); const bk11 = run(cBk, 'buildBackup()'), cFresh = G({});
  const fx = run(cFresh, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(bk11)})}, null, 'IMPORT')`);
  ok('a full export that contains REPS exercises can be imported into another installation (round trip)', fx.ok && fx.report.ignored.length === 0 && J(readGen(cFresh, 2).plan.sessions[0].warmup.items.map((w) => [w.type, w.reps === undefined ? w.duration : w.reps])) === J([['REPS', 12], ['TIME', 45]]));
  const oneBadItem = okPlan(); oneBadItem.sessions[2].warmup.items.push({ name: 'Bad', type: 'REPS', reps: 101 });
  const cBi = G(clone(L0)); const dBi = run(cBi, `recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: oneBadItem }))})})`);
  ok('one invalid warm-up exercise (101 reps) ignores only the Plan section; History, Settings and Theme are still imported', dBi.ok && dBi.ignored.length === 1 && dBi.ignored[0].reason === 'WARMUP_INVALID' && dBi.rows[0].status === 'SAME' && dBi.rows[1].status === 'CHANGES' && dBi.rows[3].status === 'CHANGES');
  ok('the review screen explains the warm-up limits when a plan is ignored for a bad exercise', run(cBi, `(state.screen='settings',openDataSafety(),dsStartRecovery({kind:'backup', plan: buildImportPlan(${J(goodFile({ plan: oneBadItem }))})}),renderDataSafety())`).includes('5-600 s') );
  // ---- a REPS exercise in a stored plan never breaks a workout in 3A (it runs as a timed step with the default length; the REPS screen comes in 3B) ----
  run(cRs, "selectSession('PUSH_A');startWorkoutFlow()");
  ok('workout with a REPS warm-up exercise: the snapshot keeps its type and reps, and the step has a usable length', run(cRs, "state.warmupList[0].type") === 'REPS' && run(cRs, "state.warmupList[0].reps") === 12 && Number.isFinite(run(cRs, 'resolveWarmupDuration(state.warmupList[0])')) && run(cRs, 'resolveWarmupDuration(state.warmupList[0])') > 0);
  noThrow('workout with a REPS warm-up exercise: the warm-up step starts without an error', () => { run(cRs, 'state.warmupIdx=0;beginWarmupStep()'); if (run(cRs, 'state.screen') !== 'warmup') throw new Error('screen=' + run(cRs, 'state.screen')); });

  // =====================================================================
  console.log('\n== 12. FINAL REVIEW FIX: a generation that has only a Quarantine part is seen, flagged damaged, and never reused ==');
  const loneItems = [{ qid: 'q_lone', ts: 1, reason: 'X', source: 'test', record: { keep: 'me' } }];
  const loneText = run(cVP, `dsEnvelope(${J({ items: loneItems })})`);
  const withLone = (store, n) => Object.assign(clone(store), { ['wa_g' + n + '_quarantine']: loneText });
  ok('there is exactly one dsGenExists definition and it checks every part of DS_PARTS (a later duplicate cannot shadow it)', (fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/function dsGenExists\(/g) || []).length === 1 && run(cVP, 'DS_PARTS.join()') === 'plan,history,config,quarantine');
  ok('dsGenExists is true for a generation whose only key is quarantine, false for an unused number', run(G(withLone({}, 7)), 'dsGenExists(7)') === true && run(G(withLone({}, 7)), 'dsGenExists(6)') === false);
  const sLone = withLone(cApply.store, 7), sLoneBefore = J(sLone), cL = G(clone(sLone));
  ok('gen mode: dsScan finds the generation that only has a Quarantine key', J(run(cL, 'dsScan()')) === '[1,2,7]' && run(cL, 'DS.mode') === 'gen' && run(cL, 'DS.gen') === 2);
  const entry7 = run(cL, 'dsListGenerations()').find((g) => g.gen === 7);
  ok('gen mode: it is listed as damaged (not usable, not restorable) and as an unfinished generation, not ignored', !!entry7 && entry7.ok === false && entry7.history === null && entry7.role === 'ORPHAN' && run(cL, 'DS.orphans.join()') === '7');
  ok('gen mode: a Dry Run from it is refused as unreadable and writes nothing', run(cL, "recoveryDryRun({kind:'generation', gen: 7})").errors[0] === 'SOURCE_UNREADABLE' && J(cL.store) === sLoneBefore);
  ok('gen mode: the screen offers no RESTORE for it, shows it as damaged, and allows deleting it', (() => { const h = run(cL, "(state.screen='settings',openDataSafety(),renderDataSafety())"); return h.includes('GENERATION 7') && !h.includes('dsRestoreGen(7)') && h.includes('dsDeleteStep(7)') && h.includes('UNFINISHED') && h.includes('DAMAGED'); })());
  // dsNextGen must skip it; the sharpest case is the number right after the current generation
  const sNext = withLone(cApply.store, 3), cN3 = G(clone(sNext));
  ok('dsNextGen never returns the number of a generation that only has Quarantine data (3 is skipped, 4 is next)', run(cN3, 'DS.gen') === 2 && run(cN3, 'dsNextGen()') === 4 && run(G(clone(sLone)), 'dsNextGen()') === 8);
  const apply3 = run(cN3, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
  ok('a restore next to it creates generation 4 and leaves the lone Quarantine data of generation 3 byte for byte', apply3.ok && run(cN3, 'DS.gen') === 4 && cN3.store.wa_g3_quarantine === loneText && !('wa_g3_plan' in cN3.store) && !('wa_g3_history' in cN3.store) && J(genNums(cN3.store)) === '[1,2,4]');
  const cL7 = G(clone(sLone)), apply7 = run(cL7, "recoveryApply({kind:'legacy'}, null, 'RESTORE')");
  ok('a restore from the original data also keeps a lone Quarantine generation at 7 untouched and uses 8', apply7.ok && run(cL7, 'DS.gen') === 8 && cL7.store.wa_g7_quarantine === loneText);
  const dImp = run(cN3, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(goodFile({}))})}, null, 'IMPORT')`);
  ok('an import afterwards also never touches it (new generation 5)', dImp.ok && run(cN3, 'DS.gen') === 5 && cN3.store.wa_g3_quarantine === loneText);
  const cDel = G(clone(sNext)); const delOk = run(cDel, 'dsDeleteGeneration(3)');
  ok('deleting the unfinished generation by hand removes its Quarantine key too (and only that generation)', delOk === true && !('wa_g3_quarantine' in cDel.store) && J(genNums(cDel.store)) === '[1,2]');
  // degraded: the same protection, plus the damaged classification
  const degLone = Object.assign(corruptPtrs(clone(twoGens)), { wa_g9_quarantine: loneText }), degLoneBefore = J(degLone);
  const cDeg = G(clone(degLone)), listD = run(cDeg, 'dsListGenerations()');
  ok('degraded: the lone-Quarantine generation is listed as DAMAGED next to the verified ones', run(cDeg, 'DS.mode') === 'degraded' && J(listD.map((g) => [g.gen, g.role, g.ok])) === J([[1, 'AVAILABLE', true], [2, 'AVAILABLE', true], [9, 'DAMAGED', false]]));
  ok('degraded: it cannot be restored, and nothing is written by trying', run(cDeg, "recoveryDryRun({kind:'generation', gen: 9})").errors[0] === 'SOURCE_UNREADABLE' && J(cDeg.store) === degLoneBefore);
  const rDeg = run(cDeg, "recoveryApply({kind:'generation', gen: 2}, null, 'RESTORE')");
  ok('degraded: restoring a verified generation uses number 10 (not 3 or 9) and leaves the lone Quarantine generation as it was', rDeg.ok && run(cDeg, 'DS.gen') === 10 && cDeg.store.wa_g9_quarantine === loneText && J(genNums(cDeg.store)) === '[1,2,10]' && run(cDeg, 'dsScan().join()') === '1,2,9,10');
  const lowLone = Object.assign(corruptPtrs(clone(twoGens)), { wa_g3_quarantine: loneText }); // right above the highest verified generation
  const cLow = G(clone(lowLone)), rLow = run(cLow, "recoveryApply({kind:'generation', gen: 2}, null, 'RESTORE')");
  ok('degraded: a lone Quarantine generation right above the highest verified one is not overwritten either (new generation is 4)', rLow.ok && run(cLow, 'DS.gen') === 4 && cLow.store.wa_g3_quarantine === loneText);
  // the new generation still carries only its own Quarantine (the lone one is not merged by accident)
  ok('the lone generation\'s Quarantine items are not merged into the new generation by accident', !run(cN3, 'dsQuarantineGet()').some((q) => q.qid === 'q_lone'));

  // =====================================================================
  console.log('\n== 13. GENERATION DISCOVERY has no gap limit: degraded recovery, next number, protection of existing data ==');
  const copyGen = (src, from, to) => { const out = {}; ['plan', 'history', 'config', 'quarantine'].forEach((p) => { if (('wa_g' + from + '_' + p) in src) out['wa_g' + to + '_' + p] = src['wa_g' + from + '_' + p]; }); return out; };
  const sparse = (pairs) => pairs.reduce((st, [n, from]) => Object.assign(st, copyGen(twoGens, from, n)), {});
  const genKeys = (st) => Object.keys(st).filter((k) => /^wa_g\d+_/.test(k)).sort();
  const genBytes = (st) => J(genKeys(st).map((k) => [k, st[k]]));
  // ---- A. both pointers damaged, generations far apart (gaps of 198, 4800 and 95000 numbers) ----
  const gapsA = Object.assign(corruptPtrs({}), sparse([[1, 1], [200, 2], [5000, 1], [100000, 2]])), gapsABefore = J(gapsA);
  const cGA = G(clone(gapsA)), gapsAStart = J(cGA.store); // (start-up itself may write the plain version key; the Dry Run must write nothing on top of that)
  ok('degraded with gaps far above 64: dsScan finds every generation (1, 200, 5000, 100000)', run(cGA, 'DS.mode') === 'degraded' && J(run(cGA, 'dsScan()')) === '[1,200,5000,100000]');
  ok('degraded: all of them are listed as verified (restorable) and the next number is above the highest', J(run(cGA, 'dsListGenerations()').map((g) => [g.gen, g.role, g.ok])) === J([[1, 'AVAILABLE', true], [200, 'AVAILABLE', true], [5000, 'AVAILABLE', true], [100000, 'AVAILABLE', true]]) && run(cGA, 'dsNextGen()') === 100001);
  ok('degraded: a Dry Run of each far-apart generation works and writes nothing', [1, 200, 5000, 100000].every((n) => { const d = run(cGA, `recoveryDryRun({kind:'generation', gen: ${n}})`); return d.ok && d.degraded === true && d.counts.stay === (n === 1 || n === 5000 ? 6 : 4); }) && J(cGA.store) === gapsAStart);
  const dryA = run(cGA, "recoveryDryRun({kind:'generation', gen: 1})"), appA = run(cGA, `recoveryApply({kind:'generation', gen: 1}, ${J(dryA.hash)}, 'RESTORE')`);
  ok('degraded: the OLDEST generation (1) is restored as generation 100001 with a new pointer', appA.ok && appA.report.degraded === true && run(cGA, 'DS.mode') === 'gen' && run(cGA, 'DS.gen') === 100001 && run(cGA, "Store.get('history').length") === 6 && J(run(cGA, 'dsScan()')) === '[1,200,5000,100000,100001]');
  ok('degraded: nothing existing was overwritten or deleted (every wa_g key of the four generations is byte for byte the same)', genKeys(gapsA).every((k) => cGA.store[k] === gapsA[k]) && J(genKeys(gapsA).filter((k) => !(k in cGA.store))) === '[]');
  const cGA2 = G(clone(cGA.store));
  ok('restart after that: generation mode, the new pointer names 100001, and the next number is 100002', run(cGA2, 'DS.mode') === 'gen' && run(cGA2, 'DS.gen') === 100001 && run(cGA2, 'dsNextGen()') === 100002);
  const farOnly = Object.assign(corruptPtrs({}), sparse([[100000, 2]])), cFo = G(clone(farOnly)); const farApp = run(cFo, "recoveryApply({kind:'generation', gen: 100000}, null, 'RESTORE')");
  ok('degraded with a single far generation (100000): found and restorable', J(run(G(clone(farOnly)), 'dsScan()')) === '[100000]' && farApp.ok && run(cFo, 'DS.gen') === 100001);
  // ---- B. valid pointer, generations far apart ----
  const ptrB = { v: 1, gen: 9000, prev: 300, ts: 1, counts: { history: 4, sessions: 6, quarantine: 2 } };
  const gapsB = Object.assign(sparse([[1, 1], [300, 1], [9000, 2]]), { wa_ptr: J(ptrB), wa_ptr_bak: J(Object.assign({}, ptrB, { gen: 300, prev: 1 })) }), gapsBBefore = J(gapsB);
  const cGB = G(clone(gapsB));
  ok('valid pointer with gaps: generation mode, roles are IN USE (9000), PREVIOUS (300), OLDER (1); no false unfinished generation', run(cGB, 'DS.mode') === 'gen' && run(cGB, 'DS.gen') === 9000 && J(run(cGB, 'dsListGenerations()').map((g) => [g.gen, g.role])) === J([[1, 'OLDER'], [300, 'PREVIOUS'], [9000, 'CURRENT']]) && run(cGB, 'DS.orphans.length') === 0);
  ok('valid pointer with gaps: the next generation number is 9001', run(cGB, 'dsNextGen()') === 9001);
  const restB = run(cGB, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
  ok('restoring generation 1 creates 9001 and leaves 1, 300 and 9000 byte for byte', restB.ok && run(cGB, 'DS.gen') === 9001 && J(genKeys(gapsB).filter((k) => cGB.store[k] !== gapsB[k])) === '[]');
  const cGB2 = G(clone(gapsB));
  ok('manual deletion only removes the chosen old generation: 1 can be deleted, 300 (previous) and 9000 (in use) cannot', run(cGB2, 'dsCanDelete(1)') === true && run(cGB2, 'dsCanDelete(300)') === false && run(cGB2, 'dsCanDelete(9000)') === false && run(cGB2, 'dsDeleteGeneration(1)') === true && J(run(cGB2, 'dsScan()')) === '[300,9000]' && run(cGB2, 'dsNextGen()') === 9001);
  // ---- C. unfinished generations far above the current one ----
  const gapsC = Object.assign(clone(twoGens), copyGen(twoGens, 1, 10000), { wa_g50000_quarantine: loneText }), gapsCBefore = J(gapsC), cGC = G(clone(gapsC));
  ok('unfinished generations far above the current one are reported (10000 complete but not adopted, 50000 lone Quarantine)', run(cGC, 'DS.gen') === 2 && run(cGC, 'DS.orphans.join()') === '10000,50000' && run(cGC, 'dsNextGen()') === 50001);
  const appC = run(cGC, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
  ok('a restore there uses 50001 and does not touch either unfinished generation', appC.ok && run(cGC, 'DS.gen') === 50001 && genKeys(gapsC).every((k) => cGC.store[k] === gapsC[k]));
  // ---- D. dsNextGen never returns a number that exists (seeded random layouts, partial generations included) ----
  let seed = 12345; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  let badNext = [], trials = 0, maxSeen = 0;
  for (let i = 0; i < 40; i++) {
    const st = corruptPtrs({}), nums = new Set(); const k = 1 + rnd(6);
    while (nums.size < k) nums.add(1 + rnd(i % 2 ? 1000000 : 300));
    nums.forEach((n) => { const parts = ['plan', 'history', 'config', 'quarantine'].filter(() => rnd(2) === 1); if (!parts.length) parts.push('quarantine'); parts.forEach((p) => { st['wa_g' + n + '_' + p] = 'x'; }); });
    const c = G(clone(st)), sorted = Array.from(nums).sort((a, b) => a - b), scan = run(c, 'dsScan()'), nx = run(c, 'dsNextGen()');
    trials++; maxSeen = Math.max(maxSeen, sorted[sorted.length - 1]);
    if (J(scan) !== J(sorted)) badNext.push('scan ' + J(scan) + ' != ' + J(sorted));
    if (nums.has(nx) || nx <= sorted[sorted.length - 1]) badNext.push('next ' + nx + ' reuses/underruns ' + J(sorted));
  }
  ok('dsNextGen never reuses an existing number and dsScan finds every one (' + trials + ' random layouts, numbers up to ' + maxSeen + ', partial generations included)', badNext.length === 0 && trials === 40, badNext.slice(0, 3).join('; '));
  // ---- E. keys that only look like generation keys are ignored ----
  const noise = Object.assign(clone(twoGens), { wa_g12_other: 'x', wa_g_plan: 'x', wa_g007_plan: 'x', xwa_g5_plan: 'x', wa_g5_plans: 'x', wa_gabc_plan: 'x', wa_g5_Plan: 'x', wa_g99999999999999999999_plan: 'x', wa_g0_plan: 'x', 'wa_g-3_plan': 'x' });
  const cNz = G(noise);
  ok('look-alike keys (wrong part name, leading zeros, huge or non-numeric numbers, prefix/suffix) are not generations', J(run(cNz, 'dsScan()')) === '[1,2]' && run(cNz, 'dsNextGen()') === 3);
  // ---- F. the real storage can always be listed; a storage that cannot is handled by a bounded probe ----
  ok('the app lists real storage keys (Web Storage length/key) for discovery', run(G(clone(gapsA)), 'Store.rawKeys() !== null') === true);
  const listless = Object.assign(corruptPtrs({}), sparse([[1, 1], [40, 2]])), cLl = G(clone(listless), { noEnumerate: true });
  ok('a storage that cannot be listed gives NO discovery result at all (no bounded probe any more): scan and next number are unavailable', run(cLl, 'Store.rawKeys()') === null && run(cLl, 'dsScan()') === null && run(cLl, 'dsNextGen()') === null);

  // =====================================================================
  console.log('\n== 14. DISCOVERY UNAVAILABLE: no probe, no partial result, generation operations paused, nothing changes, normal operation returns ==');
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ok('the bounded probe is gone from the program (no 64-number window, no 1000 cap)', !/last \+ 64/.test(appSource) && !/n <= 1000/.test(appSource) && (appSource.match(/function dsScan\(/g) || []).length === 1);
  const setFlag = (v) => [(c) => { c.__listFail = v; }, (c) => { c.__listFail = null; }];
  const swapRawKeys = (body) => [(c) => run(c, `Store.__rk = Store.rawKeys; Store.rawKeys = ${body}`), (c) => run(c, 'Store.rawKeys = Store.__rk')];
  const failModes = [['localStorage.length throws', ...setFlag('length')], ['localStorage.key() throws', ...setFlag('key')], ['localStorage.length is not a number', ...setFlag('nan')],
    ['Store.rawKeys() returns null', ...swapRawKeys('() => null')], ['Store.rawKeys() throws', ...swapRawKeys("() => { throw new Error('rawKeys failed'); }")]];
  const importFile = goodFile({});
  for (const [label, fail, heal] of failModes) {
    // ---- generation mode (valid pointer, generations far apart) ----
    const cF = G(clone(gapsB)); fail(cF); const startJ = J(cF.store);
    const info = run(cF, "({ scan: dsScan(), avail: dsScanAvailable(), next: dsNextGen(), list: dsListGenerations().length, ptrMode: DS.mode, gen: DS.gen })");
    ok(label + ': discovery reports itself unavailable (scan and next number are null, the list is empty, never a partial result)', info.scan === null && info.avail === false && info.next === null && info.list === 0 && info.ptrMode === 'gen' && info.gen === 9000);
    const dries = [run(cF, "recoveryDryRun({kind:'generation', gen: 1})"), run(cF, "recoveryDryRun({kind:'legacy'})"), run(cF, `recoveryDryRun({kind:'backup', plan: buildImportPlan(${J(importFile)})})`)];
    ok(label + ': every Dry Run is refused with GENERATIONS_UNAVAILABLE (restore, original data, backup import)', dries.every((d) => d.ok === false && d.errors[0] === 'GENERATIONS_UNAVAILABLE'));
    const ap = run(cF, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')"), ap2 = run(cF, `recoveryApply({kind:'backup', plan: buildImportPlan(${J(importFile)})}, null, 'IMPORT')`);
    ok(label + ': a restore and an import are refused, the returned report says why and is not stored', ap.ok === false && ap.report.reason === 'GENERATIONS_UNAVAILABLE' && ap.report.saved === false && ap2.ok === false && ap2.report.reason === 'GENERATIONS_UNAVAILABLE');
    run(cF, `state.importOpen = true; state.importPreview = buildImportPlan(${J(importFile)}); commitImport()`);
    const direct = run(cF, "(function () { const g = dsReadGen(DS.gen); return dsCommit({ plan: g.plan, history: g.history, config: g.config }, { reason: 'T' }); })()");
    ok(label + ': creating a generation directly (the import button path and dsCommit) is refused as SCAN_UNAVAILABLE', direct.ok === false && direct.step === 'SCAN_UNAVAILABLE');
    ok(label + ': deleting a generation is refused', run(cF, 'dsCanDelete(1)') === false && run(cF, 'dsCanDelete(300)') === false && run(cF, 'dsDeleteGeneration(1)') === false);
    const scr = run(cF, "(state.screen='settings',openDataSafety(),renderDataSafety())");
    ok(label + ': Data Safety explains that discovery is temporarily unavailable and that generation operations are paused; no restore/delete buttons; import disabled', scr.includes('TEMPORARILY UNAVAILABLE') && scr.includes('paused') && scr.includes('Your data was not changed') && !scr.includes('dsRestoreGen(') && !scr.includes('dsDeleteStep(') && /<button class="ghost-btn" disabled onclick="dsNav\('import'\)"/.test(scr) && balanced(scr));
    ok(label + ': after all these attempts EVERY key and value in the storage is exactly as before', J(cF.store) === startJ);
    // routine saves do not depend on discovery, and the screen says so
    const cR = G(clone(gapsB)); fail(cR);
    ok(label + ': saving a workout and a setting still works (they do not need the generation list)', run(cR, "saveHistoryEntry(" + J(W('2026-10-20')) + ")") === true && run(cR, "Store.get('history').some(h => h.date === '2026-10-20')") === true && run(cR, "Store.setChecked('settings', {keepAwake: false})") === true);
    // ---- back to normal ----
    heal(cF);
    const back = run(cF, "({ scan: dsScan(), next: dsNextGen(), list: dsListGenerations().map(g => [g.gen, g.role]) })");
    ok(label + ': when listing works again the large gaps are discovered (1, 300, 9000) and the next number is 9001', J(back.scan) === '[1,300,9000]' && back.next === 9001 && J(back.list) === J([[1, 'OLDER'], [300, 'PREVIOUS'], [9000, 'CURRENT']]));
    const scrOk = run(cF, "(state.screen='settings',openDataSafety(),renderDataSafety())");
    ok(label + ': Data Safety is normal again (no warning, restore offered)', !scrOk.includes('TEMPORARILY UNAVAILABLE') && scrOk.includes('dsRestoreGen(1)'));
    const ap3 = run(cF, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
    ok(label + ': a restore works again and creates generation 9001 without touching 1, 300 or 9000', ap3.ok && run(cF, 'DS.gen') === 9001 && genKeys(gapsB).every((k) => cF.store[k] === gapsB[k]));
    // ---- degraded mode (both pointers damaged, generations 1, 200, 5000, 100000) ----
    const cD = G(clone(gapsA)); fail(cD); const dStart = J(cD.store);
    const dInfo = run(cD, "({ mode: DS.mode, scan: dsScan(), next: dsNextGen(), list: dsListGenerations().length })");
    const dDry = run(cD, "recoveryDryRun({kind:'generation', gen: 1})"), dApp = run(cD, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
    const dScr = run(cD, "(state.screen='settings',openDataSafety(),renderDataSafety())");
    ok(label + ' (degraded): no generation is listed or restorable, the Dry Run and the restore are refused, the screen explains, nothing changes', dInfo.mode === 'degraded' && dInfo.scan === null && dInfo.next === null && dInfo.list === 0 && dDry.errors[0] === 'GENERATIONS_UNAVAILABLE' && dApp.ok === false && dApp.report.reason === 'GENERATIONS_UNAVAILABLE' && dScr.includes('TEMPORARILY UNAVAILABLE') && !dScr.includes('dsRestoreGen(') && J(cD.store) === dStart);
    heal(cD);
    const dBack = run(cD, "({ scan: dsScan(), list: dsListGenerations().map(g => [g.gen, g.ok]) })");
    ok(label + ' (degraded): when listing works again the far-apart generations are found and listed as verified', J(dBack.scan) === '[1,200,5000,100000]' && J(dBack.list) === J([[1, true], [200, true], [5000, true], [100000, true]]));
    const dApp2 = run(cD, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
    ok(label + ' (degraded): and the restore then works (new generation 100001) with every old generation byte for byte', dApp2.ok && run(cD, 'DS.gen') === 100001 && genKeys(gapsA).every((k) => cD.store[k] === gapsA[k]));
  }
  // ---- failures that exist from the very start of the app ----
  for (const mode of ['length', 'key', 'nan']) {
    const legacyIn = Object.assign(legacyStore(), { wa_schemaVersion: '5' }), cS = G(clone(legacyIn), { listFail: mode });
    ok('start-up with a listing failure (' + mode + '): the migration is NOT performed (SCAN_UNAVAILABLE), nothing is written, the original data stays in use at version 5', run(cS, 'DS.mode') === 'legacy' && genNums(cS.store).length === 0 && !cS.store.wa_ptr && run(cS, 'DS.notices.some(n => n.code === "MIGRATION_FAILED" && n.step === "SCAN_UNAVAILABLE")') && cS.store.wa_schemaVersion === '5' && legacyBytes(cS.store) === legacyBytes(legacyIn));
    ok('start-up with a listing failure (' + mode + '): the app works on the original storage', balanced(run(cS, 'renderHome()')) && run(cS, "Store.get('history').length") === 4 && run(cS, "saveHistoryEntry(" + J(W('2026-10-21')) + ")") === true);
    const cOk = G(clone(legacyIn));
    ok('start-up with a listing failure (' + mode + '): the next start with listing available completes the migration normally', run(cOk, 'DS.mode') === 'gen' && run(cOk, 'DS.gen') === 1 && cOk.store.wa_schemaVersion === '6' && run(cOk, "Store.get('history').length") === 4);
    const cG = G(clone(gapsB), { listFail: mode });
    ok('start-up with a listing failure (' + mode + ') on already migrated data: generation mode stays, the unfinished-generation list is simply unknown, saving works', run(cG, 'DS.mode') === 'gen' && run(cG, 'DS.gen') === 9000 && run(cG, 'DS.orphans.length') === 0 && run(cG, "saveHistoryEntry(" + J(W('2026-10-22')) + ")") === true);
    const cGd = G(clone(gapsA), { listFail: mode });
    ok('start-up with a listing failure (' + mode + ') in degraded mode: still degraded, no generation operation possible, no write', run(cGd, 'DS.mode') === 'degraded' && run(cGd, 'dsScan()') === null && run(cGd, "recoveryDryRun({kind:'generation', gen: 1})").errors[0] === 'GENERATIONS_UNAVAILABLE');
  }
  // ---- the earlier protections still hold when listing works ----
  const cStill = G(clone(gapsA));
  ok('with listing available the far-apart generations are still found and restorable in degraded mode (previous round unchanged)', J(run(cStill, 'dsScan()')) === '[1,200,5000,100000]' && run(cStill, "recoveryApply({kind:'generation', gen: 200}, null, 'RESTORE')").ok === true && run(cStill, 'DS.gen') === 100001);

  // =====================================================================
  console.log('\n== 15. DISCOVERY FAILS HALFWAY: the space estimate is never computed without the generations ==');
  const failAfter = (c, k) => run(c, `Store.__rk = Store.rawKeys; Store.rawKeys = (function () { let n = 0; const rk = Store.__rk; return () => (++n <= ${k} ? rk() : null); })()`); // the first k listings work, every later one fails
  const healKeys = (c) => run(c, 'Store.rawKeys = Store.__rk');
  const cU1 = G(clone(gapsB)); const u1Start = J(cU1.store);
  ok('dsUsedChars returns a number while listing works', typeof run(cU1, 'dsUsedChars()') === 'number' && run(cU1, 'dsUsedChars()') > 0);
  failAfter(cU1, 1);
  const u1 = run(cU1, '(function () { const a = dsScan(); const u = dsUsedChars(); return [a !== null, u]; })()');
  ok('first listing succeeds, the next one (inside dsUsedChars) fails: dsUsedChars returns null, not a smaller total', u1[0] === true && u1[1] === null);
  healKeys(cU1); failAfter(cU1, 0);
  const sc1 = run(cU1, 'dsSpaceCheck(10)'), sc2 = run(cU1, 'dsSpaceCheck(0)');
  ok('dsSpaceCheck refuses explicitly when the estimate is missing, even for a tiny request: ok=false, unavailable=true, used=null', sc1.ok === false && sc1.unavailable === true && sc1.used === null && sc2.ok === false && sc2.unavailable === true);
  cU1.WA_STORAGE_LIMIT_CHARS = 1e12; const sc3 = run(cU1, 'dsSpaceCheck(1)');
  ok('...and a huge capacity never makes the missing estimate count as enough space', sc3.ok === false && sc3.unavailable === true);
  cU1.WA_STORAGE_LIMIT_CHARS = undefined; healKeys(cU1);
  ok('after listing works again the estimate returns and the space check answers normally', typeof run(cU1, 'dsUsedChars()') === 'number' && run(cU1, 'dsSpaceCheck(10)').ok === true && run(cU1, 'dsSpaceCheck(10)').unavailable === undefined);
  // dsCommit: listing works for the generation number, fails while the space is counted
  const cU2 = G(clone(gapsB)); const u2Start = J(cU2.store); failAfter(cU2, 1);
  const commitFail = run(cU2, "(function () { const g = dsReadGen(DS.gen); return dsCommit({ plan: g.plan, history: g.history, config: g.config }, { reason: 'T' }); })()");
  ok('dsCommit: a failure while the space is counted gives SCAN_UNAVAILABLE (not SPACE, not success) and writes no key at all', commitFail.ok === false && commitFail.step === 'SCAN_UNAVAILABLE' && J(cU2.store) === u2Start);
  healKeys(cU2);
  const commitOk = run(cU2, "(function () { const g = dsReadGen(DS.gen); return dsCommit({ plan: g.plan, history: g.history, config: g.config }, { reason: 'T' }); })()");
  ok('dsCommit works normally once listing is back (generation 9001)', commitOk.ok === true && commitOk.gen === 9001 && run(cU2, 'DS.gen') === 9001);
  // the Dry Run: failure exactly at the space estimate is reported as unavailable discovery, never as lack of space
  const cU3 = G(clone(gapsB)); const u3Start = J(cU3.store); failAfter(cU3, 2);
  const dry3 = run(cU3, "recoveryDryRun({kind:'generation', gen: 1})");
  ok('Dry Run: failing at the space estimate reports GENERATIONS_UNAVAILABLE (never NOT_ENOUGH_SPACE) and writes nothing', dry3.ok === false && dry3.errors[0] === 'GENERATIONS_UNAVAILABLE' && !dry3.errors.includes('NOT_ENOUGH_SPACE') && dry3.space && dry3.space.unavailable === true && J(cU3.store) === u3Start);
  // sweep: the listing starts failing after k successful listings, for every k; the whole restore is attempted each time
  let sweepBad = [], refusedDry = 0, refusedCommit = 0, committed = 0;
  for (let k = 0; k <= 12; k++) {
    const c = G(clone(gapsB)), start = J(c.store); failAfter(c, k);
    const out = run(c, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
    if (out.ok) {
      committed++;
      const g = run(c, 'dsReadGen(DS.gen)');
      if (!g || run(c, 'DS.gen') !== 9001 || !genKeys(gapsB).every((x) => c.store[x] === gapsB[x])) sweepBad.push('k=' + k + ' committed but inconsistent');
    } else {
      const r = out.report.reason;
      if (r === 'GENERATIONS_UNAVAILABLE') refusedDry++; else if (r === 'SCAN_UNAVAILABLE') refusedCommit++; else sweepBad.push('k=' + k + ' refused with ' + r);
      if (J(c.store) !== start) sweepBad.push('k=' + k + ' store changed by a refused restore');
      healKeys(c);
      const again = run(c, "recoveryApply({kind:'generation', gen: 1}, null, 'RESTORE')");
      if (!again.ok || run(c, 'DS.gen') !== 9001) sweepBad.push('k=' + k + ' no normal restore after healing');
    }
  }
  ok('sweep: listing failing after k successful listings (k = 0..12): every attempt is either a complete restore or a refusal that changed nothing; refusals happen at the Dry Run AND inside the commit; healing always restores normal work', sweepBad.length === 0 && refusedDry >= 2 && refusedCommit >= 1 && committed >= 1, J({ sweepBad, refusedDry, refusedCommit, committed }));
  // Data Safety shows that the estimate is unavailable instead of a wrong number
  const cU4 = G(clone(gapsB)); run(cU4, "state.screen='settings'");
  const okScr = run(cU4, 'openDataSafety(), renderDataSafety()');
  ok('normal screen: the storage estimate is shown as numbers', okScr.includes('Storage used: about') && !okScr.includes('Storage estimate unavailable') && !okScr.includes('TEMPORARILY UNAVAILABLE'));
  run(cU4, 'Store.__rk = Store.rawKeys; Store.rawKeys = () => null');
  const noScr = run(cU4, 'renderDataSafety()');
  ok('listing failed: the screen says the storage estimate is unavailable, shows no number, and shows the pause message', noScr.includes('Storage estimate unavailable') && !noScr.includes('Storage used') && !/NaN|undefined|null KB/.test(noScr) && noScr.includes('TEMPORARILY UNAVAILABLE') && balanced(noScr));
  healKeys(cU4); failAfter(cU4, 1);
  const halfScr = run(cU4, 'renderDataSafety()');
  ok('listing fails in the middle of drawing the screen: it still shows the estimate as unavailable and the pause message, never a wrong total or an empty list without warning', halfScr.includes('Storage estimate unavailable') && halfScr.includes('TEMPORARILY UNAVAILABLE') && !/NaN|null KB/.test(halfScr));
  healKeys(cU4);
  const backScr = run(cU4, 'renderDataSafety()');
  ok('listing is back: the screen shows the numbers and the list again', backScr.includes('Storage used: about') && !backScr.includes('TEMPORARILY UNAVAILABLE') && backScr.includes('GENERATION 300'));
  const cU5 = G(clone(gapsB)); run(cU5, "state.screen='settings';openDataSafety();dsRestoreGen(1)"); failAfter(cU5, 2);
  const sumScr = run(cU5, 'state.ds.dry = recoveryDryRun(state.ds.src); renderDataSafety()');
  ok('review screen of a refused Dry Run: explains the pause and never prints "Needed about" with a missing estimate', sumScr.includes('temporarily unavailable') && !sumScr.includes('Needed about') && balanced(sumScr));
  // the migration at start-up with the failure inside the space check
  let migBadU = [], migDone = 0, migSafe = 0;
  for (let k = 0; k <= 6; k++) {
    const legacyIn = Object.assign(legacyStore(), { wa_schemaVersion: '5' }), start = J(legacyIn), c = G(clone(legacyIn), { deferInit: true });
    failAfter(c, k); c.document.__init();
    if (run(c, 'DS.mode') === 'gen') { migDone++; if (!run(c, 'dsReadGen(DS.gen)') || c.store.wa_schemaVersion !== '6' || legacyBytes(c.store) !== legacyBytes(legacyIn)) migBadU.push('k=' + k + ' incomplete migration'); }
    else { migSafe++; if (genNums(c.store).length || c.store.wa_ptr || c.store.wa_schemaVersion !== '5' || J(Object.assign({}, c.store, { wa_schemaVersion: '5' })) !== start) migBadU.push('k=' + k + ' wrote something'); }
    healKeys(c);
  }
  ok('start-up migration with listing failing after k listings (k = 0..6): either a complete, verified migration or nothing written at all (version stays 5)', migBadU.length === 0 && migSafe >= 2 && migDone >= 1, J({ migBadU, migSafe, migDone }));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (GEN_VIEW ? '  (Phase 2 sections AFTER the migration)' : '  (Phase 2 sections before the migration + Data Safety sections)'));
let secondFailed = false;
if (!GEN_VIEW && !process.env.WA_NO_SECOND_RUN) { // the same Phase 2 sections again, but on migrated data (generation storage); sections 9-10 only run in the first pass
  const cp = require('child_process').spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { WA_TEST_MODE: 'gen' }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  console.log('\n===== SECOND RUN: Phase 2 sections AFTER the migration (generation view) =====');
  console.log(cp.stdout); if (cp.stderr) console.log(cp.stderr);
  if (cp.status !== 0) { secondFailed = true; console.log('SECOND RUN FAILED (exit ' + cp.status + ')'); }
}
if (fail || secondFailed) { if (fail) console.log('\nFAILED:\n- ' + failures.join('\n- ')); process.exit(1); }

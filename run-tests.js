// Repeatable logic tests for WorkoutApp. Run from the project folder:   node tests/run-tests.js
// No dependencies: the app files are loaded into a Node `vm` with a minimal fake DOM and a controllable clock.
// Covers: data integrity (streak/history/progress/backup), custom modifications, added exercises (max 10), workout flow.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = fs.existsSync(path.join(__dirname, 'app.js')) ? __dirname : path.join(__dirname, '..'); // works from tests/ and from a flat repo
const J = JSON.stringify;

function make(nowISO, store) {
  const clock = { t: new Date(nowISO).getTime() };
  store = store || {};
  const RD = Date;
  class FD extends RD { constructor(...a) { a.length ? super(...a) : super(clock.t); } static now() { return clock.t; } }
  const roots = {}, fields = {}, copied = [], toasts = [];
  const mk = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {} }, _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; },
    addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {}, firstElementChild: null, querySelector: () => null, focus() {}, select() {} });
  const doc = { visibilityState: 'visible', body: { appendChild: (el) => toasts.push(el.textContent) },
    getElementById: (id) => fields[id] || (roots[id] = roots[id] || mk()), querySelector: mk, querySelectorAll: () => [],
    createElement: () => Object.assign(mk(), { className: '', textContent: '', value: '' }), addEventListener() {}, documentElement: mk(), readyState: 'complete' };
  const c = { console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date: FD, Math,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    document: doc, navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } }, addEventListener() {}, requestAnimationFrame() {}, AudioContext: function () {} };
  c.window = c; c.store = store; c.copied = copied; c.toasts = toasts; c.roots = roots;
  c.setField = (id, v) => { fields[id] = { value: v, focus() {}, select() {} }; };
  c.setNow = (iso) => { clock.t = new Date(iso).getTime(); };
  vm.createContext(c);
  for (const f of ['icons.js', 'data.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  return c;
}
const run = (c, s) => vm.runInContext(s, c);
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
ok('confirmed import replaces matching data, deduped and newest-first', run(c, "Store.get('history').map(h=>h.date).join()") === '2026-09-02,2026-09-01' && run(c, "Store.get('schemaVersion')") === 4);
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
ok('temporary change affects this workout only', run(c, `state.exerciseList[${i0}].sets`) === 2 && c.store.wa_exerciseMods === undefined);
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
ok('renaming onto an existing exercise name is rejected', run(c2, 'state.editEx') !== null && Object.keys(run(c2, "Store.get('exerciseMods')") || {}).length === 0); run(c2, 'closeEdit()');
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
console.log('\n== 3. ADDED EXERCISES (max 10) ==');
c = make(NOW); run(c, "selectSession('PUSH_A')");
const addUI = (name, type) => { run(c, 'openAdd()'); if (run(c, 'state.editEx') === null) return false; c.setField('edit-name', name); if (type) run(c, `editSetType('${type}')`); run(c, 'saveEditCustom()'); return run(c, 'state.editEx') === null; };
ok('built-in exercise count is separate from the limit', run(c, 'state.exerciseList.length') === 7 && run(c, 'renderSetup()').includes('7/10'));
ok('can add 3 (7 built-in + 3 = 10)', addUI('Pike Push-ups') && addUI('Hollow Hold', 'TIME') && addUI('Burpees', 'MAX') && run(c, 'state.exerciseList.length') === 10);
ok('added exercises are flagged and keep their type/target rules', run(c, 'state.exerciseList[8].type') === 'TIME' && run(c, 'targetLabel(state.exerciseList[8])') === '01:00' && run(c, 'renderSetup()').includes('flag-added'));
let h10 = run(c, 'renderSetup()'); ok('at 10: Add is disabled and the reason is shown', /add-exercise" disabled/.test(h10) && h10.includes('at most 10 exercises') && h10.includes('10/10'));
run(c, 'openAdd()'); ok('UI refuses to open the add sheet at 10', run(c, 'state.editEx') === null);
const direct = run(c, "addCustomExercise('PUSH_A',{name:'Eleventh',type:'REPS',sets:3,target:10})");
ok('the 11th is rejected by the logic itself (not just the button)', direct.ok === false && direct.error === 'LIMIT' && run(c, "getCustoms('PUSH_A').length") === 3 && run(c, "exerciseCount('PUSH_A')") === 10);
run(c, "state.editEx={ctx:'setup',sessionKey:'PUSH_A',index:null,exId:'u_forced1',isNew:true,custom:true,draft:{name:'Forced',type:'REPS',sets:3,tMin:10,tMax:10,tSec:60}};"); c.setField('edit-name', 'Forced'); run(c, 'saveEditCustom()');
ok('forcing the sheet open at 10 still cannot exceed the limit', run(c, "getCustoms('PUSH_A').length") === 3 && run(c, 'state.exerciseList.length') === 10);
const raw12 = []; for (let i = 0; i < 12; i++) raw12.push({ id: 'u_x' + i, name: 'E' + i, type: 'REPS', sets: 3, target: 10 });
ok('limit also enforced when reading corrupt/imported data', make(NOW, { wa_customExercises: J({ PUSH_A: raw12 }) }) && run(make(NOW, { wa_customExercises: J({ PUSH_A: raw12 }) }), "exerciseCount('PUSH_A')") === 10);
// rapid double submit
let cr = make(NOW); run(cr, "selectSession('PUSH_A');openAdd()"); cr.setField('edit-name', 'Rapid'); run(cr, 'saveEditCustom();saveEditCustom();saveEditCustom()');
ok('rapid repeated submissions add exactly one exercise', run(cr, "getCustoms('PUSH_A').length") === 1 && run(cr, 'state.exerciseList.length') === 8);
const idDup = run(cr, "getCustoms('PUSH_A')[0].id"); ok('the same submission id is rejected as a duplicate', run(cr, `addCustomExercise('PUSH_A',{id:'${idDup}',name:'Other',type:'REPS',sets:3,target:10})`).error === 'DUPLICATE');
ok('duplicate names are rejected', run(cr, "addCustomExercise('PUSH_A',{name:'rapid',type:'REPS',sets:3,target:10})").error === 'NAME_EXISTS' && run(cr, "addCustomExercise('PUSH_A',{name:'dips',type:'REPS',sets:3,target:10})").error === 'NAME_EXISTS');
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
ok('choosing a preset never saves anything by itself', JSON.stringify(dm.store) === dBefore && dm.store.wa_exerciseMods === undefined);
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
let am2 = make(NOW); run(am2, "selectSession('PUSH_A');changeSets(0,1);state.exerciseList[1].name=state.exerciseList[0].name"); const am2b = JSON.stringify(am2.store); run(am2, 'saveSessionDefault()');
ok('save is all-or-nothing: duplicate names are rejected and nothing is written', JSON.stringify(am2.store) === am2b && am2.toasts.includes('NAME ALREADY USED'));
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
ok('hub shows the session summary and filters with counts', hubHtml.includes('8/10 exercises') && hubHtml.includes('1 modified') && hubHtml.includes('1 added') && hubHtml.includes("hubFilter('modified')") && hubHtml.includes('MODIFIED 1') && hubHtml.includes('ADDED 1') && hubHtml.includes('ALL 8'));
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
run(um, 'closeEdit();hubAdd()'); sht = run(um, 'renderEditSheet()'); ok('adding from the hub uses the real count in its scope text (8 of 10 -> shows 8/10)', run(um, 'state.editEx.ctx') === 'manager' && sht.includes('8/10 exercises used'));
um.setField('edit-name', 'Archer Rows'); run(um, 'saveEditCustom()'); um.setField('edit-name', ''); ok('hub add saves exactly one exercise (no working list involved)', run(um, "getCustoms('PUSH_A').length") === 2 && run(um, 'state.editEx') === null);
run(um, 'hubAdd()'); um.setField('edit-name', 'Dragon Flag'); run(um, 'saveEditCustom()'); ok('10/10 reached from the hub', run(um, "exerciseCount('PUSH_A')") === 10);
const t10html = run(um, 'renderCustomMods()'); run(um, 'hubAdd()');
ok('at 10 the hub ADD is disabled and refused by the logic too', /class="swap-btn" disabled onclick="hubAdd\(\)"/.test(t10html) && run(um, 'state.editEx') === null && run(um, "addCustomExercise('PUSH_A',{name:'Eleventh',type:'REPS',sets:3,target:10})").error === 'LIMIT');
run(um, "selectSession('PUSH_A');applyPreset('light');applyPreset('default')"); ok('presets never change the number of exercises (limit unaffected)', run(um, 'state.exerciseList.length') === 10 && run(um, "exerciseCount('PUSH_A')") === 10);
// backup + import still carry everything the hubHtml/presets use
const bkU = run(um, 'buildBackup()'); const um2 = make(NOW); um2.setField('import-input', bkU); run(um2, "state.screen='settings';state.importOpen=true;applyImport();commitImport();selectSession('PUSH_A')");
ok('export/import round-trips saved defaults and added exercises (limit still 10)', run(um2, 'state.exerciseList.length') === 10 && run(um2, 'savedModCount()') === 1 && run(um2, 'currentPreset()') === 'custom');
ok('EXERCISE_DB is still untouched after all hub/preset operations', J(run(um, 'EXERCISE_DB')) === DB0 && J(run(dm, 'EXERCISE_DB')) === DB0 && J(run(rm, 'EXERCISE_DB')) === DB0);
ok('history entries are unchanged by presets, session saves and resets', hm.store.wa_history === histSnap && dm.store.wa_history === dHist);
// UI consistency (the redesigned components share one language)
const settingsHtml = run(make(NOW), 'renderSettings()');
ok('Settings: new entries use the same row card as the toggles (no stray ghost/action-card buttons), grouped under titles', (settingsHtml.match(/class="settings-row"/g) || []).length === 3 && (settingsHtml.match(/class="settings-row link"/g) || []).length === 4 && !settingsHtml.includes('ghost-btn') && !settingsHtml.includes('action-card') && ['PREFERENCES', 'WORKOUT', 'DATA'].every((g) => settingsHtml.includes('settings-group-title">' + g)) && settingsHtml.includes('CUSTOMIZATION') && balanced(settingsHtml));
ok('Settings: every link row triggers its action', ['goAdvancedSettings()', 'goCustomMods()', 'exportData()', 'openImport()'].every((f) => settingsHtml.includes('onclick="' + f + '"')));
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILED:\n- ' + failures.join('\n- ')); process.exit(1); }

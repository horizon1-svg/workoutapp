// app.js — WorkoutApp core logic (vanilla JS, no build step, no external runtime deps)

// ---------- Local calendar date (NOT UTC) ----------
// toISOString() always returns the UTC date, which is wrong for anyone in a positive-offset
// timezone shortly after local midnight. Streaks and history dates use the user's local day.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function localYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1); // calendar-day subtraction, safe across DST changes
  return localDateStr(d);
}

// ---------- Storage (localStorage with in-memory fallback so a preview
// sandbox that blocks storage doesn't crash the app — see spec section 17) ----------
const Store = (() => {
  let memoryFallback = {};
  let useLocal = true;
  try {
    localStorage.setItem('__wa_test__', '1');
    localStorage.removeItem('__wa_test__');
  } catch (e) {
    useLocal = false;
  }
  return {
    get(key, fallback) {
      if (useLocal) {
        try {
          const raw = localStorage.getItem('wa_' + key);
          return raw !== null ? JSON.parse(raw) : fallback;
        } catch (e) { /* fall through to memory */ }
      }
      return Object.prototype.hasOwnProperty.call(memoryFallback, key) ? memoryFallback[key] : fallback;
    },
    set(key, value) {
      // Always mirror into memory too, so if localStorage starts failing mid-session
      // (quota, private-mode flip) get() still returns the last value we wrote.
      memoryFallback[key] = value;
      if (useLocal) {
        try {
          localStorage.setItem('wa_' + key, JSON.stringify(value));
        } catch (e) { /* memory copy above already holds the value */ }
      }
    },
  };
})();

// ---------- Random accent theme ----------
// Only --accent/--accent-soft/--accent-press/--accent-text/--shadow-accent change; every other
// token (background, card colors, text hierarchy, grayscale) is untouched by this.
const ACCENT_THEMES = [
  { name: 'red', accent: '#e5303f', soft: 'rgba(229, 48, 63, 0.14)', press: '#c72432', text: '#fff', shadow: 'rgba(229, 48, 63, 0.28)' },
  { name: 'yellow', accent: '#e8b023', soft: 'rgba(232, 176, 35, 0.16)', press: '#c8961b', text: '#14140f', shadow: 'rgba(232, 176, 35, 0.30)' },
  { name: 'blue', accent: '#3468f0', soft: 'rgba(52, 104, 240, 0.16)', press: '#2650c2', text: '#fff', shadow: 'rgba(52, 104, 240, 0.30)' },
];
function applyAccentTheme(theme) {
  const r = document.documentElement.style;
  r.setProperty('--accent', theme.accent);
  r.setProperty('--accent-soft', theme.soft);
  r.setProperty('--accent-press', theme.press);
  r.setProperty('--accent-text', theme.text);
  r.setProperty('--shadow-accent', `0 8px 22px ${theme.shadow}`);
}
function initAccentTheme() {
  // Chosen once and persisted, so a refresh doesn't unexpectedly change the theme mid-session.
  let name = Store.get('accentTheme', null);
  let theme = ACCENT_THEMES.find((t) => t.name === name);
  if (!theme) {
    theme = ACCENT_THEMES[Math.floor(Math.random() * ACCENT_THEMES.length)];
    Store.set('accentTheme', theme.name);
  }
  applyAccentTheme(theme);
}

// ---------- Settings ----------
function getSettings() {
  // Merge (not just fall back), so a settings object saved before motivationCards existed still
  // gets the new key defaulted to true instead of undefined.
  return Object.assign({ keepAwake: true, alertSound: true, motivationCards: true }, ADVANCED_DEFAULTS, Store.get('settings', {}));
}

// ---------- Advanced settings (durations) ----------
// Fallbacks stay in data.js; the live values are read from getSettings() when each phase starts,
// so a change never touches a countdown that is already running.
const ADVANCED_DEFAULTS = {
  restSeconds: DEFAULT_REST_SECONDS,
  setSeconds: DEFAULT_SET_SECONDS,
  warmupSeconds: WARMUP_DEFAULT_SECONDS,
  readySeconds: 3,
  motivRotateSeconds: MOTIV_ROTATE_SECONDS
};
const ADVANCED_FIELDS = [
  { key: 'restSeconds',        label: 'REST BETWEEN SETS',   min: 10, max: 600, step: 10, mmss: true },
  { key: 'setSeconds',         label: 'SET TIME LIMIT',      min: 30, max: 600, step: 10, mmss: true },
  { key: 'warmupSeconds',      label: 'WARM-UP STEP',        min: 5,  max: 180, step: 5,  mmss: true },
  { key: 'readySeconds',       label: 'GET READY COUNTDOWN', min: 0,  max: 10,  step: 1 },
  { key: 'motivRotateSeconds', label: 'MOTIVATION CARD',     min: 3,  max: 30,  step: 1 }
];
function clampSetting(key, val) {
  const f = ADVANCED_FIELDS.find(x => x.key === key);
  const n = Math.round(Number(val));
  if (!f || isNaN(n)) return ADVANCED_DEFAULTS[key];
  return Math.min(f.max, Math.max(f.min, n));
}
function changeSetting(key, delta) {
  const f = ADVANCED_FIELDS.find(x => x.key === key);
  if (!f) return;
  const s = getSettings();
  s[key] = clampSetting(key, s[key] + delta * f.step);
  Store.set('settings', s);
  render();
}
function resetAdvancedSettings() {
  const s = Object.assign(getSettings(), ADVANCED_DEFAULTS);
  Store.set('settings', s);
  render();
}
// Warm-up steps that use the shared default length follow the setting; steps with their own
// explicit length (Jumping Jacks, Dead Hang, ...) keep it.
function resolveWarmupDuration(item) {
  const own = item.duration;
  if (own == null || own === WARMUP_DEFAULT_SECONDS) return clampSetting('warmupSeconds', getSettings().warmupSeconds);
  return own;
}
function toggleSetting(key) {
  const s = getSettings();
  s[key] = !s[key];
  Store.set('settings', s);
  if (key === 'keepAwake') {
    s[key] ? requestWakeLockIfEnabled() : releaseWakeLock();
  }
  render();
}

// ---------- Wake Lock (section 18) ----------
let wakeLockSentinel = null;
async function requestWakeLockIfEnabled() {
  if (!getSettings().keepAwake || wakeLockSentinel) return; // already held — don't double-request
  try {
    if ('wakeLock' in navigator) {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel = sentinel;
      // The browser drops the lock when the app is hidden; forget it so it can be re-requested.
      sentinel.addEventListener('release', () => { if (wakeLockSentinel === sentinel) wakeLockSentinel = null; });
    }
  } catch (e) { /* unsupported / denied — silently ignore, not critical */ }
}
function releaseWakeLock() {
  if (wakeLockSentinel) {
    try { wakeLockSentinel.release(); } catch (e) { /* ignore */ }
    wakeLockSentinel = null;
  }
}

// ---------- Sound (section 19) — synthesized tones, no external asset ----------
// One shared AudioContext, created lazily on first use and reused for the rest of
// the session, instead of a fresh context per sound (a real fitness session can
// trigger dozens of them, and browsers cap how many contexts can be alive at once).
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}
// Schedules one tone `startOffset` seconds from now. peakGain 0-1.
function scheduleTone(ctx, freq, startOffset, duration, peakGain, waveType) {
  const t0 = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = waveType;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}
// Loud, attention-grabbing alert for timer completion (TIME'S UP, warm-up step
// done, rest complete) — three sharp beeps, since a single soft tone is easy to
// miss mid-set in a noisy gym. Respects the SYSTEM ALERT SOUND setting.
function playBeep() {
  if (!getSettings().alertSound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.16, 0.32].forEach((offset) => scheduleTone(ctx, 1050, offset, 0.14, 0.55, 'triangle'));
  } catch (e) { /* audio unsupported — ignore */ }
}
// Short, quiet tap click for button/icon presses — same setting, much lower
// volume and duration so it reads as feedback, not noise, on rapid taps.
function playTapSound() {
  if (!getSettings().alertSound) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    scheduleTone(ctx, 1300, 0, 0.045, 0.12, 'sine');
  } catch (e) { /* audio unsupported — ignore */ }
}

// ---------- Helpers ----------
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}
function fmtDuration(totalSeconds) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 1) return '<1 MIN';
  if (mins < 60) return `${mins} MIN`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}H ${m}M` : `${h}H`;
}
function targetLabel(ex) {
  if (!ex || typeof ex !== 'object') return '';
  if (ex.type === 'MAX') return 'MAX CLEAN REPS';
  if (ex.type === 'TIME') return isNum(ex.target) ? fmtTime(ex.target) : 'TIMED';
  if (Array.isArray(ex.target)) return `${ex.target[0]}\u2013${ex.target[1]} REPS`;
  return isNum(ex.target) ? `${ex.target} REPS` : 'REPS';
}
function ringSvg(remaining, total, size, stroke) {
  size = size || 240;
  stroke = stroke || 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const offset = c * (1 - pct);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="timer-ring">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}" fill="none"></circle>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-progress" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>
  </svg>`;
}
// Ring + centered time readout as one overlaid unit (avoids fragile margin math)
function timerBlock(remaining, total, size) {
  size = size || 240;
  return `<div class="timer-wrap" style="width:${size}px;height:${size}px">
    ${ringSvg(remaining, total, size)}
    <div class="timer-readout">${fmtTime(remaining)}</div>
  </div>`;
}

// ---------- State ----------
let state = {
  screen: 'home',      // home | setup | warmup | active | complete | history | settings
  subState: 'idle',     // (within 'active') timer | timeup | repsInput | rest | restComplete
  sessionKey: null,
  exerciseList: [],
  warmupList: [],
  warmupIdx: 0,
  curExerciseIdx: 0,
  curSet: 1,
  results: [],
  timedOut: false,
  paused: false,
  timer: { remaining: 0, total: 0, intervalId: null },
  drawerOpen: false,
  progress: null, // Training Progress screen: { month, selected, metric, range, bar, exportRange }
  importOpen: false, // import-backup dialog (Settings)
  lastEntry: null, // history entry of the workout just finished (for COPY SUMMARY)
  offlineMs: 0, // time the app was closed mid-workout; excluded from the recorded duration
  timeEdit: null, // {} while the custom add/remove-time dialog is open (Warm-up / Rest)
  hub: null, // customization hub: { session, filter }
  setupPreset: 'default', // last explicitly chosen Quick Setup preset (the shown selection is re-derived from the data)
  editEx: null, // Edit/Add exercise sheet: { ctx, sessionKey, exId, index, isNew, custom, draft }
  importPreview: null, // validated import waiting for confirmation
  importDraft: '',
  historyFocus: null, // date to highlight when History is opened from the calendar // { index } while the replace-exercise dialog is open (Setup screen only)
  confirmAction: null, // { kind: 'skipSet' | 'skipExercise' } — set to show the confirm overlay; cleared on cancel/confirm
  lastSummary: null,
  sessionStartedAt: null, // epoch ms — set when a workout begins, used to compute duration
};

function currentExercise() {
  return state.exerciseList[state.curExerciseIdx];
}

// ---------- Generic countdown ----------
// Uses an absolute end timestamp (state.timer.endsAt) instead of counting ticks, so a throttled
// or suspended interval self-corrects on its next run instead of drifting behind real time.
// resumeEndsAt (optional) lets a saved session continue with its true remaining time.
function startCountdown(seconds, onTick, onComplete, resumeEndsAt) {
  clearInterval(state.timer.intervalId);
  state.timer.total = seconds;
  state.timer.endsAt = resumeEndsAt || (Date.now() + seconds * 1000);
  state.timer.remaining = Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
  state.pausedAt = null;
  onTick();
  state.timer.intervalId = setInterval(() => {
    if (state.paused) return;
    const remaining = Math.ceil((state.timer.endsAt - Date.now()) / 1000);
    if (remaining <= 0) {
      state.timer.remaining = 0;
      clearInterval(state.timer.intervalId);
      onComplete();
    } else if (remaining !== state.timer.remaining) {
      state.timer.remaining = remaining;
      onTick();
    }
  }, 250);
}

// ---------- Navigation ----------
function goHome() {
  clearInterval(state.timer.intervalId);
  hideRestVisual();
  releaseWakeLock();
  state.paused = false;
  state.pausedAt = null;
  state.screen = 'home';
  render();
}
function goHistory() { state.historyFocus = null; state.screen = 'history'; render(); }
function goHistoryDate(ds) {
  state.historyFocus = ds; state.screen = 'history'; render();
  setTimeout(() => { const el = document.getElementById('hist-focus'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 0);
}
function goSettings() { state.screen = 'settings'; render(); }
function goAdvancedSettings() { state.screen = 'advancedSettings'; render(); }

// ---------- Home / session select ----------
function selectSession(key) {
  if (key === 'REST') { completeRestDay(); return; }
  state.sessionKey = key;
  state.exerciseList = buildSessionList(key); // defaults + saved modifications + added exercises
  state.setupPreset = savedModCount() > 0 ? 'custom' : 'default';
  state.editEx = null;
  state.screen = 'setup';
  render();
}
function completeRestDay() {
  const today = localDateStr();
  const already = Store.get('history', []).some((h) => h.type === 'REST' && h.date === today);
  if (!already) saveHistoryEntry({ type: 'REST', date: today, status: 'COMPLETED' }); // one rest entry per day
  render();
}
const AWAY_THRESHOLD_MS = 10 * 60 * 1000;
function resumeSession() {
  const saved = Store.get('activeSession', null);
  if (!saved) return;
  state.sessionKey = saved.sessionKey;
  state.exerciseList = saved.exerciseList;
  state.results = saved.results;
  state.curExerciseIdx = saved.curExerciseIdx;
  state.curSet = saved.curSet;
  state.sessionStartedAt = saved.sessionStartedAt || Date.now();
  // If the app was closed for a long time, don't count that gap as workout time.
  const seenSnap = Store.get('activeTimer', null);
  const lastSeen = Math.max(saved.lastSeenAt || 0, (seenSnap && seenSnap.sessionStartedAt === state.sessionStartedAt) ? (seenSnap.lastSeenAt || 0) : 0);
  state.offlineMs = saved.offlineMs || 0;
  if (lastSeen && Date.now() - lastSeen > AWAY_THRESHOLD_MS) state.offlineMs += Date.now() - lastSeen;
  state.warmupList = WARMUP_DB[EXERCISE_DB[state.sessionKey].warmup];
  state.paused = false;
  state.pausedAt = null;

  // Timer snapshot written by render(): which phase we were in and the absolute time it ends.
  const snap = Store.get('activeTimer', null);
  if (snap && snap.sessionStartedAt === state.sessionStartedAt) {
    state.warmupIdx = snap.warmupIdx || 0;
    state.timedOut = !!snap.timedOut;
    if (snap.screen === 'warmup') {
      state.screen = 'warmup';
      beginWarmupStep(snap.endsAt);
    } else if (snap.subState === 'rest') {
      state.screen = 'active';
      beginRest(snap.endsAt);
    } else if (snap.subState === 'timer') {
      state.screen = 'active';
      beginSetTimer(snap.endsAt);
    } else {
      // timeup | repsInput | restComplete: no running clock to restore
      state.screen = 'active';
      state.subState = snap.subState;
    }
  } else {
    // Older save without a snapshot: previous behavior (fresh set timer)
    state.warmupIdx = state.warmupList.length;
    state.screen = 'active';
    beginSetTimer();
  }
  requestWakeLockIfEnabled();
  render();
}

// ---------- Setup screen ----------
function moveExercise(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.exerciseList.length) return;
  const tmp = state.exerciseList[i];
  state.exerciseList[i] = state.exerciseList[j];
  state.exerciseList[j] = tmp;
  render();
}
function changeSets(i, delta) {
  const ex = state.exerciseList[i];
  ex.sets = clampInt(ex.sets + delta, 1, MAX_SETS);
  render();
}
// Quick actions (Setup screen): apply to this session's working copy only; EXERCISE_DB is untouched.
const QUICK_SETS_OPTIONS = [1, 2, 3, 4];
function setAllSets(n) {
  if (state.screen !== 'setup') return;
  state.exerciseList.forEach((ex) => { ex.sets = n; });
  render();
}
function resetExerciseSets() { // undo temporary set changes: back to each exercise's saved (or default) sets
  if (state.screen !== 'setup') return;
  state.exerciseList.forEach((ex) => { if (ex.persist) ex.sets = ex.persist.sets; });
  render();
}
// ---------- Custom modifications & user-added exercises ----------
// Built-in definitions (data.js) are NEVER modified. User data lives in two separate stores:
//   exerciseMods:    { 'SESSION|Original name': { name?, sets?, target? } }   differences from the built-in default only
//   customExercises: { SESSION: [ { id: 'u_...', name, type, target, sets, createdAt } ] }
// A session never holds more than MAX_EXERCISES exercises (built-in + added): enforced when adding AND when reading.
// Temporary changes live only in state.exerciseList; they become permanent only through an explicit save.
const MAX_EXERCISES = 10;
const MAX_SETS = 10;
function sanitizeExerciseName(v) { return String(v == null ? '' : v).replace(/[<>"&`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }
function isInt(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }
function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function cloneTarget(t) { return Array.isArray(t) ? t.slice() : t; }
function sameTarget(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
function exerciseId(key, name) { return key + '|' + name; }
function newExerciseId() { return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, 'x'); }
function parseBuiltinId(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf('|');
  if (i < 1) return null;
  const key = id.slice(0, i), def = EXERCISE_DB[key];
  const ex = def && def.exercises.find((e) => e.name === id.slice(i + 1));
  return ex ? { key, ex } : null;
}
function normalizeTarget(type, t) {
  if (type === 'MAX') return { ok: true, value: null };
  if (type === 'TIME') return isInt(t, 5, 600) ? { ok: true, value: t } : { ok: false };
  if (type === 'REPS') {
    if (isInt(t, 1, 100)) return { ok: true, value: t };
    if (Array.isArray(t) && t.length === 2 && isInt(t[0], 1, 100) && isInt(t[1], 1, 100) && t[0] < t[1]) return { ok: true, value: [t[0], t[1]] };
  }
  return { ok: false };
}
function validateExercise(d) {
  if (!d || typeof d !== 'object') return { ok: false, error: 'NAME' };
  const name = sanitizeExerciseName(d.name);
  if (!name) return { ok: false, error: 'NAME' };
  if (d.type !== 'REPS' && d.type !== 'TIME' && d.type !== 'MAX') return { ok: false, error: 'TYPE' };
  if (!isInt(d.sets, 1, MAX_SETS)) return { ok: false, error: 'SETS' };
  const t = normalizeTarget(d.type, d.target);
  if (!t.ok) return { ok: false, error: 'TARGET' };
  return { ok: true, value: { name, type: d.type, sets: d.sets, target: t.value } };
}
// Sanitizers shared by normal reads and by backup import. Unknown or removed exercises are ignored (never applied),
// but their saved data is not deleted by unrelated writes.
function cleanMods(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach((id) => {
    const info = parseBuiltinId(id), m = raw[id];
    if (!info || !m || typeof m !== 'object') return;
    const c = {};
    const nm = m.name !== undefined ? sanitizeExerciseName(m.name) : '';
    if (nm && nm !== info.ex.name) c.name = nm;
    if (isInt(m.sets, 1, MAX_SETS) && m.sets !== info.ex.sets) c.sets = m.sets;
    if (m.target !== undefined && info.ex.type !== 'MAX') {
      const t = normalizeTarget(info.ex.type, m.target);
      if (t.ok && !sameTarget(t.value, info.ex.target)) c.target = t.value;
    }
    if (Object.keys(c).length) out[id] = c;
  });
  return out;
}
function cleanCustomList(key, raw) {
  const def = EXERCISE_DB[key];
  if (!def || !Array.isArray(raw)) return [];
  const room = MAX_EXERCISES - def.exercises.length, seen = new Set(), out = [];
  raw.forEach((c) => {
    if (out.length >= room || !c || typeof c !== 'object' || typeof c.id !== 'string' || !/^u_[a-z0-9]+$/.test(c.id) || seen.has(c.id)) return;
    const v = validateExercise(c);
    if (!v.ok) return;
    seen.add(c.id);
    out.push(Object.assign({ id: c.id, createdAt: isNum(c.createdAt) ? c.createdAt : 0 }, v.value));
  });
  return out;
}
function cleanCustomsObject(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(EXERCISE_DB).forEach((k) => { const l = cleanCustomList(k, raw[k]); if (l.length) out[k] = l; });
  return out;
}
function swapsToMods(sw) {
  const out = {};
  if (!sw || typeof sw !== 'object') return out;
  Object.keys(sw).forEach((key) => {
    const per = sw[key];
    if (!EXERCISE_DB[key] || !per || typeof per !== 'object') return;
    Object.keys(per).forEach((base) => {
      const nm = sanitizeExerciseName(per[base] && per[base].name);
      if (nm && EXERCISE_DB[key].exercises.some((e) => e.name === base)) out[exerciseId(key, base)] = { name: nm };
    });
  });
  return out;
}
function getMods() { return cleanMods(Store.get('exerciseMods', {})); }
function getCustoms(key) { const all = Store.get('customExercises', {}); return cleanCustomList(key, all && typeof all === 'object' ? all[key] : null); }
function exerciseCount(key) { return EXERCISE_DB[key].exercises.length + getCustoms(key).length; }
function rawObj(k) { const r = Store.get(k, {}); return (r && typeof r === 'object' && !Array.isArray(r)) ? Object.assign({}, r) : {}; }
function writeCustoms(key, list) { const all = rawObj('customExercises'); all[key] = list; Store.set('customExercises', all); }
function nameTaken(key, name, exceptId) {
  const n = name.toLowerCase(), mods = getMods();
  const used = EXERCISE_DB[key].exercises.map((e) => { const id = exerciseId(key, e.name), m = mods[id]; return { id, n: ((m && m.name) || e.name).toLowerCase() }; })
    .concat(getCustoms(key).map((c) => ({ id: c.id, n: c.name.toLowerCase() })));
  return used.some((u) => u.id !== exceptId && u.n === n);
}
function computeModDiff(info, v) { // what differs from the built-in default (nothing stored for identical values)
  const d = {};
  if (v.name !== info.ex.name) d.name = v.name;
  if (v.sets !== info.ex.sets) d.sets = v.sets;
  if (info.ex.type !== 'MAX' && !sameTarget(v.target, info.ex.target)) d.target = cloneTarget(v.target);
  return d;
}
function saveBuiltinMod(id, v) {
  const info = parseBuiltinId(id);
  if (!info) return false;
  const all = rawObj('exerciseMods'), d = computeModDiff(info, v);
  if (Object.keys(d).length) all[id] = d; else delete all[id];
  Store.set('exerciseMods', all);
  return true;
}
function resetBuiltinMod(id) { const all = rawObj('exerciseMods'); delete all[id]; Store.set('exerciseMods', all); }
function addCustomExercise(key, d) {
  if (!EXERCISE_DB[key]) return { ok: false, error: 'SESSION' };
  const list = getCustoms(key);
  if (EXERCISE_DB[key].exercises.length + list.length >= MAX_EXERCISES) return { ok: false, error: 'LIMIT' }; // hard limit, independent of the UI
  const v = validateExercise(d);
  if (!v.ok) return v;
  const id = (d && typeof d.id === 'string' && /^u_[a-z0-9]+$/.test(d.id)) ? d.id : newExerciseId();
  if (list.some((c) => c.id === id)) return { ok: false, error: 'DUPLICATE' }; // the same submission arriving twice
  if (nameTaken(key, v.value.name, null)) return { ok: false, error: 'NAME_EXISTS' };
  const rec = Object.assign({ id, createdAt: Date.now() }, v.value);
  writeCustoms(key, list.concat(rec));
  return { ok: true, rec };
}
function updateCustomExercise(key, id, v) {
  const list = getCustoms(key), i = list.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const chk = validateExercise(Object.assign({}, v, { type: list[i].type }));
  if (!chk.ok) return false;
  list[i] = Object.assign({}, list[i], chk.value);
  writeCustoms(key, list);
  return true;
}
function removeCustomExercise(key, id) {
  const list = getCustoms(key), next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  writeCustoms(key, next);
  return true;
}
function snapshotPersist(ex) { return { name: ex.name, sets: ex.sets, target: cloneTarget(ex.target) }; }
function makeCustomExercise(c) {
  const ex = { id: c.id, name: c.name, type: c.type, target: cloneTarget(c.target), sets: c.sets, custom: true, baseName: c.name };
  ex.persist = snapshotPersist(ex);
  return ex;
}
// Builds a session's working list: built-in defaults + saved modifications + user-added exercises (never more than 10).
function buildSessionList(key) {
  const def = EXERCISE_DB[key], mods = getMods();
  const list = def.exercises.map((e) => {
    const id = exerciseId(key, e.name), m = mods[id] || {};
    const ex = Object.assign({}, e, { id, baseName: e.name, target: cloneTarget(e.target) });
    if (m.name) ex.name = m.name;
    if (m.sets) ex.sets = m.sets;
    if (m.target !== undefined) ex.target = cloneTarget(m.target);
    ex.persist = snapshotPersist(ex);
    return ex;
  });
  getCustoms(key).forEach((c) => list.push(makeCustomExercise(c)));
  return list.slice(0, MAX_EXERCISES);
}
function exFlags(ex) {
  let saved = false;
  if (!ex.custom) {
    const info = parseBuiltinId(exerciseId(state.sessionKey, ex.baseName));
    saved = !!info && (ex.persist.name !== info.ex.name || ex.persist.sets !== info.ex.sets || !sameTarget(ex.persist.target, info.ex.target));
  }
  const temp = ex.name !== ex.persist.name || ex.sets !== ex.persist.sets || !sameTarget(ex.target, ex.persist.target);
  return { added: !!ex.custom, saved, temp };
}
function exFlagsHtml(ex) {
  const f = exFlags(ex);
  let h = '';
  if (f.added) h += '<span class="flag flag-added">ADDED</span>';
  if (f.saved) h += '<span class="flag flag-saved">CUSTOM</span>';
  if (f.temp) h += '<span class="flag flag-temp">THIS WORKOUT ONLY</span>';
  return h;
}
function listNameTaken(name, exceptIdx) {
  const n = name.toLowerCase();
  return state.exerciseList.some((x, i) => i !== exceptIdx && x.name.toLowerCase() === n);
}
function persistExerciseChange(key, ex, v) {
  if (nameTaken(key, v.name, ex.id)) return 'NAME_EXISTS';
  const ok = ex.custom ? updateCustomExercise(key, ex.id, v) : saveBuiltinMod(ex.id, v);
  if (!ok) return 'SESSION';
  ex.name = v.name; ex.sets = v.sets; ex.target = cloneTarget(v.target);
  ex.persist = snapshotPersist(ex);
  return null;
}

// ---- Edit / Add sheet ----
function draftFromExercise(ex) {
  const d = { name: ex.name, type: ex.type, sets: ex.sets, tMin: 12, tMax: 12, tSec: 60 };
  if (ex.type === 'REPS') {
    if (Array.isArray(ex.target)) { d.tMin = ex.target[0]; d.tMax = ex.target[1]; }
    else if (isNum(ex.target)) { d.tMin = ex.target; d.tMax = ex.target; }
  }
  if (ex.type === 'TIME' && isNum(ex.target)) d.tSec = ex.target;
  return d;
}
function exerciseFromDraft(d) {
  const target = d.type === 'MAX' ? null : (d.type === 'TIME' ? d.tSec : (d.tMin === d.tMax ? d.tMin : [d.tMin, d.tMax]));
  return { name: d.name, type: d.type, sets: d.sets, target };
}
function editErrorText(code) {
  return ({ NAME: 'ENTER A NAME', TYPE: 'CHOOSE A TYPE', SETS: 'SETS MUST BE 1\u201310', TARGET: 'CHECK THE TARGET', LIMIT: 'LIMIT: ' + MAX_EXERCISES + ' EXERCISES PER WORKOUT',
    DUPLICATE: 'ALREADY ADDED', NAME_EXISTS: 'NAME ALREADY USED', SESSION: 'COULD NOT SAVE' })[code] || 'COULD NOT SAVE';
}
function openEdit(i) {
  if (state.screen !== 'setup') return;
  const ex = state.exerciseList[i];
  if (!ex) return;
  state.editEx = { ctx: 'setup', sessionKey: state.sessionKey, index: i, exId: ex.id, isNew: false, custom: !!ex.custom, draft: draftFromExercise(ex) };
  render();
}
function openAdd() {
  if (state.screen !== 'setup') return;
  if (state.exerciseList.length >= MAX_EXERCISES || exerciseCount(state.sessionKey) >= MAX_EXERCISES) { showToast(editErrorText('LIMIT')); return; }
  state.editEx = { ctx: 'setup', sessionKey: state.sessionKey, index: null, exId: newExerciseId(), isNew: true, custom: true,
    draft: { name: '', type: 'REPS', sets: 3, tMin: 12, tMax: 12, tSec: 60 } };
  render();
}
function openEditManager(key, kind, ref) {
  const def = EXERCISE_DB[key];
  if (!def) return;
  let ex = null;
  if (kind === 'b') {
    const e = def.exercises[ref];
    if (!e) return;
    const id = exerciseId(key, e.name), m = getMods()[id] || {};
    ex = Object.assign({}, e, { id });
    if (m.name) ex.name = m.name;
    if (m.sets) ex.sets = m.sets;
    if (m.target !== undefined) ex.target = m.target;
  } else {
    const c = getCustoms(key).find((x) => x.id === ref);
    if (!c) return;
    ex = Object.assign({}, c, { custom: true });
  }
  state.editEx = { ctx: 'manager', sessionKey: key, index: null, exId: ex.id, isNew: false, custom: !!ex.custom, draft: draftFromExercise(ex) };
  render();
}
function closeEdit() { state.editEx = null; render(); }
function syncEditDraft() { const el = document.getElementById('edit-name'); if (el && state.editEx && typeof el.value === 'string') state.editEx.draft.name = el.value; }
function refreshEdit() { syncEditDraft(); document.getElementById('modal-root').innerHTML = ''; render(); }
function editStep(field, delta) {
  const e = state.editEx;
  if (!e) return;
  syncEditDraft();
  const d = e.draft;
  if (field === 'sets') d.sets = clampInt(d.sets + delta, 1, MAX_SETS);
  else if (field === 'tSec') d.tSec = clampInt(d.tSec + delta * 5, 5, 600);
  else if (field === 'tMin') { d.tMin = clampInt(d.tMin + delta, 1, 100); if (d.tMax < d.tMin) d.tMax = d.tMin; }
  else if (field === 'tMax') { d.tMax = clampInt(d.tMax + delta, 1, 100); if (d.tMin > d.tMax) d.tMin = d.tMax; }
  refreshEdit();
}
function editSetType(t) {
  const e = state.editEx;
  if (!e || !e.isNew || !['REPS', 'TIME', 'MAX'].includes(t)) return;
  syncEditDraft();
  e.draft.type = t;
  refreshEdit();
}
function readEditDraft() {
  syncEditDraft();
  const v = validateExercise(exerciseFromDraft(state.editEx.draft));
  if (!v.ok) { showToast(editErrorText(v.error)); return null; }
  return v.value;
}
function applyEditTemp() { // temporary: changes only the working copy, never the saved settings
  const e = state.editEx;
  if (!e || e.ctx !== 'setup' || e.isNew) return;
  const v = readEditDraft();
  if (!v) return;
  const ex = state.exerciseList[e.index];
  if (!ex || ex.id !== e.exId) return;
  if (listNameTaken(v.name, e.index)) { showToast(editErrorText('NAME_EXISTS')); return; }
  ex.name = v.name; ex.sets = v.sets; ex.target = cloneTarget(v.target);
  state.editEx = null;
  render();
  showToast('APPLIED TO THIS WORKOUT');
}
function saveEditCustom() {
  const e = state.editEx;
  if (!e) return; // already handled (guards against a double tap)
  const v = readEditDraft();
  if (!v) return;
  if (e.isNew) {
    if (state.screen === 'setup' && state.exerciseList.length >= MAX_EXERCISES) { showToast(editErrorText('LIMIT')); return; }
    const r = addCustomExercise(e.sessionKey, Object.assign({ id: e.exId }, v));
    if (!r.ok) {
      showToast(editErrorText(r.error));
      if (r.error === 'LIMIT' || r.error === 'DUPLICATE') { state.editEx = null; render(); }
      return;
    }
    state.editEx = null; // cleared first: a second tap on ADD finds nothing to submit
    if (state.screen === 'setup' && state.sessionKey === e.sessionKey && !state.exerciseList.some((x) => x.id === r.rec.id)) state.exerciseList.push(makeCustomExercise(r.rec));
    render();
    showToast('EXERCISE ADDED');
    return;
  }
  let err;
  if (e.ctx === 'setup') {
    const ex = state.exerciseList[e.index];
    if (!ex || ex.id !== e.exId) return;
    err = persistExerciseChange(e.sessionKey, ex, v);
  } else if (e.custom) {
    err = nameTaken(e.sessionKey, v.name, e.exId) ? 'NAME_EXISTS' : (updateCustomExercise(e.sessionKey, e.exId, v) ? null : 'SESSION');
  } else {
    err = nameTaken(e.sessionKey, v.name, e.exId) ? 'NAME_EXISTS' : (saveBuiltinMod(e.exId, v) ? null : 'SESSION');
  }
  if (err) { showToast(editErrorText(err)); return; }
  state.editEx = null;
  render();
  showToast('SAVED AS CUSTOM');
}
function askResetExercise() { const e = state.editEx; if (!e) return; syncEditDraft(); state.confirmAction = { kind: 'resetExercise', sessionKey: e.sessionKey, exId: e.exId }; render(); }
function askRemoveExercise() { const e = state.editEx; if (!e) return; syncEditDraft(); state.confirmAction = { kind: 'removeExercise', sessionKey: e.sessionKey, exId: e.exId }; render(); }
function askResetMod(key, idx) { const e = EXERCISE_DB[key] && EXERCISE_DB[key].exercises[idx]; if (!e) return; state.confirmAction = { kind: 'resetExercise', sessionKey: key, exId: exerciseId(key, e.name) }; render(); }
function askRemoveCustom(key, id) { state.confirmAction = { kind: 'removeExercise', sessionKey: key, exId: id }; render(); }
function askResetAllMods() { state.confirmAction = { kind: 'resetAllMods' }; render(); }
function confirmResetExercise() {
  const a = state.confirmAction;
  state.confirmAction = null;
  if (a && a.exId) {
    resetBuiltinMod(a.exId);
    const info = parseBuiltinId(a.exId);
    if (state.screen === 'setup' && state.sessionKey === a.sessionKey && info) {
      const ex = state.exerciseList.find((x) => x.id === a.exId);
      if (ex) { ex.name = info.ex.name; ex.sets = info.ex.sets; ex.target = cloneTarget(info.ex.target); ex.persist = snapshotPersist(ex); }
    }
  }
  state.editEx = null;
  render();
  showToast('RESET TO DEFAULT');
}
function confirmRemoveExercise() {
  const a = state.confirmAction;
  state.confirmAction = null;
  if (a && a.exId && removeCustomExercise(a.sessionKey, a.exId) && state.screen === 'setup' && state.sessionKey === a.sessionKey) {
    state.exerciseList = state.exerciseList.filter((x) => x.id !== a.exId);
  }
  state.editEx = null;
  render();
  showToast('EXERCISE REMOVED');
}
function confirmResetAllMods() { state.confirmAction = null; Store.set('exerciseMods', {}); render(); showToast('MODIFICATIONS RESET'); }
function hubSessions() { return SESSION_ORDER.filter((k) => k !== 'REST' && EXERCISE_DB[k]); }
function sessionShort(key) { return EXERCISE_DB[key].label.replace(/\s*\+\s*CORE$/i, ''); }
function sessionStats(key) {
  const def = EXERCISE_DB[key], mods = getMods();
  return { modified: def.exercises.filter((e) => mods[exerciseId(key, e.name)]).length, added: getCustoms(key).length, total: exerciseCount(key) };
}
function goCustomMods() {
  if (!state.hub || !EXERCISE_DB[state.hub.session]) {
    const keys = hubSessions();
    const first = keys.find((k) => { const t = sessionStats(k); return t.modified + t.added > 0; }) || keys[0];
    state.hub = { session: first, filter: 'all' };
  }
  state.screen = 'customMods';
  render();
}
function hubSelect(key) { if (!EXERCISE_DB[key] || !state.hub) return; state.hub.session = key; state.hub.filter = 'all'; render(); }
function hubFilter(f) { if (!state.hub || !['all', 'modified', 'added'].includes(f)) return; state.hub.filter = f; render(); }
function hubAdd() {
  if (!state.hub) return;
  const key = state.hub.session;
  if (exerciseCount(key) >= MAX_EXERCISES) { showToast(editErrorText('LIMIT')); return; }
  state.editEx = { ctx: 'manager', sessionKey: key, index: null, exId: newExerciseId(), isNew: true, custom: true,
    draft: { name: '', type: 'REPS', sets: 3, tMin: 12, tMax: 12, tSec: 60 } };
  render();
}
function hubOpenWorkout() { if (state.hub) selectSession(state.hub.session); }
function askResetSession() { if (!state.hub || !sessionStats(state.hub.session).modified) return; state.confirmAction = { kind: 'resetSession', sessionKey: state.hub.session }; render(); }
function confirmResetSession() { // removes this session's saved modifications only; added exercises are kept
  const a = state.confirmAction;
  state.confirmAction = null;
  if (a && EXERCISE_DB[a.sessionKey]) {
    const all = rawObj('exerciseMods');
    Object.keys(all).forEach((id) => { if (id.indexOf(a.sessionKey + '|') === 0) delete all[id]; });
    Store.set('exerciseMods', all);
  }
  render();
  showToast('SESSION RESET');
}

function renderEditSheet() {
  const e = state.editEx, d = e.draft, def = EXERCISE_DB[e.sessionKey];
  const info = (!e.isNew && !e.custom) ? parseBuiltinId(e.exId) : null;
  const used = e.ctx === 'setup' ? state.exerciseList.length : exerciseCount(e.sessionKey);
  const stepper = (field, label, text, hint) => `<div class="field-row"><span class="field-label">${label}${hint ? `<small>${hint}</small>` : ''}</span><span class="stepper-inline">
    <button class="stepper-btn" onclick="editStep('${field}',-1)" aria-label="Decrease ${label}">\u2212</button><span class="stepper-value">${text}</span>
    <button class="stepper-btn" onclick="editStep('${field}',1)" aria-label="Increase ${label}">+</button></span></div>`;
  const scope = e.isNew ? `Added to ${def.label} only \u00b7 ${used}/${MAX_EXERCISES} exercises used.`
    : (e.custom ? `This added exercise exists in ${def.label} only.` : `Saved changes apply to this exercise in ${def.label} only. Other sessions are not affected.`);
  // original vs saved values
  let compare = '';
  if (!e.isNew) {
    const col = (label, v, muted, extra) => `<div class="vc-col${muted ? ' is-muted' : ''}"><span>${label}</span><b>${v.sets} SETS</b><i>${targetLabel(v)}</i>${extra || ''}</div>`;
    if (info) {
      const m = getMods()[e.exId], saved = { type: info.ex.type, sets: (m && m.sets) || info.ex.sets, target: m && m.target !== undefined ? m.target : info.ex.target };
      const renamed = m && m.name ? `<i>as ${esc(m.name)}</i>` : '';
      compare = `<div class="value-compare">${col('ORIGINAL', info.ex, false)}${m ? col('SAVED', saved, false, renamed) : '<div class="vc-col is-muted"><span>SAVED</span><b>NONE</b><i>using original</i></div>'}</div>`;
    } else {
      const c = getCustoms(e.sessionKey).find((x) => x.id === e.exId);
      if (c) compare = `<div class="value-compare">${col('SAVED', c, false)}</div>`;
    }
  }
  const dTarget = info && info.ex.type === 'REPS' ? (Array.isArray(info.ex.target) ? info.ex.target : [info.ex.target, info.ex.target]) : null;
  let h = `<div class="overlay" onclick="if(event.target===this) closeEdit()"><div class="overlay-card sheet">
    <div class="overlay-icon">${icon(e.isNew ? 'plus' : 'edit', 22)}</div>
    <div class="overlay-title">${e.isNew ? 'ADD EXERCISE' : 'EDIT EXERCISE'}</div>
    <p class="confirm-body swap-body">${scope}</p>${compare}
    <div class="field-label name-label">NAME</div><input id="edit-name" class="text-input" type="text" maxlength="40" autocomplete="off" autocapitalize="words" placeholder="Exercise name" value="${esc(d.name)}">`;
  if (e.isNew) h += `<div class="segmented wide">${['REPS', 'TIME', 'MAX'].map((t) => `<button class="seg ${d.type === t ? 'active' : ''}" onclick="editSetType('${t}')">${t}</button>`).join('')}</div>`;
  h += stepper('sets', 'SETS', d.sets, info ? 'DEFAULT ' + info.ex.sets : '');
  if (d.type === 'REPS') h += stepper('tMin', 'MIN REPS', d.tMin, dTarget ? 'DEFAULT ' + dTarget[0] : '') + stepper('tMax', 'MAX REPS', d.tMax, dTarget ? 'DEFAULT ' + dTarget[1] : '');
  else if (d.type === 'TIME') h += stepper('tSec', 'DURATION', fmtTime(d.tSec), info && isNum(info.ex.target) ? 'DEFAULT ' + fmtTime(info.ex.target) : '');
  else h += '<div class="p-note">Max-effort exercise: no target to set.</div>';
  if (e.isNew) {
    h += `<button class="sheet-action primary" onclick="saveEditCustom()"><b>ADD TO ${def.label}</b><span>Saved with this workout and counted toward the ${MAX_EXERCISES}-exercise limit.</span></button>`;
  } else {
    if (e.ctx === 'setup') h += `<button class="sheet-action" onclick="applyEditTemp()"><b>APPLY TO THIS WORKOUT</b><span>One-time change. Your saved settings stay as they are.</span></button>`;
    h += `<button class="sheet-action primary" onclick="saveEditCustom()"><b>${e.custom ? 'SAVE CHANGES' : 'SAVE AS CUSTOM'}</b><span>Used in every future ${def.label} workout.</span></button>`;
  }
  h += '<div class="sheet-links">';
  if (!e.isNew && e.custom) h += '<button class="text-btn" onclick="askRemoveExercise()">REMOVE EXERCISE</button>';
  if (!e.isNew && !e.custom && getMods()[e.exId]) h += '<button class="text-btn" onclick="askResetExercise()">RESET TO DEFAULT</button>';
  h += '<button class="text-btn" onclick="closeEdit()">CANCEL</button></div></div></div>';
  return h;
}

// ---- Custom Modifications screen (Settings) ----
function renderCustomMods() {
  if (!state.hub || !EXERCISE_DB[state.hub.session]) { const k = hubSessions(); state.hub = { session: k[0], filter: 'all' }; }
  const keys = hubSessions(), key = state.hub.session, def = EXERCISE_DB[key];
  const st = sessionStats(key), mods = getMods(), raw = rawObj('exerciseMods');
  const hasAny = st.modified + st.added > 0;
  const f = hasAny ? state.hub.filter : 'all';
  const totalMods = keys.reduce((n, k) => n + sessionStats(k).modified, 0);
  const diff = (k, a, b) => `<div class="diff-row"><span class="diff-k">${k}</span><s>${a}</s><i>\u2192</i><b>${b}</b></div>`;
  let h = `<div class="screen mods-screen"><button class="back-btn" onclick="goSettings()" aria-label="Back">${icon('chevronLeft', 18)}</button><h2>CUSTOMIZATION</h2>
    <div class="p-note mods-intro">Saved changes are used in every future workout. Original workouts and History never change.</div>`;
  h += '<div class="hub-tabs" role="tablist">' + keys.map((k) => {
    const s = sessionStats(k), any = s.modified + s.added > 0;
    const sub = any ? [s.modified ? s.modified + ' MOD' : '', s.added ? s.added + ' ADDED' : ''].filter(Boolean).join(' \u00b7 ') : 'DEFAULT';
    return `<button class="hub-tab${k === key ? ' is-active' : ''}${any ? ' has-custom' : ''}" role="tab" aria-selected="${k === key}" onclick="hubSelect('${k}')"><b>${sessionShort(k)}</b><span>${sub}</span></button>`;
  }).join('') + '</div>';
  h += `<div class="hub-head"><div><div class="hub-title">${def.label}</div><div class="hub-sub">${st.total}/${MAX_EXERCISES} exercises \u00b7 ${st.modified} modified \u00b7 ${st.added} added</div></div>
    <button class="swap-btn" ${st.total >= MAX_EXERCISES ? 'disabled' : ''} onclick="hubAdd()" aria-label="Add exercise">${icon('plus', 12)}<span>ADD</span></button></div>`;
  if (hasAny) h += `<div class="segmented wide">${[['all', 'ALL', st.total], ['modified', 'MODIFIED', st.modified], ['added', 'ADDED', st.added]].map((x) => `<button class="seg ${f === x[0] ? 'active' : ''}" onclick="hubFilter('${x[0]}')">${x[1]} ${x[2]}</button>`).join('')}</div>`;
  const items = [];
  def.exercises.forEach((e, idx) => { const m = mods[exerciseId(key, e.name)]; items.push({ kind: 'b', idx, e, m }); });
  getCustoms(key).forEach((c) => items.push({ kind: 'u', c }));
  const shown = items.filter((it) => f === 'all' || (f === 'modified' && it.kind === 'b' && it.m) || (f === 'added' && it.kind === 'u'));
  if (!hasAny && f === 'all') {
    h += `<div class="hub-empty">${icon('edit', 26)}<div class="empty-title">NO CUSTOMIZATIONS FOR ${def.label}</div>
      <div class="empty-sub">Tap an exercise below to change its sets, reps or duration, or add your own.</div>
      <div class="empty-actions"><button class="pill-btn primary" onclick="hubOpenWorkout()">OPEN SETUP</button><button class="pill-btn" ${st.total >= MAX_EXERCISES ? 'disabled' : ''} onclick="hubAdd()">ADD EXERCISE</button></div></div>`;
  } else if (!shown.length) {
    const isMod = f === 'modified';
    h += `<div class="hub-empty">${icon(isMod ? 'edit' : 'plus', 26)}<div class="empty-title">${isMod ? 'NO MODIFIED EXERCISES' : 'NO ADDED EXERCISES'}</div>
      <div class="empty-sub">${isMod ? 'Exercises you change and save appear here.' : 'Add your own exercise to this workout (' + st.total + ' of ' + MAX_EXERCISES + ' used).'}</div>
      <div class="empty-actions">${isMod ? '' : `<button class="pill-btn primary" ${st.total >= MAX_EXERCISES ? 'disabled' : ''} onclick="hubAdd()">ADD EXERCISE</button>`}<button class="pill-btn" onclick="hubFilter('all')">SHOW ALL</button></div></div>`;
  }
  shown.forEach((it) => {
    if (it.kind === 'u') {
      const c = it.c;
      h += `<div class="mod-card is-added"><div class="mod-top"><div><div class="mod-name">${esc(c.name)}</div><div class="mod-sub">${c.type} \u00b7 ${c.sets} SETS \u00b7 ${targetLabel(c)}</div></div><span class="flag flag-added">ADDED</span></div>
        <div class="mod-actions"><button class="swap-btn" onclick="openEditManager('${key}','u','${c.id}')">${icon('edit', 12)}<span>EDIT</span></button><button class="swap-btn" onclick="askRemoveCustom('${key}','${c.id}')">${icon('trash', 12)}<span>REMOVE</span></button></div></div>`;
    } else if (it.m) {
      const e = it.e, m = it.m, eff = { type: e.type, target: m.target !== undefined ? m.target : e.target }, rows = [];
      if (m.name) rows.push(diff('NAME', esc(e.name), esc(m.name)));
      if (m.sets) rows.push(diff('SETS', e.sets, m.sets));
      if (m.target !== undefined) rows.push(diff('TARGET', targetLabel(e), targetLabel(eff)));
      h += `<div class="mod-card is-custom"><div class="mod-top"><div><div class="mod-name">${esc(m.name || e.name)}</div><div class="mod-sub">${m.sets || e.sets} SETS \u00b7 ${targetLabel(eff)}</div></div><span class="flag flag-saved">CUSTOM</span></div>
        <div class="mod-diff">${rows.join('')}</div>
        <div class="mod-actions"><button class="swap-btn" onclick="openEditManager('${key}','b',${it.idx})">${icon('edit', 12)}<span>EDIT</span></button><button class="swap-btn" onclick="askResetMod('${key}',${it.idx})">${icon('reset', 12)}<span>RESET TO DEFAULT</span></button></div></div>`;
    } else {
      const e = it.e;
      h += `<div class="mod-card is-default"><div class="mod-main"><div class="mod-name">${esc(e.name)}</div><div class="mod-sub">${e.sets} SETS \u00b7 ${targetLabel(e)}</div></div>
        <button class="icon-btn" onclick="openEditManager('${key}','b',${it.idx})" aria-label="Edit ${esc(e.name)}">${icon('edit', 14)}</button></div>`;
    }
  });
  const orphans = Object.keys(raw).filter((id) => !parseBuiltinId(id)).length;
  h += `<div class="settings-group-title">RESET</div>
    <button class="settings-row link" ${st.modified ? '' : 'disabled'} onclick="askResetSession()"><span class="settings-row-label">${icon('reset', 16)}<span class="row-text">RESET ${sessionShort(key)} TO DEFAULT<small>Original settings return. Added exercises are kept.</small></span></span></button>
    <button class="settings-row link danger" ${totalMods ? '' : 'disabled'} onclick="askResetAllMods()"><span class="settings-row-label">${icon('trash', 16)}<span class="row-text">RESET ALL MODIFICATIONS<small>Every session. Added exercises are kept.${orphans ? ' ' + orphans + ' saved change(s) belong to exercises that no longer exist and are ignored.' : ''}</small></span></span></button></div>`;
  return h;
}

// ---------- Quick Setup (Setup screen) ----------
// Presets only change the WORKOUT'S working list (temporary). They never write to storage; saving is the explicit
// "Save as my default" action, which reuses the existing exerciseMods / customExercises stores.
const QUICK_PRESETS = [['default', 'DEFAULT'], ['light', 'LIGHT'], ['standard', 'STANDARD'], ['custom', 'CUSTOM']];
function savedModCount() {
  const key = state.sessionKey, mods = getMods();
  return EXERCISE_DB[key].exercises.filter((e) => mods[exerciseId(key, e.name)]).length;
}
function presetAvailable(id) { return id !== 'custom' || savedModCount() > 0; }
function presetValues(id, ex) { // what an exercise looks like under a preset
  if (id === 'light' || id === 'standard') return { name: ex.persist.name, sets: id === 'light' ? 2 : 3, target: ex.persist.target };
  if (id === 'default' && !ex.custom) { // original built-in values; added exercises keep their saved settings
    const info = parseBuiltinId(exerciseId(state.sessionKey, ex.baseName));
    if (info) return { name: info.ex.name, sets: info.ex.sets, target: info.ex.target };
  }
  return { name: ex.persist.name, sets: ex.persist.sets, target: ex.persist.target }; // custom = the saved settings
}
function presetMatches(id) {
  return state.exerciseList.length > 0 && state.exerciseList.every((ex) => {
    const v = presetValues(id, ex);
    return ex.name === v.name && ex.sets === v.sets && sameTarget(ex.target, v.target);
  });
}
function currentPreset() { // the explicit choice while it still describes the list; otherwise any preset that does; otherwise null (manual)
  const order = [state.setupPreset, 'custom', 'default', 'light', 'standard'];
  for (const id of order) if (id && presetAvailable(id) && presetMatches(id)) return id;
  return null;
}
function hasTempChanges() {
  return state.exerciseList.some((ex) => ex.name !== ex.persist.name || ex.sets !== ex.persist.sets || !sameTarget(ex.target, ex.persist.target));
}
function applyPreset(id) {
  if (state.screen !== 'setup' || !QUICK_PRESETS.some((p) => p[0] === id) || !presetAvailable(id)) return;
  state.exerciseList.forEach((ex) => { const v = presetValues(id, ex); ex.name = v.name; ex.sets = v.sets; ex.target = cloneTarget(v.target); });
  state.setupPreset = id;
  render();
}
function undoTemporary() { // back to the saved setup (or the defaults when nothing is saved)
  if (state.screen !== 'setup') return;
  state.exerciseList.forEach((ex) => { ex.name = ex.persist.name; ex.sets = ex.persist.sets; ex.target = cloneTarget(ex.persist.target); });
  state.setupPreset = savedModCount() > 0 ? 'custom' : 'default';
  render();
  showToast('TEMPORARY CHANGES UNDONE');
}
function saveSessionDefault() { // explicit and all-or-nothing: validate everything first, then write once
  if (state.screen !== 'setup') return;
  const key = state.sessionKey, list = state.exerciseList;
  if (!hasTempChanges()) { showToast('NOTHING NEW TO SAVE'); return; }
  const vals = [], seen = new Set();
  for (const ex of list) {
    const v = validateExercise(ex);
    if (!v.ok) { showToast(editErrorText(v.error)); return; }
    const n = v.value.name.toLowerCase();
    if (seen.has(n)) { showToast(editErrorText('NAME_EXISTS')); return; }
    seen.add(n); vals.push(v.value);
  }
  const mods = rawObj('exerciseMods'), customs = getCustoms(key).slice();
  list.forEach((ex, i) => {
    if (ex.custom) {
      const ci = customs.findIndex((c) => c.id === ex.id);
      if (ci >= 0) customs[ci] = Object.assign({}, customs[ci], vals[i]);
    } else {
      const info = parseBuiltinId(ex.id);
      if (!info) return;
      const d = computeModDiff(info, vals[i]);
      if (Object.keys(d).length) mods[ex.id] = d; else delete mods[ex.id];
    }
  });
  Store.set('exerciseMods', mods);
  writeCustoms(key, customs);
  list.forEach((ex, i) => { ex.name = vals[i].name; ex.sets = vals[i].sets; ex.target = cloneTarget(vals[i].target); ex.persist = snapshotPersist(ex); });
  state.setupPreset = savedModCount() > 0 ? 'custom' : 'default';
  render();
  showToast('SAVED AS MY DEFAULT \u00b7 ' + sessionShort(key));
}
function renderQuickSetup() {
  const key = state.sessionKey, label = EXERCISE_DB[key].label;
  const cur = currentPreset(), temp = hasTempChanges();
  const caps = {
    default: presetAvailable('custom') ? 'Original built-in settings.' + (state.exerciseList.some((e) => e.custom) ? ' Added exercises keep their saved settings.' : '') : 'Original built-in settings. Edit an exercise, then save it as your default.',
    light: 'All exercises set to 2 sets.',
    standard: 'All exercises set to 3 sets.',
    custom: 'Your saved settings for ' + label + '.',
  };
  let cap = cur === null ? 'Edited by hand. Your saved settings are unchanged.' : caps[cur];
  if (cur !== null && temp) cap += ' This workout only.';
  const chip = cur === null ? ['MANUALLY ADJUSTED', ' is-manual'] : (temp ? ['TEMPORARY', ' is-temp'] : (cur === 'custom' ? ['SAVED', ''] : null));
  return `<div class="qs-card">
    <div class="qs-head"><span class="qs-title">QUICK SETUP</span>${chip ? `<span class="qs-status${chip[1]}">${chip[0]}</span>` : ''}</div>
    <div class="segmented wide" role="group" aria-label="Quick setup">${QUICK_PRESETS.map((p) => `<button class="seg ${cur === p[0] ? 'active' : ''}" ${presetAvailable(p[0]) ? '' : 'disabled'} onclick="applyPreset('${p[0]}')">${p[1]}</button>`).join('')}</div>
    <div class="qs-cap">${cap}</div>
    ${temp ? `<div class="qs-actions"><button class="qs-btn" onclick="undoTemporary()">${icon('reset', 13)}<span>UNDO</span></button><button class="qs-btn primary" onclick="saveSessionDefault()">${icon('check', 13)}<span>SAVE AS MY DEFAULT</span></button></div>` : ''}
  </div>`;
}

function startWorkoutFlow() {
  state.results = [];
  state.curExerciseIdx = 0;
  state.curSet = 1;
  state.warmupIdx = 0;
  state.warmupList = WARMUP_DB[EXERCISE_DB[state.sessionKey].warmup];
  state.sessionStartedAt = Date.now();
  state.offlineMs = 0;
  resetMotivationHistory(); // fresh variety of rest-screen cards each workout
  requestWakeLockIfEnabled();
  persistActiveSession(); // save now, not just after set 1 — so quitting mid-warmup is still resumable
  beginReadyCountdown(); // startCountdown renders immediately, so no extra render() here
}

// ---------- Get-ready countdown (3-2-1 before warm-up starts) ----------
function beginReadyCountdown() {
  const readySecs = clampSetting('readySeconds', getSettings().readySeconds);
  if (readySecs === 0) { // countdown disabled: go straight to the first warm-up step
    beginWarmupStep();
    render();
    return;
  }
  state.screen = 'ready';
  startCountdown(readySecs, () => { playTapSound(); render(); }, () => {
    playBeep();
    beginWarmupStep();
    render();
  });
}

// ---------- Warm-up ----------
function beginWarmupStep(resumeEndsAt) {
  state.screen = 'warmup';
  state.paused = false;
  const item = state.warmupList[state.warmupIdx];
  startCountdown(resolveWarmupDuration(item), render, warmupStepComplete, resumeEndsAt);
}
function warmupStepComplete() {
  playBeep();
  nextWarmupStep();
}
function skipWarmupStep() {
  clearInterval(state.timer.intervalId);
  nextWarmupStep();
}
function nextWarmupStep() {
  state.warmupIdx++;
  if (state.warmupIdx >= state.warmupList.length) {
    beginActiveWorkout();
  } else {
    beginWarmupStep();
    render();
  }
}

// ---------- Active workout ----------
function beginActiveWorkout() {
  state.screen = 'active';
  state.subState = 'timer';
  beginSetTimer();
  render();
}
function beginSetTimer(resumeEndsAt) {
  const ex = currentExercise();
  const seconds = ex.type === 'TIME' ? ex.target : clampSetting('setSeconds', getSettings().setSeconds);
  state.subState = 'timer';
  startCountdown(seconds, render, setTimeUp, resumeEndsAt);
}
function pressDone() {
  const ex = currentExercise();
  if (ex.type === 'TIME') return; // no manual finish for time-based sets — see data.js note
  clearInterval(state.timer.intervalId);
  goToRepsInput(false);
}
function setTimeUp() {
  playBeep();
  state.subState = 'timeup';
  render();
}
function continueFromTimeUp() {
  goToRepsInput(true);
}
function goToRepsInput(timedOut) {
  state.subState = 'repsInput';
  state.timedOut = timedOut;
  render();
}
function recordResult(status, actual) {
  const ex = currentExercise();
  state.results.push({
    exerciseIndex: state.curExerciseIdx,
    exerciseName: ex.name,
    setNumber: state.curSet,
    status,
    actual: (actual === undefined ? null : actual),
  });
}
function saveActualReps() {
  const input = document.getElementById('actual-input');
  const val = input ? parseInt(input.value, 10) : NaN;
  recordResult('completed', isNaN(val) ? null : Math.max(0, val));
  if (isFinalSet()) { finishWorkout(); return; } // last set of the last exercise: nothing left to rest for
  beginRest();
}
function isFinalSet() {
  const ex = currentExercise();
  return state.curExerciseIdx >= state.exerciseList.length - 1 && state.curSet >= ex.sets;
}
function beginRest(resumeEndsAt) {
  state.subState = 'rest';
  lastMotivSlot = -1; // force a fresh card pick, even if the previous rest also ended in slot 0
  if (!resumeEndsAt) persistActiveSession(); // the just-finished set is already in results; save it before resting
  startCountdown(clampSetting('restSeconds', getSettings().restSeconds), render, () => {
    state.subState = 'restComplete';
    hideRestVisual();
    playBeep();
    render();
  }, resumeEndsAt);
}
// Time adjustment for the Warm-up and Rest countdowns (add or remove). total stays at the planned
// length: the ring clamps to a full circle while remaining > total, then unwinds normally.
function canAdjustTime() {
  return state.screen === 'warmup' || (state.screen === 'active' && state.subState === 'rest');
}
function adjustTime(sec) {
  if (!canAdjustTime() || state.paused) return;
  state.timer.endsAt += sec * 1000;
  state.timer.remaining = Math.max(0, state.timer.remaining + sec);
  render(); // if this ran the clock out, the interval completes the phase on its next tick
}
function openTimeEdit() { if (canAdjustTime() && !state.paused) { state.timeEdit = {}; render(); } }
function closeTimeEdit() { state.timeEdit = null; render(); }
function applyCustomTime(sign) {
  const input = document.getElementById('time-input');
  const v = parseInt(input ? input.value : '', 10);
  if (!(v > 0)) return; // empty/invalid: keep the dialog open
  state.timeEdit = null;
  adjustTime(sign * Math.min(600, v));
}
function timeAdjustBar() {
  const b = (sec, big, unit, cls) => `<button class="${cls}" onclick="adjustTime(${sec})"><b>${big}</b><small>${unit}</small></button>`;
  return `<div class="adjust-bar" role="group" aria-label="Adjust time">
    ${b(-60, '\u22121', 'MIN', 'minus')}${b(-30, '\u221230', 'SEC', 'minus')}${b(30, '+30', 'SEC', 'plus')}${b(60, '+1', 'MIN', 'plus')}
  </div>`;
}
function customTimeCard() {
  return `<button class="action-card" onclick="openTimeEdit()"><span class="action-icon">${icon('clock', 14)}</span><span class="action-text"><small>TIME</small>CUSTOM</span></button>`;
}
function skipRest() {
  clearInterval(state.timer.intervalId);
  hideRestVisual();
  startNextSet();
}
function startNextSet() {
  advanceSetOrExercise();
}
// skipSet()/skipExercise() now only ASK; the actual destructive logic moved to confirmSkip*()
// below so a single accidental tap can never lose progress.
function skipSet() {
  state.confirmAction = { kind: 'skipSet' };
  render();
}
function skipExercise() {
  state.confirmAction = { kind: 'skipExercise' };
  render();
}
function cancelConfirmAction() {
  state.confirmAction = null;
  render();
}
function confirmSkipSet() {
  state.confirmAction = null;
  clearInterval(state.timer.intervalId);
  recordResult('skipped', null);
  advanceSetOrExercise();
}
function confirmSkipExercise() {
  state.confirmAction = null;
  clearInterval(state.timer.intervalId);
  const ex = currentExercise();
  for (let s = state.curSet; s <= ex.sets; s++) {
    state.results.push({ exerciseIndex: state.curExerciseIdx, exerciseName: ex.name, setNumber: s, status: 'skipped', actual: null });
  }
  advanceToNextExerciseOrFinish();
}
function advanceSetOrExercise() {
  const ex = currentExercise();
  if (state.curSet < ex.sets) {
    state.curSet++;
    persistActiveSession();
    beginSetTimer();
    render();
  } else {
    advanceToNextExerciseOrFinish();
  }
}
function advanceToNextExerciseOrFinish() {
  if (state.curExerciseIdx < state.exerciseList.length - 1) {
    state.curExerciseIdx++;
    state.curSet = 1;
    persistActiveSession();
    beginSetTimer();
    render();
  } else {
    finishWorkout();
  }
}
// ---------- Go back to previous set/exercise ----------
// Deliberately mirrors advanceSetOrExercise()'s own persist-then-beginSetTimer-then-render order.
function hasResultFor(exerciseIndex, setNumber) {
  return state.results.some((r) => r.exerciseIndex === exerciseIndex && r.setNumber === setNumber);
}
function removeResultsFor(exerciseIndex, setNumber) {
  // So redoing a step replaces its result instead of leaving a duplicate entry that would throw
  // off buildSummary()'s completed/skipped counts.
  state.results = state.results.filter((r) => !(r.exerciseIndex === exerciseIndex && r.setNumber === setNumber));
}
// curSet/curExerciseIdx point at the CURRENT set, and only advance when the *next* one begins
// (advanceSetOrExercise runs after rest, not right after recordResult) — so while resting/at
// restComplete/timeup, curSet's own result already exists and "back" should redo THAT set, not
// the one before it. Mid-timer/repsInput, curSet has no result yet, so "back" means the previous set.
function previousStepTarget() {
  if (hasResultFor(state.curExerciseIdx, state.curSet)) {
    return { exerciseIdx: state.curExerciseIdx, set: state.curSet };
  }
  if (state.curSet > 1) {
    return { exerciseIdx: state.curExerciseIdx, set: state.curSet - 1 };
  }
  if (state.curExerciseIdx > 0) {
    const idx = state.curExerciseIdx - 1;
    return { exerciseIdx: idx, set: state.exerciseList[idx].sets }; // its last set, the most recent one done
  }
  return null;
}
function hasPreviousStep() {
  return previousStepTarget() !== null;
}
function goToPreviousStep() {
  const target = previousStepTarget();
  if (!target) return;
  clearInterval(state.timer.intervalId);
  hideRestVisual();
  state.paused = false;
  state.pausedAt = null;
  state.timedOut = false;
  state.drawerOpen = false;

  removeResultsFor(target.exerciseIdx, target.set);
  state.curExerciseIdx = target.exerciseIdx;
  state.curSet = target.set;
  persistActiveSession();
  beginSetTimer();
  render();
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) {
    state.pausedAt = Date.now();
  } else if (state.pausedAt) {
    state.timer.endsAt += Date.now() - state.pausedAt; // frozen time doesn't count against the timer
    state.pausedAt = null;
  }
  render();
}

// ---------- Session persistence (section 17) ----------
function persistActiveSession() {
  Store.set('activeSession', {
    sessionKey: state.sessionKey,
    exerciseList: state.exerciseList,
    results: state.results,
    curExerciseIdx: state.curExerciseIdx,
    curSet: state.curSet,
    sessionStartedAt: state.sessionStartedAt,
    offlineMs: state.offlineMs || 0,
    lastSeenAt: Date.now(),
  });
}
function clearActiveSession() {
  Store.set('activeSession', null);
  Store.set('activeTimer', null);
}

// ---------- Workout complete (section 52) ----------
function buildDetails() {
  return {
    exercises: state.exerciseList.map((e) => ({ id: e.id, name: e.name, baseName: e.baseName || e.name, type: e.type, target: e.target, sets: e.sets, custom: !!e.custom })),
    results: state.results.map((r) => ({ exercise: r.exerciseIndex, set: r.setNumber, status: r.status, actual: r.actual })),
  };
}
function finishWorkout() {
  clearInterval(state.timer.intervalId);
  releaseWakeLock();
  const endedAt = Date.now();
  const startedAt = state.sessionStartedAt || endedAt;
  // Duration excludes any long stretch where the app was closed and later resumed.
  const durationSeconds = Math.max(0, Math.round((endedAt - startedAt - (state.offlineMs || 0)) / 1000));
  const summary = buildSummary();
  summary.durationSeconds = durationSeconds;
  summary.startedAt = startedAt;
  const dayStr = localDateStr(new Date(startedAt)); // a workout counts for the day it started
  let entry = {
    type: state.sessionKey,
    date: dayStr,
    status: 'COMPLETED',
    summary,
    details: buildDetails(), // structured per-set results (name, target, actual, status)
    durationMeasured: true,  // app-closed time already removed from this duration
    startedAt,
    endedAt,
    durationSeconds,
  };
  // Never save the same session twice (double tap, revisiting the completion flow).
  const existing = Store.get('history', []).find((h) => h && h.type === entry.type && h.startedAt === startedAt);
  if (existing) entry = existing; else saveHistoryEntry(entry);
  clearActiveSession();
  state.lastSummary = summary;
  state.lastEntry = entry;
  state.screen = 'complete';
  render();
}
function buildSummary() {
  const totalExercises = state.exerciseList.length;
  const totalSetsPlanned = state.exerciseList.reduce((a, e) => a + e.sets, 0);
  const exercisesWithCompletedSet = new Set();
  let completedSets = 0, skippedSets = 0;
  state.results.forEach((r) => {
    if (r.status === 'completed') { completedSets++; exercisesWithCompletedSet.add(r.exerciseIndex); }
    else skippedSets++;
  });
  const completedExercises = exercisesWithCompletedSet.size;
  const skippedExercises = totalExercises - completedExercises;
  const actualRepsList = state.results
    .filter((r) => r.status === 'completed' && r.actual !== null)
    .map((r) => `${r.exerciseName} \u2014 SET ${r.setNumber}: ${r.actual}`);
  return {
    sessionLabel: EXERCISE_DB[state.sessionKey].label,
    completedExercises, totalExercises,
    completedSets, totalSetsPlanned,
    skippedExercises, skippedSets,
    actualRepsList,
  };
}

// ---------- History (section 20 / 42) ----------

// ---------- Streak (section 21 / 43) ----------
// ---------- Day classification, streak & progress analytics ----------
// Single source of truth: Store 'history'. A date is classified only from its own records:
//   T = at least one completed workout   R = no workout, but an explicit REST record   U = no record (unknown)
// Unknown is never treated as rest, as a miss, or as a training day. Nothing is ever back-filled.
const SCHEMA_VERSION = 4;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_CAP = 1500;          // entries kept in total (oldest dropped beyond this)
const HISTORY_FULL_DETAIL = 150;   // newest entries keep per-set details; older ones are condensed
const LEGACY_MAX_SECONDS = 3 * 3600; // older (unflagged) durations above this are excluded from totals
const WEEK_START_DAY = 6;          // Saturday (JS getDay(): 0 = Sunday ... 6 = Saturday)
const DOW_LABELS = ['SA', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR']; // Saturday-first
const DOW_FULL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function esc(v) { return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseDateStr(ds) { const p = ds.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
// Strict calendar-date check: format AND a real date (rejects 2026-02-30, 2026-13-01, 0000-01-01).
function isValidDateStr(v) { return typeof v === 'string' && DATE_RE.test(v) && localDateStr(parseDateStr(v)) === v; }
function addDaysStr(dateStr, n) { const d = parseDateStr(dateStr); d.setDate(d.getDate() + n); return localDateStr(d); } // calendar arithmetic, DST-safe
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-based
function monthKey(ds) { return ds.slice(0, 7); }
function shiftMonthKey(key, delta) {
  const p = key.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function weekdayOffset(ds) { return (parseDateStr(ds).getDay() - WEEK_START_DAY + 7) % 7; } // 0 = first day of the week
function weekStartStr(ds) { return addDaysStr(ds, -weekdayOffset(ds)); }

function validHistory() {
  const raw = Store.get('history', []);
  return (Array.isArray(raw) ? raw : []).filter((h) => h && typeof h === 'object' && typeof h.type === 'string' &&
    isValidDateStr(h.date) && h.status === 'COMPLETED');
}
function buildDayIndex(hist, today) {
  today = today || localDateStr();
  const idx = {};
  (hist || validHistory()).forEach((h) => {
    if (h.date > today) return; // future-dated records are never shown or counted (they stay stored untouched)
    const d = idx[h.date] || (idx[h.date] = { date: h.date, workouts: [], rests: 0 });
    if (h.type === 'REST') d.rests++; else d.workouts.push(h);
  });
  Object.keys(idx).forEach((k) => { idx[k].status = idx[k].workouts.length ? 'T' : 'R'; });
  return idx;
}

// Streak = a run of consecutive calendar days that are each T or R and contain >= 1 T.
// Current streak = the most recent run, only if it ends today, or yesterday (today simply not recorded yet).
// A day with no record breaks verification, so an older run is reported separately as the last verified streak.
function computeStreak(today, idx) {
  today = today || localDateStr();
  idx = idx || buildDayIndex(null, today);
  const dates = Object.keys(idx).filter((d) => d <= today).sort(); // records dated after today are ignored
  const runs = [];
  let cur = null;
  dates.forEach((d) => {
    if (cur && addDaysStr(cur.end, 1) === d) { cur.end = d; cur.days++; }
    else { cur = { start: d, end: d, days: 1, training: 0, rest: 0 }; runs.push(cur); }
    if (idx[d].status === 'T') cur.training++; else cur.rest++;
  });
  const valid = runs.filter((r) => r.training > 0);
  let best = null;
  valid.forEach((r) => { if (!best || r.days >= best.days) best = r; });
  const yesterday = addDaysStr(today, -1);
  const lastRun = runs[runs.length - 1] || null;
  let current = null, state = 'none';
  if (lastRun && lastRun.training > 0 && (lastRun.end === today || lastRun.end === yesterday)) {
    current = lastRun;
    state = lastRun.end === today ? 'recorded-today' : 'today-pending';
  }
  const lastVerified = current ? null : (valid.length ? valid[valid.length - 1] : null);
  const pick = (r) => r ? { days: r.days, training: r.training, rest: r.rest, start: r.start, end: r.end } : null;
  return {
    state, hasRecords: dates.length > 0,
    current: current ? current.days : 0,
    currentTraining: current ? current.training : 0,
    currentRest: current ? current.rest : 0,
    currentStart: current ? current.start : null,
    currentEnd: current ? current.end : null,
    best: best ? best.days : 0, bestInfo: pick(best),
    lastVerified: pick(lastVerified),
  };
}

// ---- Per-entry accessors (defensive: old, partial or imported records never throw) ----
function entrySets(h) { const s = h.summary; return (s && isNum(s.completedSets) && s.completedSets >= 0) ? s.completedSets : null; }
function entryPlannedSets(h) { const s = h.summary; return (s && isNum(s.totalSetsPlanned)) ? s.totalSetsPlanned : null; }
// Duration kinds: measured (new record, app-closed time already removed) | legacy (older record, plausible) |
// excluded (older record above 3 h: likely includes time the app was closed) | unavailable (not recorded).
function entryDuration(h) {
  const raw = isNum(h.durationSeconds) ? h.durationSeconds : ((h.summary && isNum(h.summary.durationSeconds)) ? h.summary.durationSeconds : null);
  if (raw === null || raw < 0) return { sec: null, kind: 'unavailable' };
  if (h.durationMeasured === true || (h.details && typeof h.details === 'object')) return { sec: raw, kind: 'measured' };
  if (raw > LEGACY_MAX_SECONDS) return { sec: null, kind: 'excluded', raw };
  return { sec: raw, kind: 'legacy' };
}
// Reps: REPS/MAX sets with a numeric actual only (time-based sets excluded). Per-set details, while they exist,
// are the single source; a stored total is used only after the details were removed, never together with them.
function repsMetrics(details) {
  let total = 0, sets = 0;
  details.results.forEach((r) => {
    const ex = r && details.exercises[r.exercise];
    if (r && r.status === 'completed' && isNum(r.actual) && ex && (ex.type === 'REPS' || ex.type === 'MAX')) { total += r.actual; sets++; }
  });
  return { repsLogged: total, repsSets: sets };
}
function entryReps(h) {
  if (h.details && Array.isArray(h.details.exercises) && Array.isArray(h.details.results)) {
    const m = repsMetrics(h.details);
    return m.repsSets > 0 ? { total: m.repsLogged, sets: m.repsSets } : null;
  }
  const m = h.metrics;
  if (m && isNum(m.repsLogged) && isNum(m.repsSets) && m.repsSets > 0) return { total: m.repsLogged, sets: m.repsSets };
  return null;
}
// Condense entries beyond the newest HISTORY_FULL_DETAIL: drop per-set details only. Dates, type, status,
// start/end, duration and summary counts stay. The rep total is computed from the details first, then the
// details are removed, so a total and its source details never coexist.
function compactHistory(hist) {
  let changed = false;
  hist.forEach((h, i) => {
    if (i < HISTORY_FULL_DETAIL || !h || typeof h !== 'object') return;
    if (h.details) {
      const ok = Array.isArray(h.details.exercises) && Array.isArray(h.details.results);
      const m = ok ? repsMetrics(h.details) : null;
      if (m && m.repsSets > 0) h.metrics = m; else delete h.metrics;
      if (ok) h.durationMeasured = true;
      delete h.details;
      h.condensed = true;
      changed = true;
    }
    if (h.summary && h.summary.actualRepsList) { delete h.summary.actualRepsList; h.condensed = true; changed = true; }
  });
  return changed;
}
function sortHistory(arr) { // newest first by date, then start time; stable for equal keys
  return arr.map((h, i) => [h, i]).sort((a, b) => {
    const da = String(a[0] && a[0].date), db = String(b[0] && b[0].date);
    if (da !== db) return da < db ? 1 : -1;
    const sa = a[0] && isNum(a[0].startedAt) ? a[0].startedAt : 0, sb = b[0] && isNum(b[0].startedAt) ? b[0].startedAt : 0;
    return sb - sa || a[1] - b[1];
  }).map((p) => p[0]);
}
function saveHistoryEntry(entry) {
  let hist = Store.get('history', []);
  if (!Array.isArray(hist)) hist = [];
  hist.unshift(entry);
  hist = sortHistory(hist); // an older-dated entry (e.g. a resumed old session) still lands in date order
  compactHistory(hist);
  Store.set('history', hist.slice(0, HISTORY_CAP));
}
// v3: history is the only source for streak/calendar ('days'/'streak' keys left untouched, unused).
// v4: the old name-only 'exerciseSwaps' feature is folded into 'exerciseMods' (the old key is left untouched).
function migrateData() {
  const v = Store.get('schemaVersion', 1);
  if (v >= SCHEMA_VERSION) return;
  if (v < 3) {
    const hist = Store.get('history', []);
    if (Array.isArray(hist) && compactHistory(hist)) Store.set('history', hist.slice(0, HISTORY_CAP));
  }
  if (v < 4) {
    const sw = Store.get('exerciseSwaps', null);
    if (sw && typeof sw === 'object' && !Array.isArray(sw)) {
      const raw = Store.get('exerciseMods', {});
      const mods = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? Object.assign({}, raw) : {};
      const conv = swapsToMods(sw);
      Object.keys(conv).forEach((id) => { mods[id] = Object.assign({}, conv[id], mods[id]); });
      Store.set('exerciseMods', mods);
    }
  }
  Store.set('schemaVersion', SCHEMA_VERSION);
}

// ================== RENDERING ==================
let lastRenderKey = null;
let lastMotivSlot = -1; // which MOTIV_ROTATE_SECONDS "slot" we're in, so a new card is only picked when the slot changes
let currentMotivCard = null; // the card locked in for the current slot (render() runs far more often than the slot changes)
const MOTIVATION_RECENT_LIMIT = 20; // was 10 — a 180s rest has ~20 nine-second slots, so 10 let a card repeat inside a single rest
let motivationRecent = [];
let motivationRecentVerses = [];
// Legacy MOTIVATION_CARDS entries stay in the mix for their extra visual variety (the arcs-chart
// 'compare', the fading-line 'repeat', and the stick-figure 'figure' have no equivalent in the new
// library yet). The Quran verse card is deliberately excluded here — see VERSE_CHANCE below.
const MOTIVATION_POOL = MOTIVATION_CARDS.filter((c) => c.type !== 'verse').concat(MOTIVATION_LIBRARY);
const MOTIVATION_VERSES = MOTIVATION_CARDS.filter((c) => c.type === 'verse');
const VERSE_CHANCE = MOTIVATION_VERSES.length ? 1 / 6 : 0; // how often a rest slot shows a verse instead of a regular card
const VERSE_MIN_GAP_MS = 90000; // hard real-world floor: never show a verse again within 90s of the last one
let lastVerseShownAt = 0;

function getRandomMotivationCard(category = null) {
  let pool = category ? MOTIVATION_POOL.filter((card) => card.category === category) : MOTIVATION_POOL;
  if (!pool.length) pool = MOTIVATION_POOL;

  let available = pool.filter((card) => !motivationRecent.includes(card));
  if (!available.length) available = pool;

  const card = available[Math.floor(Math.random() * available.length)];

  motivationRecent.push(card);
  if (motivationRecent.length > MOTIVATION_RECENT_LIMIT) {
    motivationRecent.shift();
  }
  return card;
}
function resetMotivationHistory() {
  motivationRecent = [];
  motivationRecentVerses = [];
}
function getRandomVerseCard() {
  if (!MOTIVATION_VERSES.length) return null;
  let available = MOTIVATION_VERSES.filter((card) => !motivationRecentVerses.includes(card));
  if (!available.length) available = MOTIVATION_VERSES; // e.g. with only one verse so far, it has to repeat itself
  const card = available[Math.floor(Math.random() * available.length)];
  motivationRecentVerses.push(card);
  const verseWindow = Math.max(1, Math.min(MOTIVATION_RECENT_LIMIT, MOTIVATION_VERSES.length - 1));
  if (motivationRecentVerses.length > verseWindow) motivationRecentVerses.shift();
  return card;
}
// ---------- Rest-screen atmospheric visual overlay ----------
// Fully independent of the motivation card text/rotation above. Lives in its own DOM node
// (#rest-visual-layer, outside #app) specifically so the per-second innerHTML replacement of
// #app during the rest countdown never interrupts its slow floating animation or its crossfade.
// See MOTIVATION_VISUALS in data.js for why this ships disabled (empty manifest) for now.
const REST_VISUALS_ENABLED = true; // enabled — MOTIVATION_VISUALS now has two approved assets
const REST_VISUAL_MIN_GAP_SECONDS = 22; // a visual stays up at least this long
const REST_VISUAL_MAX_GAP_SECONDS = 45; // ...and at most this long before crossfading to a new one
let restVisualRecent = [];
let restVisualNextSwapAt = 0; // elapsed-seconds threshold for the next swap; 0 = "show one immediately"
let restVisualShowing = false;

function getRandomVisual(preferTag) {
  if (!MOTIVATION_VISUALS.length) return null;
  // Soft preference only: if some visuals are tagged for the current card's mood, favour those;
  // otherwise fall back to the whole set so the visual stays independent of the text.
  let pool = MOTIVATION_VISUALS;
  if (preferTag) {
    const matched = pool.filter((v) => (v.tags || []).includes(preferTag));
    if (matched.length) pool = matched;
  }
  let available = pool.filter((v) => !restVisualRecent.includes(v));
  if (!available.length) available = pool;
  const visual = available[Math.floor(Math.random() * available.length)];
  restVisualRecent.push(visual);
  const window = Math.max(1, Math.min(4, MOTIVATION_VISUALS.length - 1));
  if (restVisualRecent.length > window) restVisualRecent.shift();
  return visual;
}
function maybeAdvanceRestVisual(elapsed) {
  if (!REST_VISUALS_ENABLED || !MOTIVATION_VISUALS.length) return;
  if (elapsed < restVisualNextSwapAt) return;
  const layer = document.getElementById('rest-visual-layer');
  if (!layer) return;
  const cardTag = currentMotivCard && currentMotivCard.category ? String(currentMotivCard.category).toLowerCase() : null;
  const visual = getRandomVisual(cardTag);
  if (!visual) return;

  const outgoing = layer.querySelector('.rest-visual.floating, .rest-visual.entering');
  if (outgoing) {
    outgoing.classList.remove('entering', 'floating');
    outgoing.classList.add('leaving');
    setTimeout(() => outgoing.remove(), 1900);
  }

  const el = document.createElement('div');
  el.className = 'rest-visual entering';
  el.style.setProperty('--rv-opacity', visual.opacity ?? 0.85);
  el.style.setProperty('--rv-scale', visual.scale ?? 1);
  el.style.setProperty('--rv-duration', (10 + Math.random() * 6).toFixed(1) + 's'); // 10-16s, per-instance
  el.style.setProperty('--rv-delay', (-Math.random() * 6).toFixed(1) + 's'); // desync multiple sessions
  const img = document.createElement('img');
  img.src = visual.src;
  img.alt = '';
  el.appendChild(img);
  layer.appendChild(el);

  el.addEventListener('animationend', function onEnterEnd(e) {
    if (e.animationName !== 'restVisualEnter') return;
    el.removeEventListener('animationend', onEnterEnd);
    el.classList.remove('entering');
    el.classList.add('floating');
  });

  restVisualShowing = true;
  restVisualNextSwapAt = elapsed + REST_VISUAL_MIN_GAP_SECONDS + Math.random() * (REST_VISUAL_MAX_GAP_SECONDS - REST_VISUAL_MIN_GAP_SECONDS);
}
function hideRestVisual() {
  const layer = document.getElementById('rest-visual-layer');
  if (layer) layer.innerHTML = '';
  restVisualShowing = false;
  restVisualNextSwapAt = 0; // next rest starts fresh (shows one right away)
  restVisualRecent = [];
}
function pickMotivCardForSlot() {
  // Real-world cooldown, not slot-count-based: with only 1 verse in the pool right now, the old
  // "1-in-6 per 9s slot" chance meant that same verse could resurface 3+ times in a single 180s
  // rest. This caps it to at most once per VERSE_MIN_GAP_MS regardless of how many verses exist,
  // and will naturally spread out further once more verses are added to MOTIVATION_CARDS.
  const verseEligible = VERSE_CHANCE && (Date.now() - lastVerseShownAt) > VERSE_MIN_GAP_MS;
  if (verseEligible && Math.random() < VERSE_CHANCE) {
    lastVerseShownAt = Date.now();
    return getRandomVerseCard();
  }
  return getRandomMotivationCard();
}
function render() {
  const app = document.getElementById('app');
  const renderKey = state.screen + '|' + state.subState;
  const isNewView = renderKey !== lastRenderKey;
  lastRenderKey = renderKey;
  switch (state.screen) {
    case 'home': app.innerHTML = renderHome(); break;
    case 'setup': app.innerHTML = renderSetup(); break;
    case 'ready': app.innerHTML = renderReady(); break;
    case 'warmup': app.innerHTML = renderWarmup(); break;
    case 'active': app.innerHTML = renderActive(); break;
    case 'complete': app.innerHTML = renderComplete(); break;
    case 'history': app.innerHTML = renderHistory(); break;
    case 'settings': app.innerHTML = renderSettings(); break;
    case 'advancedSettings': app.innerHTML = renderAdvancedSettings(); break;
    case 'progress': app.innerHTML = renderProgress(); break;
    case 'customMods': app.innerHTML = renderCustomMods(); break;
  }
  if (isNewView && app.firstElementChild) {
    app.firstElementChild.classList.add('fade-in');
  }
  renderModal();
  renderBottomNav();
  persistTimerSnapshot();
}
// Tiny snapshot (phase + absolute end time) so quitting mid-rest/warm-up/set resumes correctly.
function persistTimerSnapshot() {
  if ((state.screen !== 'active' && state.screen !== 'warmup') || !state.sessionStartedAt) return;
  let endsAt = state.timer.endsAt || null;
  if (state.paused && state.pausedAt && endsAt) endsAt += Date.now() - state.pausedAt; // paused time doesn't run down
  Store.set('activeTimer', {
    sessionStartedAt: state.sessionStartedAt,
    screen: state.screen,
    subState: state.subState,
    warmupIdx: state.warmupIdx,
    timedOut: !!state.timedOut,
    endsAt,
    lastSeenAt: Date.now(),
  });
}

function renderReady() {
  return `<div class="screen ready-screen">
    <div class="phase-label">GET READY</div>
    <div class="ready-count">${state.timer.remaining}</div>
  </div>`;
}

function sessionMeta(key) {
  if (key === 'REST') return { icon: 'moon', sub: 'RECOVERY DAY' };
  const def = EXERCISE_DB[key];
  return { icon: 'dumbbell', sub: `${exerciseCount(key)} EXERCISES` };
}

function renderHome() {
  const st = computeStreak();
  const resumable = Store.get('activeSession', null);
  let html = '<div class="screen home-screen">';
  html += `<div class="app-header"><span class="logo-dot"></span><h1>WorkoutApp</h1></div>`;
  html += streakCardHtml(st, true);
  if (resumable) {
    const label = EXERCISE_DB[resumable.sessionKey] ? EXERCISE_DB[resumable.sessionKey].label : resumable.sessionKey;
    html += `<div class="resume-row"><button class="resume-banner" onclick="resumeSession()">${icon('play', 16)} RESUME ${label}</button><button class="discard-btn" onclick="askDiscardSession()" aria-label="Discard unfinished workout">${icon('x', 16)}</button></div>`;
  }
  html += '<div class="session-grid">';
  SESSION_ORDER.forEach((key) => {
    const label = key === 'REST' ? 'REST' : EXERCISE_DB[key].label;
    const meta = sessionMeta(key);
    html += `<button class="session-card${key === 'REST' ? ' rest-card' : ''}" onclick="selectSession('${key}')">
      <span class="session-icon-chip">${icon(meta.icon, 18)}</span>
      <div>
        <div class="session-card-label">${label}</div>
        <div class="session-card-sub">${meta.sub}</div>
      </div>
    </button>`;
  });
  html += '</div></div>';
  return html;
}

function renderSetup() {
  const def = EXERCISE_DB[state.sessionKey];
  let html = '<div class="screen setup-screen">';
  html += `<button class="back-btn" onclick="goHome()">${icon('chevronLeft', 18)}</button>`;
  html += `<h2>${def.label}</h2>`;
  if (def.pending) html += `<div class="pending-note">${def.pendingNote}</div>`;
  html += renderQuickSetup();
  html += '<div class="exercise-list">';
  state.exerciseList.forEach((ex, i) => {
    html += `<div class="exercise-row">
      <div class="exercise-top">
        <span class="exercise-index">${String(i + 1).padStart(2, '0')}</span>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-target"><span>${targetLabel(ex)}</span>${exFlagsHtml(ex)}</div>
        </div>
        <button class="swap-btn" onclick="openEdit(${i})">${icon('edit', 12)}<span>EDIT</span></button>
      </div>
      <div class="exercise-controls">
        <div class="sets-stepper">
          <button class="stepper-btn" onclick="changeSets(${i},-1)" aria-label="Fewer sets">\u2212</button>
          <span class="sets-count">${ex.sets} SETS</span>
          <button class="stepper-btn" onclick="changeSets(${i},1)" aria-label="More sets">+</button>
        </div>
        <div class="order-group">
          <button class="order-btn" onclick="moveExercise(${i},-1)" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('chevronUp', 14)}</button>
          <button class="order-btn" onclick="moveExercise(${i},1)" ${i === state.exerciseList.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('chevronDown', 14)}</button>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';
  const exCount = state.exerciseList.length, full = exCount >= MAX_EXERCISES;
  html += `<button class="add-exercise" ${full ? 'disabled' : ''} onclick="openAdd()">${icon('plus', 16)}<span>ADD EXERCISE</span><b>${exCount}/${MAX_EXERCISES}</b></button>`;
  if (full) html += `<div class="p-note add-note">A workout can have at most ${MAX_EXERCISES} exercises. Remove an added exercise to free a slot.</div>`;
  html += `<button class="primary-btn" onclick="startWorkoutFlow()">${icon('play', 16)} START WORKOUT</button>`;
  html += '</div>';
  return html;
}

function renderWarmup() {
  const item = state.warmupList[state.warmupIdx];
  let html = '<div class="screen warmup-screen">';
  html += '<div class="phase-label">WARM-UP</div>';
  html += `<h2>${item.name}</h2>`;
  html += timerBlock(state.timer.remaining, state.timer.total);
  html += timeAdjustBar();
  html += `<div class="action-grid">
    <button class="action-card" onclick="togglePause()"><span class="action-icon">${icon('pause', 14)}</span><span class="action-text"><small>HOLD</small>PAUSE</span></button>
    ${customTimeCard()}
    <button class="action-card accent wide" onclick="skipWarmupStep()">${icon('skipForward', 16)}<span class="action-label">SKIP</span></button>
  </div>`;
  html += '</div>';
  return html;
}

function renderActive() {
  const ex = currentExercise();
  const total = state.exerciseList.length;
  let html = '<div class="screen active-screen">';
  html += `<button class="drawer-toggle" onclick="toggleDrawer()" aria-label="Workout progress">${icon('list', 18)}</button>`;
  html += `<div class="progress-label">EXERCISE ${state.curExerciseIdx + 1} / ${total}</div>`;
  if (state.subState === 'timer') {
    html += `<h2>${ex.name}</h2>`;
    html += `<div class="set-label">SET ${state.curSet} / ${ex.sets}</div>`;
    html += `<div class="target-label">${ex.type === 'MAX' ? 'MAX CLEAN REPS' : 'TARGET ' + targetLabel(ex)}</div>`;
    if (ex.type !== 'TIME') {
      html += `<div class="target-hint">Take your time \u2014 tap DONE whenever you finish. The set ends automatically at ${fmtTime(state.timer.total)}.</div>`;
    }
    html += timerBlock(state.timer.remaining, state.timer.total);
    if (ex.type !== 'TIME') {
      html += `<button class="primary-btn" onclick="pressDone()">${icon('check', 18)} DONE</button>`;
    }
    html += `<div class="action-grid">
      <button class="action-card wide" onclick="togglePause()"><span class="action-icon">${icon('pause', 14)}</span><span class="action-label">PAUSE</span></button>
      <button class="action-card" onclick="skipSet()"><span class="action-icon">${icon('skipForward', 14)}</span><span class="action-text"><small>SKIP</small>SET</span></button>
      <button class="action-card" onclick="skipExercise()"><span class="action-icon">${icon('skipForward', 14)}</span><span class="action-text"><small>SKIP</small>EXERCISE</span></button>
    </div>`;
  } else if (state.subState === 'timeup') {
    html += '<div class="timeup-flash">TIME\'S UP</div>';
    html += `<button class="primary-btn" onclick="continueFromTimeUp()">${icon('check', 18)} CONTINUE</button>`;
  } else if (state.subState === 'repsInput') {
    html += renderRepsInput(ex);
  } else if (state.subState === 'rest') {
    html += renderRest();
  } else if (state.subState === 'restComplete') {
    html += '<div class="rest-complete-label">REST COMPLETE</div>';
    html += `<button class="primary-btn" onclick="startNextSet()">${icon('play', 16)} START NEXT SET</button>`;
  }
  html += '</div>';
  return html;
}

function renderRepsInput(ex) {
  let targetHtml, prefill;
  if (ex.type === 'MAX') { targetHtml = '<div class="target-label">MAX CLEAN REPS</div>'; prefill = ''; }
  else if (Array.isArray(ex.target)) { targetHtml = `<div class="target-label">TARGET ${ex.target[0]}\u2013${ex.target[1]} REPS</div>`; prefill = ex.target[1]; }
  else { targetHtml = `<div class="target-label">TARGET ${ex.target} REPS</div>`; prefill = ex.target; }
  return `<div class="reps-dialog">
    ${state.timedOut ? '<div class="timeup-tag">TIME\'S UP</div>' : ''}
    ${targetHtml}
    <label class="actual-label">ACTUAL</label>
    <div class="actual-stepper">
      <button class="stepper-btn-lg" onclick="adjustActualInput(-1)">\u2212</button>
      <input id="actual-input" type="number" inputmode="numeric" min="0" class="actual-input" value="${prefill}">
      <button class="stepper-btn-lg" onclick="adjustActualInput(1)">+</button>
    </div>
    <button class="primary-btn" onclick="saveActualReps()">${icon('check', 18)} SAVE</button>
  </div>`;
}
function adjustActualInput(delta) {
  const input = document.getElementById('actual-input');
  if (!input) return;
  const current = parseInt(input.value, 10);
  input.value = Math.max(0, (isNaN(current) ? 0 : current) + delta);
}

function renderRest() {
  const elapsed = Math.max(0, state.timer.total - state.timer.remaining);
  const slot = Math.floor(elapsed / clampSetting('motivRotateSeconds', getSettings().motivRotateSeconds));
  const slotChanged = slot !== lastMotivSlot;
  if (slotChanged || !currentMotivCard) {
    currentMotivCard = pickMotivCardForSlot();
  }
  lastMotivSlot = slot;
  maybeAdvanceRestVisual(elapsed); // independent of the text-card setting below — the visual overlay is its own system
  const cardsOn = getSettings().motivationCards;
  return `<div class="rest-block">
    <div class="phase-label">REST</div>
    ${timerBlock(state.timer.remaining, state.timer.total)}
    ${timeAdjustBar()}
    <div class="action-grid">
      ${customTimeCard()}
      <button class="action-card accent" onclick="skipRest()">${icon('skipForward', 16)}<span class="action-label">SKIP REST</span></button>
    </div>
    ${cardsOn ? `<div class="motiv-wrap${slotChanged ? ' fade-in' : ''}">${renderMotivCard(currentMotivCard)}</div>` : ''}
  </div>`;
}

// ---------- Rest-screen motivational cards (data-driven, see MOTIVATION_CARDS) ----------
// Missing/typo'd fields must never render as the literal word "undefined".
function mvs(v) { return v === undefined || v === null ? '' : v; }
function renderMotivText(text) {
  return mvs(text).replace(/==(.+?)==/g, '<mark class="motiv-highlight">$1</mark>');
}
// Safety net: a malformed card renders nothing (and warns in the console) instead of throwing,
// because render() runs every second and one bad card would otherwise freeze the rest screen.
function renderMotivCard(card) {
  try {
    return card ? renderMotivCardInner(card) : '';
  } catch (e) {
    console.warn('Malformed motivation card skipped:', card, e);
    return '';
  }
}
function renderMotivCardInner(card) {
  switch (card.type) {
    case 'quote':
      // New library entries are {en, ar}; the original hand-written cards use {text} with ==highlight== markup.
      if (card.en !== undefined) return renderMotivBilingualQuote(card.en, card.ar);
      if (card.text !== undefined) return `<div class="motiv-quote">${renderMotivText(card.text)}</div>`;
      return '';
    case 'definition':
      // New library entries are {category, en, ar} — no headline word, so the category stands in for one.
      if (card.word === undefined) {
        if (card.en === undefined) return '';
        return `<div class="motiv-definition">
          <div class="motiv-def-word">${card.category || 'DEFINITION'}</div>
          <div class="motiv-def-lines"><p>${mvs(card.en)}</p></div>
          <div class="motiv-def-lines motiv-def-ar" dir="rtl" lang="ar"><p>${mvs(card.ar)}</p></div>
        </div>`;
      }
      return `<div class="motiv-definition">
        <div class="motiv-def-word">${card.word}</div>
        <div class="motiv-def-sub">${card.sub}</div>
        <div class="motiv-def-lines">${card.lines.map((l) => `<p>${l}</p>`).join('')}</div>
      </div>`;
    case 'compare':
      // New library entries are {title, en, ar} (a plain "X vs Y" line); the original 'compare' cards
      // draw the arcs chart from {topLabel, bottomLabel, topCount, bottomCount}.
      if (card.topLabel === undefined) {
        if (card.en === undefined) return '';
        return `<div class="motiv-compare motiv-compare-text">
          <div class="motiv-compare-title">${mvs(card.title)}</div>
          <div class="motiv-quote">${mvs(card.en)}</div>
          <div class="motiv-quote motiv-bilingual-ar" dir="rtl" lang="ar">${mvs(card.ar)}</div>
        </div>`;
      }
      return renderMotivCompare(card);
    case 'figure':
      return `<div class="motiv-figure">${motivFigureSvg()}<div class="motiv-figure-phrase">${card.phrase}</div></div>`;
    case 'repeat':
      // New library entries are {en, ar} short punch lines; the original 'repeat' cards fade out a
      // repeated {filler} line {count} times under a {line} headline.
      if (card.filler === undefined) {
        if (card.en === undefined) return '';
        return `<div class="motiv-repeat motiv-punch">
          <div class="motiv-repeat-first motiv-punch-en">${mvs(card.en)}</div>
          <div class="motiv-repeat-first motiv-punch-ar" dir="rtl" lang="ar">${mvs(card.ar)}</div>
        </div>`;
      }
      const lines = Array.from({ length: card.count }, (_, i) =>
        `<div class="motiv-repeat-line" style="opacity:${Math.max(0.15, 1 - (i + 1) * 0.15).toFixed(2)}">${card.filler}</div>`
      ).join('');
      return `<div class="motiv-repeat"><div class="motiv-repeat-first">${renderMotivText('==' + card.line + '==')}</div>${lines}</div>`;
    case 'verse':
      return `<div class="motiv-verse">
        <div class="motiv-verse-arabic" dir="rtl" lang="ar">${card.arabic}</div>
        <div class="motiv-verse-translation">${card.translation}</div>
      </div>`;
    default:
      return '';
  }
}
function renderMotivBilingualQuote(en, ar) {
  return `<div class="motiv-quote motiv-bilingual">
    <div>${mvs(en)}</div>
    <div class="motiv-bilingual-ar" dir="rtl" lang="ar">${mvs(ar)}</div>
  </div>`;
}
function motivDecayHeights(n, maxH) {
  return Array.from({ length: n }, (_, i) => Math.max(4, maxH * Math.pow(0.55, i)));
}
function motivArcsSvg(count, heights, y, width) {
  const segW = width / count;
  let paths = '';
  for (let i = 0; i < count; i++) {
    const x0 = i * segW, x1 = x0 + segW, midX = (x0 + x1) / 2, h = heights[i];
    paths += `<path d="M${x0.toFixed(1)},${y} Q${midX.toFixed(1)},${(y - h).toFixed(1)} ${x1.toFixed(1)},${y}" fill="none" stroke="white" stroke-width="2"/>`;
  }
  return paths;
}
function renderMotivCompare(card) {
  const w = 260, topH = 46, bottomH = 34;
  const topCount = card.topCount || 4, bottomCount = card.bottomCount || 8;
  const topArcs = motivArcsSvg(topCount, motivDecayHeights(topCount, 36), topH - 4, w);
  const bottomArcs = motivArcsSvg(bottomCount, Array(bottomCount).fill(18), bottomH - 4, w);
  return `<div class="motiv-compare">
    <svg viewBox="0 0 ${w} ${topH}" class="motiv-compare-svg">${topArcs}<line x1="0" y1="${topH - 4}" x2="${w}" y2="${topH - 4}" stroke="#4a4a4e" stroke-width="1.5"/></svg>
    <div class="motiv-compare-label">${card.topLabel}</div>
    <div class="motiv-compare-gap"></div>
    <svg viewBox="0 0 ${w} ${bottomH}" class="motiv-compare-svg">${bottomArcs}<line x1="0" y1="${bottomH - 4}" x2="${w}" y2="${bottomH - 4}" stroke="#4a4a4e" stroke-width="1.5"/></svg>
    <div class="motiv-compare-label">${card.bottomLabel}</div>
  </div>`;
}
function motivFigureSvg() {
  return `<svg viewBox="0 0 100 140" class="motiv-figure-svg">
    <circle cx="50" cy="20" r="14" fill="none" stroke="white" stroke-width="2.5"/>
    <line x1="50" y1="34" x2="50" y2="90" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="50" y1="46" x2="28" y2="80" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="50" y1="46" x2="72" y2="80" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="50" y1="90" x2="35" y2="135" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <line x1="50" y1="90" x2="65" y2="135" stroke="white" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function renderComplete() {
  const s = state.lastSummary;
  let html = '<div class="screen complete-screen">';
  html += '<div class="complete-title">WORKOUT COMPLETE</div>';
  html += `<h2>${s.sessionLabel}</h2>`;
  html += `<div class="complete-duration">${icon('clock', 14)} ${fmtDuration(s.durationSeconds)}</div>`;
  html += `<div class="stats-block">
    <div class="stats-heading">Completed</div>
    <div class="stats-row"><span>Exercises</span><span>${s.completedExercises}/${s.totalExercises}</span></div>
    <div class="stats-row"><span>Sets</span><span>${s.completedSets}/${s.totalSetsPlanned}</span></div>
    ${s.actualRepsList.length ? `<div class="actual-reps-list">${s.actualRepsList.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
  </div>`;
  html += `<div class="stats-block">
    <div class="stats-heading">Skipped</div>
    <div class="stats-row"><span>Exercises</span><span>${s.skippedExercises}</span></div>
    <div class="stats-row"><span>Sets</span><span>${s.skippedSets}</span></div>
  </div>`;
  html += `<button class="action-card wide" onclick="copyLastSummary()"><span class="action-icon">${icon('copy', 14)}</span><span class="action-label">COPY SUMMARY</span></button>`;
  html += `<button class="primary-btn" onclick="goHome()">${icon('check', 18)} DONE</button>`;
  html += '</div>';
  return html;
}

function renderHistory() {
  const hist = Store.get('history', []);
  let html = '<div class="screen history-screen"><h2>HISTORY</h2>';
  if (hist.length === 0) {
    html += `<div class="empty-state">${icon('history', 30)}<div class="empty-title">NO WORKOUTS YET</div><div class="empty-sub">Complete your first workout to see it here.</div></div>`;
  } else {
    html += '<div class="history-list">';
    let focusDone = false;
    hist.forEach((h, idx) => {
      const label = h.type === 'REST' ? 'REST' : (EXERCISE_DB[h.type] ? EXERCISE_DB[h.type].label : h.type);
      const chipIcon = h.type === 'REST' ? 'moon' : 'dumbbell';
      const isFocus = !!state.historyFocus && h.date === state.historyFocus;
      const idAttr = isFocus && !focusDone ? ' id="hist-focus"' : '';
      if (isFocus) focusDone = true;
      html += `<div class="history-row${isFocus ? ' is-focus' : ''}"${idAttr}>
        <div class="history-icon-chip${h.type === 'REST' ? '' : ' is-workout'}">${icon(chipIcon, 16)}</div>
        <div class="history-info">
          <div class="history-label">${label}</div>
          <div class="history-status">${h.status}${typeof h.durationSeconds === 'number' ? ' \u00b7 ' + fmtDuration(h.durationSeconds) : ''}</div>
        </div>
        <div class="history-date">${h.date}</div>
        ${h.type !== 'REST' && h.summary ? `<button class="history-copy" onclick="copyHistoryEntry(${idx})" aria-label="Copy summary">${icon('copy', 14)}</button>` : ''}
      </div>`;
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderSettings() {
  const settings = getSettings();
  const toggle = (key, ic, label) => `<div class="settings-row">
      <span class="settings-row-label">${icon(ic, 16)}<span>${label}</span></span>
      <button class="toggle ${settings[key] ? 'on' : ''}" onclick="toggleSetting('${key}')">${settings[key] ? 'ON' : 'OFF'}</button>
    </div>`;
  const link = (fn, ic, label, sub, chev) => `<button class="settings-row link" onclick="${fn}">
      <span class="settings-row-label">${icon(ic, 16)}<span class="row-text">${label}<small>${sub}</small></span></span>
      ${chev ? `<span class="row-chev">${icon('chevronLeft', 16, 'icon-flip')}</span>` : ''}
    </button>`;
  return `<div class="screen settings-screen"><h2>SETTINGS</h2>
    <div class="settings-group-title">PREFERENCES</div>
    ${toggle('keepAwake', 'eye', 'KEEP SCREEN AWAKE')}${toggle('alertSound', 'bell', 'SYSTEM ALERT SOUND')}${toggle('motivationCards', 'list', 'MOTIVATION CARDS')}
    <div class="settings-group-title">WORKOUT</div>
    ${link('goAdvancedSettings()', 'settings', 'ADVANCED', 'Rest, set, warm-up and countdown times', true)}
    ${link('goCustomMods()', 'edit', 'CUSTOMIZATION', 'Saved exercise changes and added exercises', true)}
    <div class="settings-group-title">DATA</div>
    ${link('exportData()', 'download', 'EXPORT BACKUP', 'Copy your data to the clipboard', false)}
    ${link('openImport()', 'upload', 'IMPORT BACKUP', 'Restore from a backup you exported', false)}
  </div>`;
}

function renderAdvancedSettings() {
  const s = getSettings();
  const fmt = (f, v) => f.mmss ? fmtTime(v) : v + 's';
  const rows = ADVANCED_FIELDS.map(f => {
    const v = clampSetting(f.key, s[f.key]);
    return `<div class="settings-row">
      <span class="settings-row-label"><span>${f.label}</span></span>
      <span class="stepper-inline">
        <button class="stepper-btn" ${v <= f.min ? 'disabled' : ''} onclick="changeSetting('${f.key}', -1)" aria-label="Decrease">\u2212</button>
        <span class="stepper-value">${fmt(f, v)}</span>
        <button class="stepper-btn" ${v >= f.max ? 'disabled' : ''} onclick="changeSetting('${f.key}', 1)" aria-label="Increase">+</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="screen settings-screen">
    <button class="back-btn" onclick="goSettings()">${icon('chevronLeft', 18)}</button>
    <h2>ADVANCED</h2>
    ${rows}
    <div class="target-hint">Changes apply from the next phase. A countdown already running keeps its time.</div>
    <button class="ghost-btn" onclick="resetAdvancedSettings()"><span>RESET TO DEFAULTS</span></button>
  </div>`;
}

// Tracks whether the drawer was already open on the previous render, purely so its slide-in
// animation plays once on open rather than replaying every render while it stays open
// (renderModal's output is rebuilt on every tick, unlike a framework that diffs the DOM).
let drawerWasOpen = false;

function renderModal() {
  const root = document.getElementById('modal-root');
  if (state.timeEdit && !canAdjustTime()) state.timeEdit = null;
  if (state.paused && (state.screen === 'active' || state.screen === 'warmup')) {
    root.innerHTML = `<div class="overlay">
      <div class="overlay-card">
        <div class="overlay-icon">${icon('pause', 24)}</div>
        <div class="overlay-title">PAUSED</div>
        <button class="primary-btn" onclick="togglePause()">${icon('play', 16)} RESUME</button>
      </div>
    </div>`;
    drawerWasOpen = false;
  } else if (state.timeEdit) {
    if (!root.querySelector('#time-input')) { // don't rebuild while open: it would wipe the typed value
      root.innerHTML = renderTimeEditOverlay();
      const input = document.getElementById('time-input');
      if (input) input.focus();
    }
    drawerWasOpen = false;
  } else if (state.importOpen && state.screen === 'settings') {
    if (state.importPreview) {
      root.innerHTML = renderImportPreview();
    } else if (!root.querySelector('#import-input')) { // don't rebuild while open: it would wipe the pasted text
      root.innerHTML = renderImportOverlay();
      const input = document.getElementById('import-input');
      if (input) input.focus();
    }
    drawerWasOpen = false;
  } else if (state.confirmAction) {
    root.innerHTML = renderConfirmOverlay(state.confirmAction);
    drawerWasOpen = false;
  } else if (state.editEx && (state.screen === 'setup' || state.screen === 'customMods')) {
    if (!root.querySelector('#edit-name')) { // don't rebuild while open: it would wipe what's being typed
      root.innerHTML = renderEditSheet();
      const input = document.getElementById('edit-name');
      if (input && state.editEx.isNew && !state.editEx.draft.name) input.focus();
    }
    drawerWasOpen = false;
  } else if (state.drawerOpen && (state.screen === 'active')) {
    const justOpened = !drawerWasOpen;
    root.innerHTML = renderWorkoutDrawer(justOpened);
    drawerWasOpen = true;
  } else {
    root.innerHTML = '';
    drawerWasOpen = false;
  }
}

function renderImportOverlay() {
  return `<div class="overlay" onclick="if(event.target===this) closeImport()">
    <div class="overlay-card">
      <div class="overlay-icon">${icon('upload', 22)}</div>
      <div class="overlay-title">IMPORT BACKUP</div>
      <p class="confirm-body swap-body">Paste a backup you exported. You will see a summary before anything is replaced.</p>
      <textarea id="import-input" class="text-input text-area" placeholder="Paste backup here" spellcheck="false">${esc(state.importDraft || '')}</textarea>
      <div class="confirm-row">
        <button class="ghost-btn" onclick="closeImport()"><span>CANCEL</span></button>
        <button class="primary-btn" onclick="applyImport()"><span>IMPORT</span></button>
      </div>
    </div>
  </div>`;
}

function renderTimeEditOverlay() {
  return `<div class="overlay" onclick="if(event.target===this) closeTimeEdit()">
    <div class="overlay-card">
      <div class="overlay-icon">${icon('clock', 22)}</div>
      <div class="overlay-title">ADJUST TIME</div>
      <p class="confirm-body swap-body">Seconds to add or remove from the countdown.</p>
      <input id="time-input" class="text-input" type="number" inputmode="numeric" min="1" max="600" placeholder="45" onkeydown="if(event.key==='Enter') applyCustomTime(1)">
      <div class="confirm-row">
        <button class="ghost-btn" onclick="applyCustomTime(-1)"><span>\u2212 REMOVE</span></button>
        <button class="primary-btn" onclick="applyCustomTime(1)"><span>+ ADD</span></button>
      </div>
    </div>
  </div>`;
}


const CONFIRM_TEXT = {
  skipSet: { title: 'SKIP SET?', body: 'This set will be marked as skipped.', fn: 'confirmSkipSet', btn: 'SKIP SET', ic: 'skipForward' },
  skipExercise: { title: 'SKIP EXERCISE?', body: 'All remaining sets of this exercise will be marked as skipped.', fn: 'confirmSkipExercise', btn: 'SKIP EXERCISE', ic: 'skipForward' },
  resetExercise: { title: 'RESET TO DEFAULT?', body: 'Your saved changes for this exercise are removed. Past workouts in History are not changed.', fn: 'confirmResetExercise', btn: 'RESET', ic: 'reset' },
  removeExercise: { title: 'REMOVE EXERCISE?', body: 'This added exercise is deleted from the workout. Past workouts in History are not changed.', fn: 'confirmRemoveExercise', btn: 'REMOVE', ic: 'trash' },
  resetSession: { title: (a) => 'RESET ' + sessionShort(a.sessionKey) + '?', body: 'The original settings return for every exercise in this session. Exercises you added are kept. History is not changed.', fn: 'confirmResetSession', btn: 'RESET SESSION', ic: 'reset' },
  resetAllMods: { title: 'RESET ALL MODIFICATIONS?', body: 'Every saved change to the original exercises returns to its default. Added exercises are kept. History is not changed.', fn: 'confirmResetAllMods', btn: 'RESET ALL', ic: 'reset' },
  discardSession: { title: 'DISCARD WORKOUT?', body: 'The unfinished workout is deleted and will not count toward your streak.', fn: 'confirmDiscardSession', btn: 'DISCARD', ic: 'x' },
};
function askDiscardSession() { state.confirmAction = { kind: 'discardSession' }; render(); }
function confirmDiscardSession() { state.confirmAction = null; clearActiveSession(); render(); }
function renderConfirmOverlay(action) {
  const c = CONFIRM_TEXT[action.kind] || CONFIRM_TEXT.skipSet;
  return `<div class="overlay" onclick="if(event.target===this) cancelConfirmAction()">
    <div class="overlay-card">
      <div class="overlay-icon">${icon(c.ic, 22)}</div>
      <div class="overlay-title">${typeof c.title === 'function' ? c.title(action) : c.title}</div>
      <p class="confirm-body">${typeof c.body === 'function' ? c.body(action) : c.body}</p>
      <div class="confirm-row">
        <button class="ghost-btn" onclick="cancelConfirmAction()"><span>CANCEL</span></button>
        <button class="primary-btn" onclick="${c.fn}()">${icon(c.ic, 16)}<span>${c.btn}</span></button>
      </div>
    </div>
  </div>`;
}

// ---------- Workout progress drawer ----------
function toggleDrawer() {
  state.drawerOpen = !state.drawerOpen;
  render();
}
function renderWorkoutDrawer(animateIn) {
  const rows = state.exerciseList.map((ex, i) => {
    let statusClass, marker;
    if (i < state.curExerciseIdx) {
      const setsForEx = state.results.filter((r) => r.exerciseIndex === i);
      const allSkipped = setsForEx.length > 0 && setsForEx.every((r) => r.status === 'skipped');
      statusClass = allSkipped ? 'drawer-skipped' : 'drawer-done';
      marker = allSkipped ? icon('skipForward', 13) : icon('check', 13);
    } else if (i === state.curExerciseIdx) {
      statusClass = 'drawer-current';
      marker = '<span class="drawer-dot"></span>';
    } else {
      statusClass = 'drawer-upcoming';
      marker = '<span class="drawer-ring"></span>';
    }
    const setInfo = i === state.curExerciseIdx ? `<span class="drawer-set">SET ${state.curSet} / ${ex.sets}</span>` : '';
    return `<div class="drawer-row ${statusClass}">
      <span class="drawer-marker">${marker}</span>
      <span class="drawer-name">${ex.name}</span>
      ${setInfo}
    </div>`;
  }).join('');

  const canGoBack = hasPreviousStep();
  return `<div class="drawer-backdrop" onclick="if(event.target===this) toggleDrawer()">
    <div class="drawer-panel${animateIn ? ' drawer-animate-in' : ''}">
      <div class="drawer-header">
        <span>WORKOUT</span>
        <button class="drawer-close" onclick="toggleDrawer()">${icon('x', 18)}</button>
      </div>
      <div class="drawer-list">${rows}</div>
      <button class="ghost-btn drawer-back-btn" ${canGoBack ? '' : 'disabled'} onclick="goToPreviousStep()">${icon('chevronLeft', 16)}<span>PREVIOUS STEP</span></button>
    </div>
  </div>`;
}

function renderBottomNav() {
  const nav = document.getElementById('bottom-nav');
  const showNav = ['home', 'history', 'settings', 'advancedSettings', 'progress', 'customMods'].includes(state.screen);
  nav.style.display = showNav ? 'flex' : 'none';
  nav.innerHTML = `
    <button class="nav-btn ${state.screen === 'home' || state.screen === 'progress' ? 'active' : ''}" onclick="goHome()">${icon('home', 20)}<span>HOME</span></button>
    <button class="nav-btn ${state.screen === 'history' ? 'active' : ''}" onclick="goHistory()">${icon('history', 20)}<span>HISTORY</span></button>
    <button class="nav-btn ${state.screen === 'settings' || state.screen === 'advancedSettings' || state.screen === 'customMods' ? 'active' : ''}" onclick="goSettings()">${icon('settings', 20)}<span>SETTINGS</span></button>`;
}

// ---------- UI tap feedback ----------
// One delegated listener covers every button in the app (including ones
// rendered later), instead of wiring a sound call into each individual
// onclick — simpler to keep in sync as screens change.
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('button')) playTapSound();
}, true);

// Escape closes whichever overlay is open (confirm dialog takes priority over the drawer).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.importOpen) closeImport();
  else if (state.timeEdit) closeTimeEdit();
  else if (state.editEx && !state.confirmAction) closeEdit();
  else if (state.confirmAction) cancelConfirmAction();
  else if (state.drawerOpen) toggleDrawer();
});

// Coming back to the app: re-acquire the screen lock and re-sync the running countdown at once.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const live = ['ready', 'warmup'].includes(state.screen) ||
    (state.screen === 'active' && (state.subState === 'timer' || state.subState === 'rest'));
  if (!live) return;
  requestWakeLockIfEnabled();
  if (state.timer.endsAt && !state.paused) {
    state.timer.remaining = Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
    render();
  }
});

// ---------- Training Progress screen ----------
function streakNote(st) {
  if (st.state === 'recorded-today') return 'RECORDED TODAY';
  if (st.state === 'today-pending') return 'TODAY NOT RECORDED YET';
  return st.hasRecords ? 'NO CURRENT STREAK' : 'TRAIN TO START';
}
function streakCardHtml(st, clickable) {
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable ? ' onclick="goProgress()" aria-label="Open training progress"' : '';
  const breakdown = st.current > 0 ? `<div class="streak-sub">${st.currentTraining} WORKOUT \u00b7 ${st.currentRest} REST</div>` : '';
  const lv = st.lastVerified
    ? `<div class="streak-last">LAST VERIFIED STREAK \u00b7 ${st.lastVerified.days} ${st.lastVerified.days === 1 ? 'DAY' : 'DAYS'} \u00b7 ENDED ${st.lastVerified.end}</div>` : '';
  return `<${tag} class="streak-card${clickable ? ' is-link' : ''}"${attrs}>
    <div class="streak-flame-chip">${icon('flame', 24)}</div>
    <div class="streak-info">
      <div class="streak-label">CURRENT STREAK</div>
      <div class="streak-value">${st.current} ${st.current === 1 ? 'DAY' : 'DAYS'}</div>
      ${breakdown}
      <div class="streak-sub">${streakNote(st)}</div>
      ${lv}
    </div>
    <div class="streak-best"><span>BEST</span><b>${st.best}</b></div>
    ${clickable ? `<span class="streak-go">${icon('chevronLeft', 16, 'icon-flip')}</span>` : ''}
  </${tag}>`;
}
function goProgress() {
  const today = localDateStr();
  state.progress = state.progress || { metric: 'duration', range: 'daily', exportRange: 'month' };
  state.progress.month = monthKey(today);
  state.progress.selected = today;
  state.progress.bar = null;
  state.screen = 'progress';
  render();
}
function earliestMonthKey(idx, today) {
  const ds = Object.keys(idx).filter((d) => d <= today).sort();
  return ds.length ? monthKey(ds[0]) : monthKey(today);
}
function progressMonth(delta) {
  const p = state.progress, today = localDateStr();
  const next = shiftMonthKey(p.month, delta);
  if (delta > 0 && next > monthKey(today)) return;
  if (delta < 0 && next < earliestMonthKey(buildDayIndex(), today)) return;
  p.month = next; p.selected = null; p.bar = null;
  render();
}
function selectProgressDay(ds) { if (ds > localDateStr()) return; state.progress.selected = ds; render(); }
function setProgressMetric(m) { state.progress.metric = m; state.progress.bar = null; render(); }
function setProgressRange(r) { state.progress.range = r; state.progress.bar = null; render(); }
function selectProgressBar(i) { state.progress.bar = (state.progress.bar === i) ? null : i; render(); }
function setExportRange(r) { state.progress.exportRange = r; render(); }

const METRICS = {
  duration: { label: 'DURATION', unit: 'min' },
  sessions: { label: 'SESSIONS', unit: 'sessions' },
  sets: { label: 'SETS', unit: 'sets' },
  reps: { label: 'REPS', unit: 'reps' },
};
// One day's value for a metric. 'zero' is a TRUE recorded zero (explicit rest day); 'na' = workout recorded but
// this metric isn't available for it; 'unknown' = no record at all. Only 'value' and 'zero' are ever plotted as numbers.
function dayMetric(d, metric) {
  if (!d) return { k: 'unknown' };
  if (d.status === 'R') return { k: 'zero' };
  const w = d.workouts;
  if (metric === 'sessions') return { k: 'value', v: w.length };
  let v = 0, known = 0;
  w.forEach((h) => {
    let x = null;
    if (metric === 'sets') x = entrySets(h);
    else if (metric === 'duration') { const du = entryDuration(h); x = du.sec === null ? null : du.sec / 60; }
    else if (metric === 'reps') { const r = entryReps(h); x = r ? r.total : null; }
    if (x !== null) { v += x; known++; }
  });
  return known ? { k: 'value', v, partial: known < w.length } : { k: 'na' };
}
function aggregate(idx, dates, metric) {
  let sum = 0, vals = 0, zeros = 0, nas = 0, recorded = 0, partial = false;
  dates.forEach((ds) => {
    const d = idx[ds];
    if (d) recorded++;
    const m = dayMetric(d, metric);
    if (m.k === 'value') { sum += m.v; vals++; if (m.partial) partial = true; }
    else if (m.k === 'zero') zeros++;
    else if (m.k === 'na') nas++;
  });
  const kind = vals ? 'value' : (nas ? 'na' : (zeros ? 'zero' : 'unknown'));
  return { kind, v: sum, recorded, total: dates.length, partial: partial || (vals > 0 && nas > 0) };
}
function buildBars(idx, p, today) {
  const bars = [];
  if (p.range === 'daily') {
    const parts = p.month.split('-').map(Number);
    for (let i = 1; i <= daysInMonth(parts[0], parts[1]); i++) {
      const ds = p.month + '-' + String(i).padStart(2, '0');
      bars.push({ label: String(i), full: ds, agg: ds > today ? { kind: 'future' } : aggregate(idx, [ds], p.metric), period: 'day' });
    }
  } else if (p.range === 'weekly') {
    const thisWeek = weekStartStr(today);
    for (let i = 11; i >= 0; i--) {
      const start = addDaysStr(thisWeek, -7 * i);
      const dates = [];
      for (let k = 0; k < 7; k++) { const ds = addDaysStr(start, k); if (ds <= today) dates.push(ds); }
      bars.push({ label: (+start.slice(5, 7)) + '/' + (+start.slice(8)), full: 'WEEK ' + start + ' to ' + addDaysStr(start, 6), agg: aggregate(idx, dates, p.metric), period: 'week' });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const key = shiftMonthKey(monthKey(today), -i);
      const parts = key.split('-').map(Number);
      const dates = [];
      for (let d = 1; d <= daysInMonth(parts[0], parts[1]); d++) { const ds = key + '-' + String(d).padStart(2, '0'); if (ds <= today) dates.push(ds); }
      bars.push({ label: MONTH_NAMES[parts[1] - 1], full: MONTH_NAMES[parts[1] - 1] + ' ' + parts[0], agg: aggregate(idx, dates, p.metric), period: 'month' });
    }
  }
  return bars;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const pw = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pw;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pw;
}
function fmtVal(metric, v) { return metric === 'duration' ? Math.round(v) + ' min' : String(Math.round(v * 10) / 10); }
function renderChart(bars, p) {
  const W = 320, H = 150, L = 32, R = 6, T = 10, B = 22;
  const iw = W - L - R, ih = H - T - B, base = T + ih;
  const maxV = bars.reduce((m, b) => Math.max(m, b.agg.kind === 'value' ? b.agg.v : 0), 0);
  const top = niceMax(maxV);
  const bw = iw / bars.length;
  const gap = Math.min(4, bw * 0.22);
  const yOf = (v) => T + ih - (v / top) * ih;
  let g = `<line x1="${L}" y1="${base}" x2="${W - R}" y2="${base}" class="ch-axis"/>`;
  g += `<line x1="${L}" y1="${T}" x2="${W - R}" y2="${T}" class="ch-grid"/>`;
  g += `<text x="${L - 4}" y="${T + 3}" text-anchor="end">${fmtVal(p.metric, top).replace(' min', '')}</text><text x="${L - 4}" y="${base + 3}" text-anchor="end">0</text>`;
  bars.forEach((b, i) => {
    const x = L + i * bw, cx = x + bw / 2, a = b.agg;
    if (a.kind === 'value') {
      const y = yOf(a.v);
      g += `<rect x="${(x + gap / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - gap).toFixed(1)}" height="${Math.max(1.5, base - y).toFixed(1)}" rx="1.5" class="ch-bar${a.partial ? ' partial' : ''}"/>`;
    } else if (a.kind === 'zero') {
      g += `<rect x="${(x + gap / 2).toFixed(1)}" y="${base - 2.5}" width="${(bw - gap).toFixed(1)}" height="2.5" class="ch-rest"/>`;
    } else if (a.kind === 'na') {
      g += `<circle cx="${cx.toFixed(1)}" cy="${base - 4}" r="2.3" class="ch-na"/>`;
    }
    if (p.bar === i) g += `<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" class="ch-sel"/>`;
    const showLabel = p.range === 'daily' ? (i === 0 || (i + 1) % 5 === 0) : true;
    if (showLabel) g += `<text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${b.label}</text>`;
    if (a.kind !== 'future') g += `<rect x="${x.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih + B - 6}" class="ch-hit" onclick="selectProgressBar(${i})"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">${g}</svg>`;
}
function barCaption(bars, p) {
  if (p.bar === null || !bars[p.bar]) return 'Tap a bar to see its exact value.';
  const b = bars[p.bar], a = b.agg, m = METRICS[p.metric], cov = (b.period === 'day') ? '' : ` \u00b7 ${a.recorded} of ${a.total} days have a record`;
  if (a.kind === 'unknown') return `${b.full}: no record. Unknown, not counted as zero.`;
  if (a.kind === 'zero') return `${b.full}: planned rest recorded. 0 ${m.unit} (recorded zero)${cov}`;
  if (a.kind === 'na') return `${b.full}: workout recorded, but ${m.label.toLowerCase()} data is not available for it${cov}`;
  return `${b.full}: ${fmtVal(p.metric, a.v)}${p.metric === 'duration' ? '' : ' ' + m.unit}${a.partial ? ' (partial: some sessions lack this data)' : ''}${cov}`;
}
function renderDayDetail(idx, ds, today) {
  if (!ds) return `<div class="p-card"><div class="p-title">DAY DETAILS</div><div class="p-note">Tap a date to see what was recorded.</div></div>`;
  const d = idx[ds];
  const title = DOW_FULL[parseDateStr(ds).getDay()] + ' ' + ds;
  if (!d) return `<div class="p-card"><div class="p-title">${title}</div><div class="day-row"><b>NO RELIABLE RECORD</b><span>The app has no activity record for this date. That does not mean you did not train.</span></div></div>`;
  let h = `<div class="p-card"><div class="p-title">${title}</div>`;
  d.workouts.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).forEach((e) => {
    const label = EXERCISE_DB[e.type] ? EXERCISE_DB[e.type].label : esc(e.type);
    const du = entryDuration(e);
    const durTxt = du.kind === 'unavailable' ? 'duration not recorded' : du.kind === 'excluded' ? 'duration excluded (older record over 3 h)' : fmtDuration(du.sec) + (du.kind === 'legacy' ? ' (older record)' : '');
    const sets = entrySets(e), planned = entryPlannedSets(e);
    const setsTxt = sets === null ? 'sets not recorded' : (planned !== null ? sets + '/' + planned + ' sets' : sets + ' sets');
    const rp = entryReps(e);
    const t = isNum(e.startedAt) ? new Date(e.startedAt) : null;
    const time = t ? String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ' \u00b7 ' : '';
    h += `<div class="day-row"><b>${label}</b><span>${time}${durTxt} \u00b7 ${setsTxt} \u00b7 ${rp ? rp.total + ' reps logged' : 'rep data not available'}</span></div>`;
  });
  if (d.rests) h += `<div class="day-row"><b>PLANNED REST DAY</b><span>${d.workouts.length ? 'Also recorded on this date.' : 'Explicitly recorded.'}</span></div>`;
  h += `<button class="swap-btn open-history" onclick="goHistoryDate('${ds}')">${icon('history', 12)}<span>OPEN IN HISTORY</span></button>`;
  return h + '</div>';
}
function chartNotes(bars, m) {
  const kinds = bars.map((b) => b.agg.kind);
  let n = '';
  if (!kinds.some((k) => k === 'value' || k === 'zero' || k === 'na')) n += '<div class="p-note">No recorded activity in this period yet. Empty means unknown, not zero.</div>';
  if (kinds.includes('na')) n += `<div class="p-note">\u25cb marks a workout that has no ${m.label.toLowerCase()} data (older or condensed records, or only time-based sets).</div>`;
  if (bars.some((b) => b.agg.partial)) n += '<div class="p-note">Lighter bars only include the sessions that have this data.</div>';
  return n;
}
function renderProgress() {
  const p = state.progress, today = localDateStr();
  const idx = buildDayIndex(), st = computeStreak(today, idx);
  const parts = p.month.split('-').map(Number);
  const canPrev = p.month > earliestMonthKey(idx, today), canNext = p.month < monthKey(today);
  let h = '<div class="screen progress-screen">';
  h += `<button class="back-btn" onclick="goHome()" aria-label="Back">${icon('chevronLeft', 18)}</button><h2>PROGRESS</h2>`;
  h += streakCardHtml(st, false);
  h += `<div class="p-note streak-rules">Streak = consecutive days with a recorded workout or planned rest day, including at least one workout. A day with no record breaks verification.${st.bestInfo ? ' Best: ' + st.bestInfo.days + ' days (' + st.bestInfo.start + ' to ' + st.bestInfo.end + ').' : ''}</div>`;
  // calendar
  h += `<div class="p-card"><div class="cal-head">
    <button class="order-btn" ${canPrev ? '' : 'disabled'} onclick="progressMonth(-1)" aria-label="Previous month">${icon('chevronLeft', 14)}</button>
    <span class="cal-title">${MONTH_NAMES[parts[1] - 1]} ${parts[0]}</span>
    <button class="order-btn" ${canNext ? '' : 'disabled'} onclick="progressMonth(1)" aria-label="Next month">${icon('chevronLeft', 14, 'icon-flip')}</button>
  </div><div class="cal-grid">`;
  DOW_LABELS.forEach((l) => { h += `<span class="cal-dow">${l}</span>`; });
  for (let i = 0; i < weekdayOffset(p.month + '-01'); i++) h += '<span class="cal-blank"></span>';
  for (let i = 1; i <= daysInMonth(parts[0], parts[1]); i++) {
    const ds = p.month + '-' + String(i).padStart(2, '0');
    const s = idx[ds] ? idx[ds].status : 'U';
    const dot = s === 'T' ? 'dot-train' : (s === 'R' ? 'dot-rest' : '');
    const lbl = ds + (s === 'T' ? ', workout recorded' : s === 'R' ? ', planned rest recorded' : ', no record');
    h += `<button class="cal-cell${ds === today ? ' is-today' : ''}${p.selected === ds ? ' is-selected' : ''}" ${ds > today ? 'disabled' : ''} onclick="selectProgressDay('${ds}')" aria-label="${lbl}"><span>${i}</span><i class="dot ${dot}"></i></button>`;
  }
  h += `</div><div class="cal-legend"><span><i class="dot dot-train"></i>WORKOUT</span><span><i class="dot dot-rest"></i>PLANNED REST</span><span><i class="dot dot-empty"></i>NO RECORD</span></div></div>`;
  h += renderDayDetail(idx, p.selected, today);
  // chart
  const bars = buildBars(idx, p, today), m = METRICS[p.metric];
  const rangeLabel = p.range === 'daily' ? 'DAILY \u00b7 ' + MONTH_NAMES[parts[1] - 1] + ' ' + parts[0] : (p.range === 'weekly' ? 'WEEKLY \u00b7 LAST 12 WEEKS' : 'MONTHLY \u00b7 LAST 12 MONTHS');
  h += `<div class="p-card"><div class="p-title">${m.label} \u00b7 ${m.unit.toUpperCase()} \u00b7 ${rangeLabel}</div>
    <div class="segmented wide">${Object.keys(METRICS).map((k) => `<button class="seg ${p.metric === k ? 'active' : ''}" onclick="setProgressMetric('${k}')">${METRICS[k].label}</button>`).join('')}</div>
    <div class="segmented wide">${[['daily', 'DAILY'], ['weekly', 'WEEKLY'], ['monthly', 'MONTHLY']].map((r) => `<button class="seg ${p.range === r[0] ? 'active' : ''}" onclick="setProgressRange('${r[0]}')">${r[1]}</button>`).join('')}</div>
    ${renderChart(bars, p)}
    <div class="p-note">${barCaption(bars, p)}</div>
    <div class="chart-legend"><span><i class="lg lg-bar"></i>recorded</span><span><i class="lg lg-rest"></i>rest (recorded 0)</span><span><i class="lg lg-na"></i>workout, no data</span><span>blank = unknown</span></div>
    ${chartNotes(bars, m)}
    <div class="p-note">Totals use recorded days only. Weeks start on Saturday.</div></div>`;
  // export
  h += `<div class="p-card"><div class="p-title">COPY TRAINING LOG</div>
    <div class="segmented wide">${[['month', 'MONTH'], ['30', '30 DAYS'], ['90', '90 DAYS'], ['all', 'ALL']].map((r) => `<button class="seg ${p.exportRange === r[0] ? 'active' : ''}" onclick="setExportRange('${r[0]}')">${r[1]}</button>`).join('')}</div>
    <button class="action-card wide" onclick="copyProgressExport()"><span class="action-icon">${icon('copy', 14)}</span><span class="action-label">COPY FOR AI ANALYSIS</span></button>
    <div class="p-note">Copies plain text only. Nothing is sent anywhere.</div></div>`;
  return h + '</div>';
}

// ---- Period export (plain text, meant to be pasted into an external AI) ----
function exportRangeDates(key, idx, today) {
  let start;
  if (key === 'month') start = monthKey(today) + '-01';
  else if (key === '30') start = addDaysStr(today, -29);
  else if (key === '90') start = addDaysStr(today, -89);
  else { const ks = Object.keys(idx).filter((d) => d <= today).sort(); start = ks[0] || today; }
  return { start, end: today, days: Math.round((parseDateStr(today) - parseDateStr(start)) / 86400000) + 1 };
}
function buildProgressExport(key) {
  const today = localDateStr();
  const hist = validHistory(), idx = buildDayIndex(hist);
  const range = exportRangeDates(key, idx, today);
  const st = computeStreak(today, idx);
  const hh = (ms) => { const t = new Date(ms); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
  const L = [];
  L.push('WORKOUT TRAINING LOG');
  L.push('Period: ' + range.start + ' to ' + range.end + ' (' + range.days + ' days) | Generated: ' + today + ' | Local device dates; weeks start on Saturday');
  L.push('', 'DEFINITIONS');
  L.push('- WORKOUT day: at least one completed workout is recorded for that date.');
  L.push('- REST day: a planned rest day explicitly recorded in the app. Rest days are never inferred.');
  L.push('- UNKNOWN day: no reliable record. It is NOT assumed to be a missed workout, a rest day or a training day.');
  L.push('- Streak: consecutive calendar days that are each WORKOUT or REST and include at least one WORKOUT day. An UNKNOWN day breaks verification of continuity. Several sessions on one date count as one day. Length counts calendar days (rest days included); rest days do not add to the workout-day count.');
  L.push('- Current streak: the most recent such sequence, only if it ends today or yesterday (yesterday = today is simply not recorded yet). Otherwise there is no current streak and the older sequence is reported as the last verified streak.');
  L.push('- Best streak: the longest such sequence in all stored history.');
  L.push('', 'STREAK');
  if (st.current > 0) L.push('Current streak: ' + st.current + ' days (' + st.currentTraining + ' workout day(s) + ' + st.currentRest + ' rest day(s)), ' + st.currentStart + ' to ' + st.currentEnd + (st.state === 'today-pending' ? ' (today not recorded yet)' : ''));
  else L.push('Current streak: none (no verified sequence ending today or yesterday)');
  if (st.lastVerified) L.push('Last verified streak: ' + st.lastVerified.days + ' days (' + st.lastVerified.training + ' workout + ' + st.lastVerified.rest + ' rest), ' + st.lastVerified.start + ' to ' + st.lastVerified.end + '. Continuity cannot be verified after ' + st.lastVerified.end + ' (no record for the following day).');
  L.push(st.bestInfo ? 'Best streak: ' + st.bestInfo.days + ' days (' + st.bestInfo.training + ' workout + ' + st.bestInfo.rest + ' rest), ' + st.bestInfo.start + ' to ' + st.bestInfo.end : 'Best streak: none');
  L.push('', 'DAILY LOG (oldest first)');
  let unkStart = null, unkCount = 0;
  const flush = () => {
    if (!unkCount) return;
    L.push(unkCount === 1 ? unkStart + ' | UNKNOWN (no record)' : unkStart + ' .. ' + addDaysStr(unkStart, unkCount - 1) + ' | UNKNOWN (' + unkCount + ' days, no record)');
    unkStart = null; unkCount = 0;
  };
  const T = { workoutDays: 0, restDays: 0, unknownDays: 0, sessions: 0, sets: 0, setsPlanned: 0, setsSessions: 0, setsMissing: 0,
    durSec: 0, durSessions: 0, durExcluded: [], durMissing: 0, reps: 0, repsSessions: 0, repsMissing: 0, condensed: 0 };
  for (let ds = range.start; ds <= range.end; ds = addDaysStr(ds, 1)) {
    const d = idx[ds];
    if (!d) { if (!unkCount) unkStart = ds; unkCount++; T.unknownDays++; continue; }
    flush();
    if (d.status === 'R') { T.restDays++; L.push(ds + ' | REST (planned, explicitly recorded)'); continue; }
    T.workoutDays++;
    const list = d.workouts.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    list.forEach((e, i) => {
      T.sessions++;
      const label = EXERCISE_DB[e.type] ? EXERCISE_DB[e.type].label : String(e.type);
      const du = entryDuration(e);
      let durTxt;
      if (du.kind === 'unavailable') { durTxt = 'not recorded'; T.durMissing++; }
      else if (du.kind === 'excluded') { durTxt = 'excluded (older record of ' + Math.round(du.raw / 60) + ' min is over the 3 h limit)'; T.durExcluded.push(ds); }
      else { T.durSec += du.sec; T.durSessions++; durTxt = Math.round(du.sec / 60) + ' min' + (du.kind === 'legacy' ? ' (older record; may include time the app was closed)' : ''); }
      const sets = entrySets(e), planned = entryPlannedSets(e);
      let setsTxt = 'not recorded';
      if (sets === null) T.setsMissing++; else { T.sets += sets; T.setsSessions++; if (planned !== null) T.setsPlanned += planned; setsTxt = sets + (planned !== null ? '/' + planned : '') + ' completed'; }
      const rp = entryReps(e);
      let repsTxt = 'not available';
      if (rp) { T.reps += rp.total; T.repsSessions++; repsTxt = rp.total + ' (' + rp.sets + ' REPS/MAX sets; time-based sets excluded)'; } else T.repsMissing++;
      if (e.condensed) T.condensed++;
      L.push(ds + ' | WORKOUT' + (list.length > 1 ? ' (session ' + (i + 1) + ' of ' + list.length + ')' : '') + ' | ' + label + ' | start ' + (isNum(e.startedAt) ? hh(e.startedAt) : 'n/a') + ' | duration ' + durTxt + ' | sets ' + setsTxt + ' | reps ' + repsTxt + (e.condensed ? ' | per-exercise details removed (older record); totals kept' : ''));
      if (e.details && Array.isArray(e.details.exercises) && Array.isArray(e.details.results)) {
        e.details.exercises.forEach((ex, xi) => {
          if (!ex || typeof ex !== 'object') return;
          const rs = e.details.results.filter((r) => r && r.exercise === xi);
          if (!rs.length) return;
          L.push('    ' + String(ex.name) + ' (' + targetLabel(ex) + '): ' + rs.map((r) => 's' + r.set + ' ' + (r.status === 'skipped' ? 'skipped' : (!isNum(r.actual) || ex.type === 'TIME' ? 'done' : r.actual + ' reps'))).join(', '));
        });
      }
    });
    if (d.rests) L.push('  (a planned rest day is also recorded for this date)');
  }
  flush();
  L.push('', 'TOTALS FOR THE PERIOD (recorded data only)');
  L.push('Workout days: ' + T.workoutDays + ' | Rest days (recorded): ' + T.restDays + ' | Unknown days: ' + T.unknownDays);
  L.push('Sessions completed: ' + T.sessions);
  L.push('Sets completed: ' + T.sets + (T.setsPlanned ? ' (of ' + T.setsPlanned + ' planned, for the ' + T.setsSessions + ' sessions with set data)' : ''));
  L.push('Training duration: ' + (T.durSessions ? Math.round(T.durSec / 60) + ' min over ' + T.durSessions + ' session(s) with a reliable duration' : 'not available'));
  L.push('Reps logged: ' + (T.repsSessions ? T.reps + ' over ' + T.repsSessions + ' session(s) with rep data (REPS/MAX sets only; different exercises are summed, not compared)' : 'not available'));
  L.push('', 'LIMITATIONS');
  if (T.durExcluded.length) L.push('- ' + T.durExcluded.length + ' older session(s) excluded from the duration total because the recorded duration exceeded 3 h (likely includes time the app was closed): ' + T.durExcluded.join(', ') + '. They are still counted as sessions and sets.');
  if (T.durMissing) L.push('- ' + T.durMissing + ' session(s) have no recorded duration.');
  if (T.setsMissing) L.push('- ' + T.setsMissing + ' session(s) have no set count.');
  if (T.repsMissing) L.push('- ' + T.repsMissing + ' of ' + T.sessions + ' session(s) have no rep data (older records, or only time-based sets).');
  if (T.condensed) L.push('- ' + T.condensed + ' older session(s) had their per-exercise details removed to save space; the totals that could be calculated (sets, duration, reps) were kept.');
  L.push('- Older records are dated by the day the workout finished; newer ones by the day it started.');
  L.push('- UNKNOWN days only mean no record exists. They are not evidence of rest or of a missed workout.');
  L.push('- Streak and totals describe recorded activity only; they say nothing about strength, fitness or physical condition.');
  if (hist.length >= HISTORY_CAP) L.push('- The app keeps at most ' + HISTORY_CAP + ' records; older ones may be missing.');
  return L.join('\n');
}
function copyProgressExport() { copyText(buildProgressExport(state.progress.exportRange), 'TRAINING LOG COPIED'); }

// ---------- Copy, toast, backup ----------
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1800);
}
async function copyText(text, okMsg) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
  } catch (e) { /* fall back below */ }
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
  }
  showToast(ok ? (okMsg || 'COPIED') : 'COPY FAILED');
  return ok;
}
function entryToText(h) {
  const label = h.type === 'REST' ? 'REST DAY' : (EXERCISE_DB[h.type] ? EXERCISE_DB[h.type].label : h.type);
  const lines = ['WorkoutApp \u2014 ' + label];
  let when = h.date;
  if (h.startedAt) {
    const t = new Date(h.startedAt);
    when += ' \u00b7 ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  if (typeof h.durationSeconds === 'number') when += ' \u00b7 ' + fmtDuration(h.durationSeconds);
  lines.push(when);
  const s = h.summary;
  if (s) {
    lines.push('', 'Completed: ' + s.completedExercises + '/' + s.totalExercises + ' exercises \u00b7 ' + s.completedSets + '/' + s.totalSetsPlanned + ' sets');
    lines.push('Skipped: ' + s.skippedExercises + ' exercises \u00b7 ' + s.skippedSets + ' sets');
  }
  const d = h.details;
  if (d && Array.isArray(d.exercises) && Array.isArray(d.results)) {
    d.exercises.forEach((e, i) => {
      if (!e || typeof e !== 'object') return;
      const rs = d.results.filter((r) => r && r.exercise === i);
      lines.push('', String(e.name) + ' (' + targetLabel(e) + ')');
      if (!rs.length) { lines.push('  not done'); return; }
      rs.forEach((r) => lines.push('  Set ' + r.set + ': ' + (r.status === 'skipped' ? 'skipped' : (isNum(r.actual) ? r.actual + ' reps' : 'done'))));
    });
  } else if (s && s.actualRepsList && s.actualRepsList.length) {
    lines.push('', ...s.actualRepsList);
  }
  return lines.join('\n');
}
function copyLastSummary() { if (state.lastEntry) copyText(entryToText(state.lastEntry), 'SUMMARY COPIED'); }
function copyHistoryEntry(i) {
  const h = Store.get('history', [])[i];
  if (h) copyText(entryToText(h), 'SUMMARY COPIED');
}

// Backup: only user data (never an in-progress workout). Import is validated and previewed BEFORE anything changes.
const BACKUP_KEYS = ['settings', 'history', 'exerciseMods', 'customExercises', 'accentTheme']; // streak/calendar are derived from history
function buildBackup() {
  const data = {};
  BACKUP_KEYS.forEach((k) => { const v = Store.get(k, undefined); if (v !== undefined && v !== null) data[k] = v; });
  return JSON.stringify({ app: 'WorkoutApp', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data });
}
function exportData() { copyText(buildBackup(), 'BACKUP COPIED'); }
function openImport() { state.importOpen = true; state.importPreview = null; state.importDraft = ''; render(); }
function closeImport() { state.importOpen = false; state.importPreview = null; render(); }
function buildImportPlan(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { error: 'INVALID BACKUP' }; }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const data = parsed && parsed.app === 'WorkoutApp' && isObj(parsed.data) ? parsed.data : null;
  if (!data) return { error: 'INVALID BACKUP' };
  const next = {}, report = { records: null, skipped: 0, settings: false, mods: null, added: null, theme: false };
  if (data.settings !== undefined) {
    if (!isObj(data.settings)) return { error: 'INVALID SETTINGS' };
    const st = {};
    ['keepAwake', 'alertSound', 'motivationCards'].forEach((k) => { if (typeof data.settings[k] === 'boolean') st[k] = data.settings[k]; });
    ADVANCED_FIELDS.forEach((f) => { if (typeof data.settings[f.key] === 'number') st[f.key] = clampSetting(f.key, data.settings[f.key]); });
    next.settings = st; report.settings = true;
  }
  if (data.history !== undefined) {
    if (!Array.isArray(data.history)) return { error: 'INVALID HISTORY' };
    const seen = new Set(), valid = [];
    data.history.forEach((h) => {
      if (!isObj(h) || !(h.type === 'REST' || EXERCISE_DB[h.type]) || !isValidDateStr(h.date) || h.status !== 'COMPLETED') return;
      const key = h.type === 'REST' ? 'R|' + h.date : (isNum(h.startedAt) ? h.type + '|' + h.startedAt : null);
      if (key) { if (seen.has(key)) return; seen.add(key); }
      valid.push(h);
    });
    if (data.history.length > 0 && valid.length === 0) return { error: 'NO VALID RECORDS' }; // never wipe history with an unusable file
    const kept = sortHistory(valid).slice(0, HISTORY_CAP);
    compactHistory(kept); // same newest-first order and condensing rule as normal saves
    next.history = kept; report.records = kept.length; report.skipped = data.history.length - valid.length;
  }
  let rawMods = data.exerciseMods;
  if (rawMods === undefined && isObj(data.exerciseSwaps)) rawMods = swapsToMods(data.exerciseSwaps); // older backups
  if (rawMods !== undefined) {
    if (!isObj(rawMods)) return { error: 'INVALID MODIFICATIONS' };
    next.exerciseMods = cleanMods(rawMods); report.mods = Object.keys(next.exerciseMods).length;
  }
  if (data.customExercises !== undefined) {
    if (!isObj(data.customExercises)) return { error: 'INVALID EXERCISES' };
    next.customExercises = cleanCustomsObject(data.customExercises);
    report.added = Object.keys(next.customExercises).reduce((n, k) => n + next.customExercises[k].length, 0);
  }
  if (ACCENT_THEMES.some((t) => t.name === data.accentTheme)) { next.accentTheme = data.accentTheme; report.theme = true; }
  if (!Object.keys(next).length) return { error: 'NOTHING TO IMPORT' };
  return { next, report };
}
function applyImport() { // step 1: validate and show a summary. Nothing is changed yet.
  const el = document.getElementById('import-input');
  const text = el && typeof el.value === 'string' ? el.value : '';
  state.importDraft = text;
  const plan = buildImportPlan(text);
  if (plan.error) { showToast(plan.error); return; }
  state.importPreview = plan;
  render();
}
function backToImportEdit() { state.importPreview = null; render(); }
function commitImport() { // step 2: the user confirmed the summary
  const p = state.importPreview;
  if (!p) return;
  Object.keys(p.next).forEach((k) => Store.set(k, p.next[k]));
  Store.set('schemaVersion', SCHEMA_VERSION);
  initAccentTheme();
  state.importOpen = false; state.importPreview = null; state.importDraft = '';
  render();
  showToast('IMPORTED' + (p.report.records !== null ? ' \u00b7 ' + p.report.records + ' RECORDS' : ''));
}
function renderImportPreview() {
  const r = state.importPreview.report, lines = [];
  if (r.records !== null) lines.push(r.records + ' workout/rest records' + (r.skipped ? ' (' + r.skipped + ' invalid or duplicate skipped)' : ''));
  if (r.settings) lines.push('Settings');
  if (r.mods !== null) lines.push(r.mods + ' saved exercise modification(s)');
  if (r.added !== null) lines.push(r.added + ' added exercise(s)');
  if (r.theme) lines.push('Accent theme');
  return `<div class="overlay"><div class="overlay-card sheet">
    <div class="overlay-icon">${icon('upload', 22)}</div>
    <div class="overlay-title">REVIEW IMPORT</div>
    <p class="confirm-body swap-body">This backup contains:</p>
    <ul class="import-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <p class="p-note">These replace the matching data currently in the app; anything not in the backup is left as it is. Export a backup first if you want to keep what you have now.</p>
    <div class="confirm-row"><button class="ghost-btn" onclick="backToImportEdit()"><span>BACK</span></button><button class="primary-btn" onclick="commitImport()"><span>REPLACE MY DATA</span></button></div>
  </div></div>`;
}

// ---------- Init ----------
// Guard against scripts that execute after DOMContentLoaded has already fired
// (e.g. when injected post-parse) by rendering immediately in that case.
function init() { migrateData(); initAccentTheme(); render(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

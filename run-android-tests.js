// Tests for the Android packaging layer (everything except the real Gradle build, which only runs in GitHub Actions).
//   node run-android-tests.js
// Covers: native-bridge.js (back button / lifecycle, with a fake Capacitor), build-www.js (offline www/, bundled fonts),
// patch-android.js (against a MOCK of the generated Android project - the real one only exists inside CI),
// make-icons.py, capacitor/package config, and the safety rules of the three GitHub workflows.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const ROOT = __dirname;
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) { if (cond) pass++; else { fail++; failures.push(name + (extra !== undefined ? ' -> ' + extra : '')); } console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' -> ' + extra : '')); }
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
function sh(cmd, args, opts) { const r = cp.spawnSync(cmd, args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {})); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

// ---------------------------------------------------------------- 1. native bridge
console.log('\n== 1. NATIVE BRIDGE (Android back button, resume) ==');
function make(opts) {
  opts = opts || {};
  const clock = { t: new Date('2026-10-20T12:00:00').getTime() }, RD = Date, store = {};
  class FD extends RD { constructor(...a) { a.length ? super(...a) : super(clock.t); } static now() { return clock.t; } }
  const roots = {}, toasts = [], events = [], listeners = {}, fields = {}; let exited = 0;
  const mk = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {} }, _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = v; }, addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {}, firstElementChild: null, querySelector: () => null, focus() {}, select() {} });
  const doc = { visibilityState: 'visible', body: { appendChild: (el) => toasts.push(el.textContent) }, getElementById: (id) => fields[id] || (roots[id] = roots[id] || mk()), querySelector: mk, querySelectorAll: () => [], createElement: () => Object.assign(mk(), { className: '', textContent: '', value: '' }), addEventListener() {}, dispatchEvent: (e) => { events.push(e.type); return true; }, documentElement: mk(), readyState: 'complete' };
  const c = { console, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, Date: FD, Math, Event: function (t) { this.type = t; }, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, document: doc, navigator: {}, addEventListener() {}, requestAnimationFrame() {}, AudioContext: function () {} };
  c.window = c; c.toasts = toasts; c.events = events; c.listeners = listeners; c.store = store; c.advance = (ms) => { clock.t += ms; }; c.exitCount = () => exited;
  if (opts.capacitor !== false) c.Capacitor = { isNativePlatform: () => opts.native !== false, Plugins: { App: { addListener(ev, fn) { listeners[ev] = fn; return Promise.resolve({ remove() {} }); }, exitApp() { exited++; } } } };
  vm.createContext(c);
  for (const f of ['icons.js', 'data.js', 'app.js', 'native-bridge.js']) vm.runInContext(read(f), c, { filename: f });
  return c;
}
const run = (c, s) => vm.runInContext(s, c);
const back = (c) => c.listeners.backButton();
const scr = (c) => run(c, 'state.screen');
const START_CALL = "selectSession('PUSH_A');startWorkoutFlow()";
let c = make({ native: false });
ok('plain browser: bridge does nothing (no listeners registered, no errors)', Object.keys(c.listeners).length === 0 && c.window.__waNativeBridge === undefined);
noThrow('no Capacitor object at all: bridge stays quiet', () => make({ capacitor: false }));
function noThrow(name, fn) { let e = null; try { fn(); } catch (x) { e = x.message; } ok(name, !e, e); }
c = make();
ok('native: back button and resume listeners are attached', typeof c.listeners.backButton === 'function' && typeof c.listeners.appStateChange === 'function' && typeof c.window.__waNativeBridge.handleBack === 'function');
ok('native: the leave-workout dialog is registered on the app\'s own confirm system', run(c, "CONFIRM_TEXT.leaveWorkout.fn") === 'confirmLeaveWorkout' && typeof c.window.confirmLeaveWorkout === 'function');
back(c); ok('Home: first Back shows a hint and does NOT exit', c.toasts.includes('PRESS BACK AGAIN TO EXIT') && c.exitCount() === 0);
c.advance(500); back(c); ok('Home: second Back within 2 s exits the app', c.exitCount() === 1);
c = make(); back(c); c.advance(3500); back(c); ok('Home: a second Back after 2 s only shows the hint again', c.exitCount() === 0 && c.toasts.length === 2);
const ENTER = { history: 'goHistory()', settings: 'goSettings()', progress: 'goProgress()', advancedSettings: 'goAdvancedSettings()', customMods: 'goCustomMods()' }; // the app's own navigation functions
for (const s of ['history', 'settings', 'progress']) { c = make(); run(c, ENTER[s]); back(c); ok(s + ': Back returns to Home', scr(c) === 'home' && c.exitCount() === 0); }
for (const s of ['advancedSettings', 'customMods']) { c = make(); run(c, ENTER[s]); back(c); ok(s + ': Back returns to Settings', scr(c) === 'settings'); }
c = make(); run(c, "selectSession('PUSH_A')"); back(c); ok('Setup: Back returns to Home', scr(c) === 'home');
c = make(); run(c, "selectSession('PUSH_A');state.screen='complete';state.lastSummary={}"); back(c); ok('Complete: Back returns to Home', scr(c) === 'home');
// overlays close before anything else happens
c = make(); run(c, "selectSession('PUSH_A');openEdit(0)"); back(c); ok('Edit sheet: Back closes it and stays on Setup', run(c, 'state.editEx') === null && scr(c) === 'setup');
c = make(); run(c, "selectSession('PUSH_A');openEdit(0);state.confirmAction={kind:'resetExercise',sessionKey:'PUSH_A',exId:'PUSH_A|Push-ups'}"); back(c); ok('Confirm dialog over the sheet: Back closes only the dialog', run(c, 'state.confirmAction') === null && run(c, 'state.editEx') !== null);
c = make(); run(c, "state.screen='settings';state.importOpen=true;state.importPreview={next:{},report:{}}"); back(c); ok('Import preview: Back returns to the paste step', run(c, 'state.importPreview') === null && run(c, 'state.importOpen') === true);
back(c); ok('Import dialog: Back closes it', run(c, 'state.importOpen') === false && scr(c) === 'settings');
c = make(); run(c, "selectSession('PUSH_A');startWorkoutFlow();beginWarmupStep();togglePause()"); const pausedOk = run(c, 'state.paused') === true && scr(c) === 'warmup'; back(c); ok('Pause overlay: Back resumes the workout (does not leave it)', pausedOk && run(c, 'state.paused') === false && scr(c) === 'warmup' && run(c, 'state.confirmAction') === null);
c = make(); run(c, "selectSession('PUSH_A');startWorkoutFlow();beginWarmupStep();openTimeEdit()"); const teOpen = run(c, 'state.timeEdit') !== null; back(c); ok('Custom-time dialog: Back closes it', teOpen && run(c, 'state.timeEdit') === null && scr(c) === 'warmup');
c = make(); run(c, "selectSession('PUSH_A');startWorkoutFlow();beginActiveWorkout();toggleDrawer()"); const drOpen = run(c, 'state.drawerOpen') === true; back(c); ok('Workout drawer: Back closes it', drOpen && run(c, 'state.drawerOpen') === false && scr(c) === 'active');
// active workout: confirmation before leaving, session stays resumable
c = make(); run(c, "selectSession('PUSH_A');startWorkoutFlow()"); const startedScreen = scr(c);
back(c); ok('Workout (' + startedScreen + '): Back asks for confirmation instead of leaving', run(c, 'state.confirmAction.kind') === 'leaveWorkout' && run(c, 'renderConfirmOverlay(state.confirmAction)').includes('LEAVE WORKOUT?') && scr(c) === startedScreen && c.exitCount() === 0);
back(c); ok('Back again cancels the dialog and stays in the workout', run(c, 'state.confirmAction') === null && scr(c) === startedScreen);
back(c); run(c, 'confirmLeaveWorkout()');
ok('Confirming LEAVE returns Home; the workout can be resumed from there', scr(c) === 'home' && run(c, "!!Store.get('activeSession', null)") && run(c, 'renderHome()').includes('RESUME'));
const WORKOUT_STATES = { 'ready': START_CALL, 'warmup': START_CALL + ';beginWarmupStep()', 'active/idle': START_CALL + ';beginActiveWorkout()', 'active/timer': START_CALL + ';beginActiveWorkout();beginSetTimer()', 'active/rest': START_CALL + ';beginActiveWorkout();beginRest()', 'active/repsInput': START_CALL + ';beginActiveWorkout();goToRepsInput()' };
for (const name of Object.keys(WORKOUT_STATES)) {
  c = make(); run(c, WORKOUT_STATES[name]); const reached = run(c, "state.screen + '/' + state.subState"); back(c);
  ok('Workout screen ' + name + ' (' + reached + '): Back asks before leaving, nothing is lost', run(c, 'state.confirmAction && state.confirmAction.kind') === 'leaveWorkout' && c.exitCount() === 0 && run(c, "!!Store.get('activeSession', null)") !== undefined);
}
c = make(); c.listeners.appStateChange({ isActive: true }); ok('Coming back to the app re-triggers the app\'s resume logic (visibilitychange)', c.events.includes('visibilitychange'));
c.events.length = 0; c.listeners.appStateChange({ isActive: false }); ok('Going to the background triggers nothing (state is saved continuously)', c.events.length === 0);

// ---------------------------------------------------------------- 2. www build
console.log('\n== 2. WWW BUILD (offline assets, bundled fonts) ==');
const out1 = path.join(tmp(), 'www'); let r = sh('node', ['build-www.js', '--out', out1, '--allow-missing-fonts']);
ok('build-www (lenient) succeeds without node_modules', r.code === 0, r.out.slice(-200));
const idx = fs.existsSync(path.join(out1, 'index.html')) ? fs.readFileSync(path.join(out1, 'index.html'), 'utf8') : '';
ok('index.html: Google Fonts links removed, local fonts.css added before style.css', !/googleapis|gstatic/.test(idx) && idx.indexOf('fonts.css') > -1 && idx.indexOf('fonts.css') < idx.indexOf('style.css'));
ok('index.html: bridge script injected after app.js and Capacitor runtime, other scripts untouched', /<script src="app\.js"><\/script>\s*(?:<script src="capacitor\.js"><\/script>\s*)?<script src="native-bridge\.js"><\/script>/.test(idx) && /icons\.js[\s\S]*data\.js[\s\S]*app\.js/.test(idx));
ok('app.js, data.js, icons.js are byte-identical to the tested web files', ['app.js', 'data.js', 'icons.js'].every((f) => md5(path.join(out1, f)) === md5(path.join(ROOT, f))));
const css = fs.readFileSync(path.join(out1, 'style.css'), 'utf8');
ok('style.css: all safe-area rules use Capacitor\'s variables with env() as fallback', !/[^(,]\benv\(safe-area/.test(css.replace(/var\(--safe-area-inset-\w+, env\(safe-area-inset-\w+, 0px\)\)/g, '')) && (css.match(/var\(--safe-area-inset-/g) || []).length === 4);
ok('www/ needs no internet: no http(s):// in html/css, only local files', ['index.html', 'style.css', 'fonts.css'].every((f) => !/https?:\/\//.test(fs.readFileSync(path.join(out1, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))));
ok('the web sources were not modified by the build', md5(path.join(ROOT, 'style.css')) === md5(path.join(ROOT, 'style.css')) && !/fonts\.css/.test(read('index.html')) && /googleapis/.test(read('index.html')));
r = sh('node', ['build-www.js', '--out', path.join(tmp(), 'w')]); ok('strict build fails clearly when the font/runtime packages are not installed', r.code !== 0 && /npm install/.test(r.out));
// full build against a fake @fontsource + @capacitor/core tree (mirrors the published file layout)
const proj = tmp();
['index.html', 'style.css', 'app.js', 'data.js', 'icons.js', 'native-bridge.js', 'build-www.js'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(proj, f)));
function fakeFont(pkg, family, weights, subsets, skip) {
  weights.forEach((w) => {
    const dir = path.join(proj, 'node_modules', '@fontsource', pkg); fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    let cssText = '';
    ['latin-ext'].concat(subsets).forEach((s) => {
      const f = pkg + '-' + s + '-' + w + '-normal'; fs.writeFileSync(path.join(dir, 'files', f + '.woff2'), 'W2'); fs.writeFileSync(path.join(dir, 'files', f + '.woff'), 'W1');
      cssText += '/* ' + pkg + '-' + s + '-' + w + '-normal */\n@font-face {\n  font-family: \'' + family + '\';\n  font-style: normal;\n  font-display: swap;\n  font-weight: ' + w + ';\n  src: url(./files/' + f + '.woff2) format(\'woff2\'), url(./files/' + f + '.woff) format(\'woff\');\n  unicode-range: U+' + (s === 'arabic' ? '0600-06FF' : '0000-00FF') + ';\n}\n';
    });
    if (!(skip && skip === w)) fs.writeFileSync(path.join(dir, w + '.css'), cssText);
  });
}
fakeFont('sora', 'Sora', [400, 500, 600, 700, 800], ['latin']); fakeFont('cairo', 'Cairo', [600, 700, 800, 900], ['arabic', 'latin']);
fs.mkdirSync(path.join(proj, 'node_modules', '@capacitor', 'core', 'dist'), { recursive: true }); fs.writeFileSync(path.join(proj, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), '/* fake runtime */');
r = sh('node', ['build-www.js'], { cwd: proj }); ok('strict build succeeds when the packages are present', r.code === 0, r.out.slice(-300));
const www2 = path.join(proj, 'www'), fcss = fs.existsSync(path.join(www2, 'fonts.css')) ? fs.readFileSync(path.join(www2, 'fonts.css'), 'utf8') : '';
ok('fonts.css: 13 faces (Sora 5 weights, Cairo 4 weights x arabic+latin), own unicode-ranges kept, family names match style.css', (fcss.match(/@font-face/g) || []).length === 13 && /font-family: 'Cairo'[\s\S]*?U\+0600-06FF/.test(fcss) && /font-family: 'Sora'/.test(fcss) && /Sora/.test(read('style.css')) && /Cairo/.test(read('style.css') + read('app.js')));
ok('fonts.css points to local .woff2 only (no .woff fallback, no remote url), files copied', !/\.woff[^2]/.test(fcss) && (fcss.match(/url\(fonts\/[^)]+\.woff2\)/g) || []).length === 13 && fs.readdirSync(path.join(www2, 'fonts')).length === 13);
const idx2 = fs.readFileSync(path.join(www2, 'index.html'), 'utf8');
ok('with the runtime present: capacitor.js is loaded before native-bridge.js, after app.js', /app\.js"><\/script>\s*<script src="capacitor\.js"><\/script>\s*<script src="native-bridge\.js"><\/script>/.test(idx2) && fs.existsSync(path.join(www2, 'capacitor.js')));
fs.rmSync(path.join(proj, 'node_modules', '@fontsource', 'cairo', '900.css')); r = sh('node', ['build-www.js'], { cwd: proj });
ok('a missing font weight fails the build with a readable message', r.code !== 0 && /Cairo 900/.test(r.out));
// a different index.html (no Google link) still builds, with a warning
fakeFont('cairo', 'Cairo', [900], ['arabic', 'latin']); fs.writeFileSync(path.join(proj, 'index.html'), read('index.html').replace(/<link[^>]*(?:googleapis|gstatic)[^>]*>\s*/g, '')); r = sh('node', ['build-www.js'], { cwd: proj });
ok('an index.html without Google Fonts links still builds (with a warning)', r.code === 0 && /no Google Fonts links/.test(r.out));
fs.writeFileSync(path.join(proj, 'index.html'), read('index.html').replace('</head>', '<link rel="stylesheet" href="https://example.com/x.css"></head>')); r = sh('node', ['build-www.js'], { cwd: proj });
ok('anything that would still need the internet fails the build', r.code !== 0 && /example\.com/.test(r.out));

// ---------------------------------------------------------------- 3. patch-android (against a MOCK template)
console.log('\n== 3. ANDROID PATCH (mock of the generated project; the real one is created inside GitHub Actions) ==');
function mockAndroid() {
  const d = tmp(); fs.copyFileSync(path.join(ROOT, 'capacitor.config.json'), path.join(d, 'capacitor.config.json'));
  const m = path.join(d, 'android', 'app', 'src', 'main'); fs.mkdirSync(m, { recursive: true });
  fs.writeFileSync(path.join(m, 'AndroidManifest.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n\n    <application\n        android:allowBackup="true"\n        android:icon="@mipmap/ic_launcher"\n        android:label="@string/app_name"\n        android:roundIcon="@mipmap/ic_launcher_round"\n        android:supportsRtl="true"\n        android:theme="@style/AppTheme">\n\n        <activity\n            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"\n            android:name=".MainActivity"\n            android:label="@string/title_activity_main"\n            android:theme="@style/AppTheme.NoActionBarLaunch"\n            android:launchMode="singleTask"\n            android:exported="true">\n\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n\n        </activity>\n\n    </application>\n\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n');
  fs.writeFileSync(path.join(d, 'android', 'app', 'build.gradle'), "apply plugin: 'com.android.application'\n\nandroid {\n    namespace = \"com.horizon.workoutapp\"\n    compileSdk = rootProject.ext.compileSdkVersion\n    defaultConfig {\n        applicationId \"com.horizon.workoutapp\"\n        versionCode 1\n        versionName \"1.0\"\n    }\n    buildTypes {\n        release {\n            minifyEnabled false\n        }\n    }\n}\n\napply from: 'capacitor.build.gradle'\n");
  return d;
}
let mock = mockAndroid(); const patch = (dir, v) => sh('node', [path.join(ROOT, 'patch-android.js'), v], { env: Object.assign({}, process.env, { WA_PROJECT_DIR: dir }) });
r = patch(mock, 'debug'); const man = fs.readFileSync(path.join(mock, 'android/app/src/main/AndroidManifest.xml'), 'utf8'), gr = fs.readFileSync(path.join(mock, 'android/app/build.gradle'), 'utf8');
ok('patch: runs cleanly on the template layout', r.code === 0, r.out.slice(-200));
ok('manifest: MainActivity is locked to portrait; other attributes untouched', /<activity\s+android:screenOrientation="portrait"[\s\S]*?android:name="\.MainActivity"[\s\S]*?android:launchMode="singleTask"/.test(man));
ok('manifest: both labels use the ${appLabel} placeholder', (man.match(/\$\{appLabel\}/g) || []).length === 2 && !/@string\/app_name/.test(man));
ok('manifest: INTERNET permission is left as the template has it (removal needs a phone test first)', /android.permission.INTERNET/.test(man));
ok('gradle: original content kept, overrides appended once', gr.indexOf("apply from: 'capacitor.build.gradle'") > -1 && (gr.match(/>>> WorkoutApp overrides/g) || []).length === 1);
ok('gradle: debug build = id suffix .debug + label "WorkoutApp Debug" + stable debug key (env driven)', /debug \{[\s\S]*?applicationIdSuffix = '\.debug'[\s\S]*?appLabel: 'WorkoutApp Debug'[\s\S]*?signingConfigs\.wadebug/.test(gr) && /WA_DEBUG_KEYSTORE/.test(gr));
ok('gradle: release signing reads secrets from the environment only; no password is written in the file', /ANDROID_KEYSTORE_PASSWORD/.test(gr) && /System\.getenv\('ANDROID_KEY_PASSWORD'\)/.test(gr) && !/storePassword = '(?!android')/.test(gr) && /appLabel: 'WorkoutApp'\]/.test(gr));
ok('gradle: version code/name come from the build environment', /WA_VERSION_CODE/.test(gr) && /WA_VERSION_NAME/.test(gr));
const first = [man, gr]; r = patch(mock, 'release'); patch(mock, 'release');
const man2 = fs.readFileSync(path.join(mock, 'android/app/src/main/AndroidManifest.xml'), 'utf8'), gr2 = fs.readFileSync(path.join(mock, 'android/app/build.gradle'), 'utf8');
ok('patch is idempotent (run again = no duplicates in manifest or gradle)', r.code === 0 && man2 === first[0] && (gr2.match(/>>> WorkoutApp overrides/g) || []).length === 1 && gr2 === first[1]);
r = patch(tmp(), 'debug'); ok('patch: clear error when there is no Android project yet', r.code !== 0 && /cap add android/.test(r.out));
r = sh('node', ['patch-android.js', 'banana']); ok('patch: rejects an unknown build type', r.code !== 0 && /debug\|release/.test(r.out));
mock = mockAndroid(); fs.writeFileSync(path.join(mock, 'android/app/src/main/AndroidManifest.xml'), '<manifest><application></application></manifest>'); r = patch(mock, 'debug');
ok('patch: fails loudly (not silently) if the template no longer has a MainActivity', r.code !== 0 && /MainActivity/.test(r.out));

// ---------------------------------------------------------------- 4. icons
console.log('\n== 4. LAUNCHER ICONS ==');
const py = sh('python3', ['-c', 'import PIL, numpy; print("ok")']);
if (py.code !== 0) { console.log('SKIP icon tests: python3 with pillow + numpy is not installed here'); }
else {
  const res = tmp(); fs.mkdirSync(path.join(res, 'drawable-port-hdpi'), { recursive: true }); fs.mkdirSync(path.join(res, 'mipmap-hdpi'), { recursive: true });
  sh('python3', ['-c', `from PIL import Image\nImage.new('RGB',(320,480),(255,255,255)).save(r'${path.join(res, 'drawable-port-hdpi', 'splash.png')}')\nImage.new('RGB',(72,72),(9,9,9)).save(r'${path.join(res, 'mipmap-hdpi', 'ic_launcher.webp')}','WEBP')`]);
  r = sh('python3', ['make-icons.py', res, 'logo.png']); ok('make-icons runs', r.code === 0, r.out.slice(-200));
  const chk = sh('python3', ['-c', `
import os, numpy as np
from PIL import Image
res = r'${res}'
def sz(p): return Image.open(os.path.join(res, p)).size
fg = {'mdpi':108,'hdpi':162,'xhdpi':216,'xxhdpi':324,'xxxhdpi':432}; leg = {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
good = all(sz('mipmap-%s/wa_launcher_fg.png'%d)==(s,s) and sz('mipmap-%s/wa_launcher_mono.png'%d)==(s,s) for d,s in fg.items()) and all(sz('mipmap-%s/ic_launcher.png'%d)==(s,s) and sz('mipmap-%s/ic_launcher_round.png'%d)==(s,s) for d,s in leg.items())
print('SIZES', good)
f = Image.open(os.path.join(res,'mipmap-xxxhdpi/wa_launcher_fg.png')); a = np.asarray(f).astype(float)
print('ALPHA', f.mode, a[...,3].max() > 250, a[:5,:5,3].max() == 0)
solid = a[...,3] > 100; ys, xs = np.nonzero(solid)
c0 = 432/2; rad = np.sqrt((xs-c0)**2 + (ys-c0)**2).max()/432
print('RADIUS %.3f' % rad, rad <= 0.305)
print('CENTER', abs((xs.min()+xs.max())/2 - c0) < 10, abs((ys.min()+ys.max())/2 - c0) < 10)  # within ~2% of the canvas
comp = Image.new('RGB', f.size, (0,0,0)); comp.paste(f, (0,0), f); b = np.asarray(comp).astype(float)
print('NEARLY_IDENTICAL_ON_BLACK', float(np.abs(b - np.asarray(comp)).max()) == 0.0)
m = Image.open(os.path.join(res,'mipmap-xxxhdpi/wa_launcher_mono.png')); ma = np.asarray(m)
print('MONO', bool((ma[...,:3][ma[...,3] > 0] == 255).all()), int(ma[...,3].max()))
s = Image.open(os.path.join(res,'drawable-port-hdpi/splash.png')); print('SPLASH', s.size == (320,480), s.getpixel((2,2)) == (0,0,0), np.asarray(s).max() > 150)
rnd = Image.open(os.path.join(res,'mipmap-xxxhdpi/ic_launcher_round.png')); print('ROUND', rnd.getpixel((0,0))[3] == 0 and rnd.getpixel((96,96))[3] == 255)
print('WEBP_REMOVED', not os.path.exists(os.path.join(res,'mipmap-hdpi/ic_launcher.webp')))
`]);
  const L = chk.out;
  ok('icons: every density has foreground, monochrome, legacy square and round icons at the right size', /SIZES True/.test(L), L.slice(0, 200));
  ok('icons: foreground is transparent around the emblem', /ALPHA RGBA True True/.test(L));
  ok('icons: the emblem stays inside Android\'s adaptive safe circle (<= 30.5% of the 108dp canvas) and is centred', /RADIUS 0\.\d+ True/.test(L) && /CENTER True True/.test(L), (L.match(/RADIUS.*/) || [''])[0]);
  ok('icons: monochrome layer is white with the emblem as alpha', /MONO True 2\d\d/.test(L));
  ok('icons: splash keeps its original size, black background, emblem in the middle', /SPLASH True True True/.test(L));
  ok('icons: round icon has transparent corners; clashing .webp icons are removed', /ROUND True/.test(L) && /WEBP_REMOVED True/.test(L));
  const xml = fs.readFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8');
  ok('icons: adaptive XML = black background + foreground + monochrome', /wa_launcher_bg/.test(xml) && /wa_launcher_fg/.test(xml) && /wa_launcher_mono/.test(xml) && /#000000/.test(fs.readFileSync(path.join(res, 'values', 'wa_colors.xml'), 'utf8')));
}

// ---------------------------------------------------------------- 5. config + workflows
console.log('\n== 5. CONFIG AND GITHUB WORKFLOWS ==');
const cfg = JSON.parse(read('capacitor.config.json')), pkg = JSON.parse(read('package.json'));
ok('capacitor.config: stable app id, name, web dir', cfg.appId === 'com.horizon.workoutapp' && cfg.appName === 'WorkoutApp' && cfg.webDir === 'www');
ok('capacitor.config: origin pinned (https://localhost) so saved data keeps its address; SystemBars dark + css insets', cfg.server.androidScheme === 'https' && cfg.server.hostname === 'localhost' && cfg.plugins.SystemBars.insetsHandling === 'css' && cfg.plugins.SystemBars.style === 'DARK');
ok('package.json: Capacitor 8 line, Node >= 22, App plugin, fonts as dev dependencies, test script runs both suites', /^\^8/.test(pkg.dependencies['@capacitor/core']) && /^\^8/.test(pkg.dependencies['@capacitor/android']) && /^\^8/.test(pkg.devDependencies['@capacitor/cli']) && !!pkg.dependencies['@capacitor/app'] && !!pkg.devDependencies['@fontsource/sora'] && !!pkg.devDependencies['@fontsource/cairo'] && /node >=22/.test('node ' + pkg.engines.node) && /run-tests\.js/.test(pkg.scripts.test) && /run-android-tests\.js/.test(pkg.scripts.test));
const wf = {}; ['build-debug-apk', 'build-release-apk', 'create-signing-key'].forEach((n) => { wf[n] = read('.github/workflows/' + n + '.yml'); });
const yamlOk = sh('python3', ['-c', 'import yaml,sys,glob\nfor f in glob.glob(".github/workflows/*.yml"): yaml.safe_load(open(f))\nprint("YAML_OK")']);
if (/No module named/.test(yamlOk.out)) console.log('SKIP yaml parse: PyYAML not installed here'); else ok('all three workflow files are valid YAML', /YAML_OK/.test(yamlOk.out), yamlOk.out.slice(-200));
const d = wf['build-debug-apk'], rl = wf['build-release-apk'], sk = wf['create-signing-key'];
ok('debug workflow: manual + on every push to main, GitHub-hosted Ubuntu', /workflow_dispatch/.test(d) && /branches: \[main\]/.test(d) && /runs-on: ubuntu-24\.04/.test(d));
ok('debug workflow: pinned toolchain (Node 22, Java 21 Temurin, Android SDK 36)', /node-version: '22'/.test(d) && /java-version: '21'/.test(d) && /temurin/.test(d) && /android-36/.test(d));
ok('debug workflow: installs, tests, builds www, adds Android, patches, syncs, builds, verifies, uploads - in that order', ['npm ci', 'npm test', 'node build-www.js', 'npx cap add android', 'patch-android.js debug', 'npx cap sync android', 'assembleDebug', 'aapt2', 'upload-artifact'].every((s, i, a) => d.indexOf(s) > (i ? d.indexOf(a[i - 1]) : -1)));
ok('debug workflow: the APK is uploaded as an artifact and a missing APK is an error', /upload-artifact@v\d+/.test(d) && /if-no-files-found: error/.test(d) && /name: WorkoutApp-debug-apk/.test(d));
ok('debug workflow: build failures are never swallowed (continue-on-error only on the optional "save" step)', (d.match(/continue-on-error/g) || []).length === 1 && /Save lockfile[\s\S]*continue-on-error: true/.test(d));
ok('debug workflow: signs with a stable debug key kept in the repo, created once', /wa-debug\.keystore/.test(d) && /WA_DEBUG_KEYSTORE/.test(d) && /if \[ ! -f wa-debug\.keystore \]/.test(d));
ok('debug workflow: failure diagnostics only print manifest/gradle tail, no secrets', /if: failure\(\)/.test(d) && !/secrets\./.test(d));
ok('release workflow: manual only, needs the four ANDROID_* secrets, fails with a clear message when missing', /on:\s*\n\s*workflow_dispatch:/.test(rl) && !/push:/.test(rl) && ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].every((s) => rl.indexOf('secrets.' + s) > -1) && /::error::/.test(rl));
ok('release workflow: never prints secrets (no echo of secret values, no set -x, no bash -x)', !/echo[^\n]*\$\{\{\s*secrets/.test(rl) && !/set -x|bash -x/.test(rl) && !/echo "?\$(ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD|ANDROID_KEYSTORE_BASE64)/.test(rl.replace(/base64 -d/g, '')) || /echo "\$ANDROID_KEYSTORE_BASE64" \| base64 -d >/.test(rl));
ok('release workflow: key decoded to a temp file, deleted at the end even on failure; read-only repo permission', /RUNNER_TEMP/.test(rl) && /if: always\(\)[\s\S]*rm -f/.test(rl) && /contents: read/.test(rl));
ok('release workflow: signature verified, fingerprint (public) reported, separate artifact name, no git push of keys', /apksigner/.test(rl) && /SHA-256/.test(rl) && /name: WorkoutApp-release-apk/.test(rl) && !/git (add|push|commit)/.test(rl) && /assembleRelease/.test(rl));
ok('signing-key workflow: manual, requires typing CREATE, refuses when a key already exists, masks the password, 1-day artifact', /confirm/.test(sk) && /CREATE/.test(sk) && /already exists/.test(sk) && /::add-mask::/.test(sk) && /retention-days: 1/.test(sk) && /secrets\.ANDROID_KEYSTORE_BASE64/.test(sk));
ok('signing-key workflow: no passwords are written to the log; contents read-only; nothing committed', !/echo(?![^\n]*::add-mask::)[^\n]*\$PASS/.test(sk) && /contents: read/.test(sk) && !/git (add|push|commit)/.test(sk));
ok('no workflow commits a release key or passes secrets on the command line', !/(-storepass|-keypass)\s+["']?[A-Za-z0-9]{6,}/.test(rl) && /ANDROID_KEYSTORE_PASSWORD/.test(rl));
// the app itself is untouched by the packaging
const parent = path.join(ROOT, '..');
const sameAsTested = fs.existsSync(path.join(parent, 'app.js')) ? ['app.js', 'data.js', 'icons.js', 'style.css'].every((f) => md5(path.join(ROOT, f)) === md5(path.join(parent, f))) : true;
ok('the web app files in this project are identical to the ones tested as the web version', sameAsTested);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILED:\n- ' + failures.join('\n- ')); process.exit(1); }

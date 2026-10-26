/* WorkoutApp native bridge.
   Loaded ONLY in the Android build (build-www.js injects it after app.js). In a normal browser it does nothing.
   It never edits app.js: it calls the app's own global functions (goHome, closeEdit, ...) and reads `state`.
   Features: Android back button (overlays first, then screens, confirmation before leaving a workout,
   press-twice-to-exit on Home) and a resume signal when the app returns from the background. */
(function () {
  'use strict';
  var EXIT_WINDOW_MS = 2000;
  var lastBackAt = 0;
  var WORKOUT_SCREENS = { ready: 1, warmup: 1, active: 1 };

  // "Leave workout?" reuses the app's own confirm dialog (CONFIRM_TEXT + a global handler named in `fn`).
  function installLeaveDialog() {
    if (typeof CONFIRM_TEXT === 'undefined' || CONFIRM_TEXT.leaveWorkout) return;
    CONFIRM_TEXT.leaveWorkout = {
      title: 'LEAVE WORKOUT?',
      body: 'Your progress is saved. You can resume this workout from the home screen.',
      fn: 'confirmLeaveWorkout', btn: 'LEAVE', ic: 'x'
    };
    window.confirmLeaveWorkout = function () {
      state.confirmAction = null;
      state.drawerOpen = false;
      goHome(); // the session stays in storage and Home offers RESUME
    };
  }

  // Returns 'handled' or 'exit'. Order mirrors the order in which the app stacks its overlays.
  function handleBack() {
    if (typeof state === 'undefined') return 'exit';
    if (state.paused && (state.screen === 'active' || state.screen === 'warmup')) { togglePause(); return 'handled'; }
    if (state.timeEdit) { closeTimeEdit(); return 'handled'; }
    if (state.importOpen) { if (state.importPreview) backToImportEdit(); else closeImport(); return 'handled'; }
    if (state.confirmAction) { cancelConfirmAction(); return 'handled'; }
    if (state.editEx) { closeEdit(); return 'handled'; }
    if (state.drawerOpen) { toggleDrawer(); return 'handled'; }
    var s = state.screen;
    if (WORKOUT_SCREENS[s]) { state.confirmAction = { kind: 'leaveWorkout' }; render(); return 'handled'; }
    if (s === 'advancedSettings' || s === 'customMods') { goSettings(); return 'handled'; }
    if (s !== 'home') { goHome(); return 'handled'; }
    var now = Date.now();
    if (now - lastBackAt < EXIT_WINDOW_MS) return 'exit';
    lastBackAt = now;
    showToast('PRESS BACK AGAIN TO EXIT');
    return 'handled';
  }

  function getAppPlugin() {
    var C = window.Capacitor;
    if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return null;
    if (C.Plugins && C.Plugins.App) return C.Plugins.App;
    if (typeof C.registerPlugin === 'function') { try { return C.registerPlugin('App'); } catch (e) { return null; } }
    return null;
  }

  function register() {
    var App = getAppPlugin();
    if (!App || typeof App.addListener !== 'function') return false;
    installLeaveDialog();
    App.addListener('backButton', function () { if (handleBack() === 'exit') App.exitApp(); });
    // The app already re-syncs timers and the wake lock on visibilitychange; make sure that also runs on resume.
    App.addListener('appStateChange', function (st) { if (st && st.isActive) document.dispatchEvent(new Event('visibilitychange')); });
    window.__waNativeBridge = { handleBack: handleBack };
    return true;
  }

  // Capacitor's runtime can finish initialising slightly after our script runs: retry for a few seconds.
  var tries = 0;
  (function attempt() {
    if (register()) return;
    var C = window.Capacitor;
    if (C && typeof C.isNativePlatform === 'function' && !C.isNativePlatform()) return; // plain browser: nothing to do
    if (++tries < 40) setTimeout(attempt, 250);
    else if (window.console) console.warn('WorkoutApp: Android back-button bridge could not attach (Capacitor App plugin not found).');
  })();
})();

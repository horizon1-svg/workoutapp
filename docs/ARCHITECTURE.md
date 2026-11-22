# WOH architecture

This guide describes the current repository structure. The source files are authoritative if this document and the implementation ever differ.

## Overview

WOH is a static, mobile-first web application packaged for Android with Capacitor 8. The app itself uses plain HTML, CSS, and JavaScript; it does not use a front-end framework or a bundler.

## Application entry point

The main entry point is [index.html](../index.html). It provides the app shell and loads scripts in this order:

1. **icons.js** — inline SVG icon definitions.
2. **data.js** — built-in session, exercise, warm-up, and motivation data.
3. **app.js** — application state, storage, timers, navigation, rendering, and event handling.

The main DOM mount points are:

- **#app-shell** — mobile app container.
- **#app** — active screen content.
- **#modal-root** — modal and overlay content.
- **#bottom-nav** — bottom navigation.
- **#rest-visual-layer** — visual layer used by the Rest experience.

## Data definitions

[data.js](../data.js) contains the built-in training data, including:

- **EXERCISE_DB** — exercises grouped by the six training sessions.
- **WARMUP_DB** — warm-up steps grouped by training type.
- **SESSION_ORDER** — the six training sessions and Rest day.
- Motivation cards, library content, and Rest-screen visuals.

The data file is intentionally self-contained so the app can load its workout definitions without a separate data service.

## Application controller

[app.js](../app.js) owns the app's behavior. Its main responsibilities include:

- Persistent storage and settings.
- Workout state and session navigation.
- Ready, set, warm-up, and rest timer lifecycles.
- Pause, resume, skip, and previous-step behavior.
- Exercise modifications and custom exercises.
- Workout completion, history, streak, and progress views.
- Backup export and validated import.
- Rendering of the home, setup, workout, history, progress, and settings screens.

The app uses a render-driven screen architecture: state determines the current screen and the corresponding renderer updates the app mount point.

## Local persistence

The **Store** abstraction uses keys prefixed with **wa_** in localStorage, with an in-memory fallback when localStorage is unavailable.

Persisted data includes user settings, active workout state, history, streak data, exercise modifications, custom exercises, and the selected accent theme. The backup/export code defines which user data is included in a backup.

When changing persisted structures:

- Keep existing user records readable.
- Treat import as untrusted input and validate before applying it.
- Preserve the preview/confirmation step before replacing stored data.
- Update schema migration and regression tests when a data format changes.

## Android layer

Capacitor wraps the static web assets for Android.

| File | Responsibility |
|---|---|
| capacitor.config.json | App ID, app name, web directory, and native configuration |
| native-bridge.js | Web-to-native bridge |
| build-www.js | Produces the web asset directory |
| patch-android.js | Applies Android project settings |
| make-icons.py | Generates Android launcher and splash assets |

The application ID is **com.horizon.workoutapp**. Keep it stable unless a specifically approved migration requires otherwise.

## Automated checks

- **run-tests.js** exercises application logic and data-handling behavior.
- **run-android-tests.js** checks Android build and packaging configuration.
- **npm test** runs both suites.

Automated tests do not replace checking device-only behavior such as audio, wake lock, system bars, keyboard layout, clipboard, and Android back navigation on a real device.

# WOH — Workout at Home

<p align="center">
  <img src="logo.png" alt="WOH logo" width="180">
</p>

<p align="center">
  <strong>A focused, mobile-first workout tracker built for training at home.</strong>
  <br>
  Plan sessions, follow your sets, manage rest, and review your progress — with an Android app built from a lightweight web codebase.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: GPL-3.0-only" src="https://img.shields.io/badge/License-GPL--3.0--only-red.svg"></a>
  <img alt="Platform: Android" src="https://img.shields.io/badge/Platform-Android-black.svg">
  <img alt="Built with: JavaScript" src="https://img.shields.io/badge/Built%20with-Vanilla%20JavaScript-yellow.svg">
  <img alt="Original creator: horizon1-svg" src="https://img.shields.io/badge/Original%20creator-horizon1--svg-202020.svg">
</p>

---

## What is WOH?

WOH (Workout at Home) is an independently developed fitness app focused on structured home workouts. It brings workout sessions, exercise setup, warm-up, set and rest timers, workout history, and progress tracking into one mobile-first experience.

The project is designed to stay lightweight: the application UI is built with plain HTML, CSS, and JavaScript, then packaged for Android with Capacitor.

**WOH is open source and actively evolving.** You can study it, run it, improve it, and publish your own modified version under the terms of the GNU GPL version 3. Please keep the original copyright notices and clearly identify your changes; see [AUTHORS.md](AUTHORS.md) and [BRANDING.md](BRANDING.md).

## Features available today

### Plan and run workouts
- Six built-in training sessions: Push A, Pull A, Legs A, Push B, Pull B, and Legs B.
- A dedicated Rest day entry.
- Session setup with exercise ordering and per-exercise set/target configuration.
- Warm-up flows, ready countdowns, timed sets, repetition entry, and rest intervals.
- Workout controls for pausing, resuming, skipping, and returning to the previous step.
- Resume support for an in-progress session.

### Make the plan yours
- Edit session exercises and save personal modifications.
- Add custom exercises, with a limit of 10 custom exercises.
- Use setup presets and save a session as a personal default.
- Adjust relevant workout, rest, warm-up, and countdown timings through settings.

### Review your progress
- Workout history and session summaries.
- Streak and calendar-based activity views.
- Progress charts and aggregated training metrics.
- Export workout data and restore it through a validation and preview flow.

### A focused training experience
- Dark, minimal interface with red, yellow, and blue accent themes.
- Synthesized workout feedback sounds.
- Optional screen-awake behavior during training.
- Motivation content integrated into the Rest experience.

> This section describes functionality present in the current source. It is not a promise that every planned improvement is already available in a published APK.

## Development status and roadmap

WOH is an ongoing project. The current app is a working foundation, not the final destination. Development is organized into milestones so the experience can improve without sacrificing workout-history integrity, reliability, or the simplicity of the interface.

### Current development focus

**Theme Engine — visual consistency**

Refining the app's theme foundation so accent colors are applied consistently across timers, navigation, overlays, and workout surfaces. Device-level visual validation remains part of the work before this milestone is considered complete.

### Planned milestones

| Milestone | Direction | Status |
|---|---|---|
| Theme Studio | Give users a clearer, more flexible way to personalize the app's appearance. | Planned |
| Workout Builder | Make creating, organizing, and managing workout sessions more flexible. | Planned |
| Settings Redesign | Rework settings into a clearer and easier-to-navigate experience. | Planned |

The roadmap is a direction, not a fixed release promise. Scope and priorities may change as each milestone is designed, tested, and reviewed. A planned item should not be interpreted as an implemented or released feature.

We share the product direction here while keeping implementation details, experiments, and unfinished design decisions in the development workflow.

## Project visuals

The WOH app icon is included in this repository as [logo.png](logo.png). In-app screenshots will be added when current captures from a running build are available; we prefer real product screenshots over concept mockups.

## Tech stack

| Area | Technology |
|---|---|
| Application UI | HTML, CSS, vanilla JavaScript |
| Android packaging | Capacitor 8 |
| Android build | Gradle, Android SDK 36 |
| Fonts | Sora and Cairo |
| Automated checks | Node.js test scripts |
| Build automation | GitHub Actions |

There is no front-end framework or bundler. The source is intentionally kept direct and lightweight.

## Repository map

| Path | Purpose |
|---|---|
| `index.html` | App shell and script loading order |
| `style.css` | Visual design system and screen styling |
| `icons.js` | Inline SVG icon definitions |
| `data.js` | Session, exercise, warm-up, and motivation data |
| `app.js` | Application state, storage, timers, navigation, rendering, history, and settings |
| `native-bridge.js` | Bridge between the web app and native Android capabilities |
| `build-www.js` | Prepares the web assets for Capacitor |
| `capacitor.config.json` | Capacitor app configuration |
| `patch-android.js` | Applies the Android project configuration |
| `make-icons.py` | Generates Android launcher and splash assets |
| `run-tests.js` | Application logic tests |
| `run-android-tests.js` | Android packaging and build-configuration checks |
| `.github/workflows/` | Debug, release, and signing-key workflows |

More detail is available in [the architecture guide](docs/ARCHITECTURE.md) and [the build guide](docs/BUILDING.md).

## Getting started

### Requirements
- Node.js 22 or newer.
- npm.
- For a local Android build: Java 21 and Android SDK platform 36 with Build Tools 36.0.0.

### Install and test

~~~bash
npm ci
npm test
~~~

To generate the web assets used by Capacitor:

~~~bash
npm run build:www
~~~

See [docs/BUILDING.md](docs/BUILDING.md) for the Android workflows and release-signing requirements.

## How WOH is developed

WOH is developed incrementally, with a strong preference for focused changes over broad rewrites:

1. Define the user-facing behavior and the affected part of the app.
2. Inspect the existing state, storage, rendering, timer, and data flows before changing code.
3. Make the smallest change that solves the task and preserve existing workout records and backup compatibility.
4. Run the relevant automated tests with `npm test`.
5. Review the result in the Android app where device-specific behavior is involved.
6. Document meaningful changes and known limitations.

The project prioritizes reliable workout flow, clear mobile UI, and keeping users' training history safe. Contributions should follow the same approach; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Bug reports, thoughtful suggestions, and code contributions are welcome. Before making a large change, open an issue to discuss the proposal. For code contributions, create a focused branch, explain the behavior change, and run the test suite.

Please do not change the Android application ID `com.horizon.workoutapp` as part of a routine UI or documentation update. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## Support the development

WOH is an independent project. Contributions are welcome, and donations help support ongoing development.

**Binance Pay — Binance ID (UID):**

~~~text
1071816039
~~~

To send support, open Binance Pay and choose **Send**, then use the Binance ID above. Check that Binance displays the intended recipient before confirming. This is a Binance Pay identifier, **not** a blockchain deposit address.

See Binance's official guide: [How to receive crypto with Binance Pay](https://www.binance.com/en/support/faq/detail/c92c2a2daf5a457cb1adc08c4ad8315c).

Donations are voluntary and do not buy ownership, special access, or influence over the project's direction.

## Original creator and project identity

WOH was originally created and is maintained by **[horizon1-svg](https://github.com/horizon1-svg)**.

If you fork or publish a derivative:
- Preserve the source copyright and license notices.
- Clearly mark modified versions and describe your changes.
- Credit WOH as the upstream project in your fork's documentation.
- Do not present your fork as the official WOH project or imply endorsement.

The GPL license applies to the software source code. It does not grant permission to use the WOH name or logo in a way that misrepresents the origin of a derivative. See [BRANDING.md](BRANDING.md).

## License

The source code in this repository is licensed under the **GNU General Public License v3.0 only**. See [LICENSE](LICENSE) for the full terms.

The GPL allows people to use, study, modify, and redistribute the software under its conditions. In particular, redistributed source and modified versions must retain the applicable notices and meet the license's source and change-notice requirements. The license does not require promotional praise or imply that the original creator endorses a fork.

---

<p align="center">
  <strong>WOH — Train with intention. Track your work.</strong>
  <br>
  Created and maintained by <a href="https://github.com/horizon1-svg">horizon1-svg</a>.
</p>

# Contributing to WOH

Thank you for considering a contribution. WOH is an independently developed project, and focused, well-tested improvements are the most useful.

## Before you start

- For a substantial feature or behavior change, open an issue first so the scope can be discussed.
- For a bug, include the steps to reproduce it and what you expected to happen.
- Check existing screens and flows before proposing a parallel implementation.

## Development principles

- Keep the existing vanilla HTML, CSS, and JavaScript architecture.
- Avoid adding a framework, bundler, or dependency unless there is a clear technical reason.
- Make the smallest change that solves the issue.
- Preserve workout history, active-session resume, timer behavior, settings, and backup compatibility.
- Avoid changing workout data as part of a UI-only change.
- Keep the interface mobile-first and consistent with the dark visual system.
- When changing user-facing text or content, preserve the app's existing language conventions.

## Important Android compatibility rule

Do not change the Android application ID:

**com.horizon.workoutapp**

A routine UI, documentation, or feature contribution must not change this identifier. Changes to Android packaging or signing workflows should be narrowly scoped and explained in the pull request.

## Run the checks

Use Node.js 22 or newer.

~~~bash
npm ci
npm test
~~~

The test command runs both the application test suite and Android packaging checks. If your change affects Android packaging, also inspect the relevant GitHub Actions workflow.

## Pull request expectations

A good pull request should include:

1. A clear summary of the user-facing behavior.
2. The reason for the change.
3. The files and important functions affected.
4. Test commands run and their actual results.
5. Screenshots from the real app for visual changes, where practical.

Keep unrelated formatting and refactoring out of the pull request.

## Security and secrets

Never commit passwords, API tokens, personal credentials, or a private release-signing keystore. GitHub Actions secrets must be configured in repository settings, not placed in source files or pull request comments.

## Attribution

Please preserve the original copyright and license notices. Modified distributions must satisfy the GPL-3.0-only terms. Credit WOH as the upstream project and clearly identify your own modifications; see [AUTHORS.md](AUTHORS.md) and [BRANDING.md](BRANDING.md).

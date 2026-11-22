# Building WOH for Android

The repository includes GitHub Actions workflows for debug and signed release APKs. These workflows are the most repeatable build path.

## Toolchain

The current workflows use:

- Node.js 22
- Java 21 (Temurin)
- Android SDK platform 36
- Android Build Tools 36.0.0
- Capacitor 8

## Run tests and prepare web assets

From the repository root:

~~~bash
npm ci
npm test
npm run build:www
~~~

- **npm ci** installs the exact dependencies recorded in package-lock.json.
- **npm test** runs the application and Android packaging test suites.
- **npm run build:www** runs build-www.js and prepares the static web assets for Capacitor.

## Debug APK

The workflow is **.github/workflows/build-debug-apk.yml**.

It can run manually from the Actions tab or automatically when commits are pushed to **main**. It installs dependencies, runs tests, creates the web assets, prepares the Android project, and builds a debug APK.

After a successful run:

1. Open the repository's **Actions** tab.
2. Open the completed **Build debug APK** run.
3. Find the **Artifacts** section.
4. Download **WorkoutApp-debug-apk**.

The workflow retains this artifact for 30 days. A debug APK is for testing and is not the signed release build.

## Signed release APK

The workflow is **.github/workflows/build-release-apk.yml** and is started manually.

It requires these GitHub Actions repository secrets:

- **ANDROID_KEYSTORE_BASE64**
- **ANDROID_KEYSTORE_PASSWORD**
- **ANDROID_KEY_ALIAS**
- **ANDROID_KEY_PASSWORD**

If a release key has not been created yet, the repository also provides **.github/workflows/create-signing-key.yml**. It generates a signing key artifact with a one-day retention period. Follow the workflow's instructions carefully, save the key securely, and add the required values as GitHub Actions secrets. Never commit the private release keystore or its passwords.

After the release workflow succeeds, download **WorkoutApp-release-apk** from that run's Artifacts section. The artifact is retained for 30 days.

## Versioning

The current build workflows derive the Android version name from the GitHub Actions run number. Review the workflow before changing versioning behavior.

## Important compatibility notes

- Keep the Android application ID **com.horizon.workoutapp** stable. Changing it causes Android to treat the app as a different package.
- A release update must be signed with the same release key as the installed release app. Losing or replacing that key can prevent users from installing updates over an existing release.
- A successful automated build does not prove every device-specific feature works. Test installation and workout behavior on a real Android device before distributing a release.

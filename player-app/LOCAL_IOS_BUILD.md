# Local iOS archive and App Store Connect upload

This route uses Expo's local native generation, CocoaPods, and Xcode on a Mac. Xcode Organizer uploads the resulting archive directly to Apple; EAS Build and EAS Submit are not involved. Expo documents this [manual iOS workflow](https://docs.expo.dev/submit/ios-manual/).

**Current execution blocker:** the available computer is Windows and no Mac connection is configured. These instructions have not been executed on a local Mac. The existing GitHub simulator checks are separate evidence; their simulator application cannot be uploaded to App Store Connect.

## Prepare the Mac and source

1. Install stable Xcode **27.0 (`27A266a`)**, matching the prepared production toolchain, and complete its first-launch setup. SDK 58's documented minimum is Xcode 26.4; using that minimum would be a different toolchain from this release's selected production target. See [SDK 58 requirements](https://docs.expo.dev/versions/v58.0.0/) and [Expo's toolchain inventory](https://docs.expo.dev/build-reference/infrastructure/).
2. Install Node **22.16.0**, npm **10.9.2**, and CocoaPods. Confirm `node --version`, `npm --version`, `xcodebuild -version`, and `pod --version` in the terminal that will prepare the app.
3. Use a clean checkout of the reviewed, pushed release commit on a branch other than `main`. Run `git status --short --branch` and record `git rev-parse HEAD`. Confirm that this source has the required CI/native results. Do not copy another computer's dependencies, `.env` files, or signing material into the checkout.
4. From the repository root, install the locked dependencies needed by the local tools:

   ```sh
   npm ci
   npm ci --prefix player-app
   ```

5. The Mac operator must have access to the intended paid Apple Developer team and the App Store Connect record for **`com.caminuslabs.orbit`**. Set up the Apple account in Xcode's Settings. Keep passwords, private keys, certificates, and provisioning material in Apple's/Xcode's normal secure storage; do not paste them into repository files or this runbook.

The local archive/upload route does not use the account's EAS cloud-build allowance. Apple signing access and a matching App Store Connect record remain required.

## Generate the production iOS project

Start from a checkout without `player-app/ios`. If that directory already exists, preserve it and use a fresh checkout rather than deleting or overwriting native work.

The production variables in `player-app/eas.json` must reach **both** native generation and the later JavaScript bundle phase. The existing `productionPlayerEnvironment()` helper validates those authored values, removes inherited sensitive/service variables, and disables dotenv loading. Do not substitute an ordinary development environment or download remote environment secrets for this workflow.

From the repository root, run the following on the Mac:

```sh
node --input-type=module <<'NODE'
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPlayerBinary, playerRoot, repositoryRoot, productionPlayerEnvironment } from './scripts/player-release-environment.mjs';

const environment = productionPlayerEnvironment({ ...process.env, EXPO_NO_TELEMETRY: '1' });
function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [localPlayerBinary('expo', 'bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], playerRoot);
run(process.execPath, [path.join(repositoryRoot, 'scripts/verify-player-native.mjs'), '--ios-dir', path.join(playerRoot, 'ios')], repositoryRoot);
run('pod', ['install'], path.join(playerRoot, 'ios'));
NODE
```

This intentionally leaves the generated project in ignored `player-app/ios`. The ordinary `npm run player:prebuild:ios` verification command generates and deletes a disposable project, so it does not leave a workspace to open.

Review `git diff` after prebuild. Expo may update package scripts; any dependency or application-source change requires review and the relevant checks before the candidate can claim the reviewed source identity. Do not commit generated native output or unrelated changes. Retain the generated-native check's provider-before-Firebase ordering, quoted App Check bridging-header import, production App Attest entitlement, bundle identity, permissions, and privacy checks.

## Select signing and a local build number

Open `player-app/ios/OrbitPlayer.xcworkspace` in Xcode, for example from the repository root:

```sh
xed player-app/ios
```

Select the **OrbitPlayer** application target:

1. Under **Signing & Capabilities**, select the confirmed Apple Developer team for Release. Use the matching `com.caminuslabs.orbit` App ID and appropriate App Store signing. Do not disable signing or remove App Attest to resolve a signing error.
2. Under **General**, keep Version **`1.0.0`** and choose an explicit positive integer Build value that is available for this version in App Store Connect. Record it alongside the source commit. Confirm the generated app's `Info.plist` and Xcode target agree on that value.
3. Under **Product > Scheme > Edit Scheme > Archive**, confirm the configuration is **Release**.

`cli.appVersionSource: remote` and `autoIncrement` in `eas.json` belong to EAS Build; direct Xcode archiving does not automatically apply that remote counter. The disposable native verifier expects build `1` before this manual version selection. Do not change that verifier to accept arbitrary values; independently verify the selected number in the actual archive. Apple's [distribution preparation guide](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution) explains version/build management.

## Archive with the production bundle environment

Use the following from the repository root after selecting signing and the build number. Use a new archive path for every candidate and preserve earlier archives. This example creates `out/local-ios-release/OrbitPlayer.xcarchive`; choose another path if it already exists.

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { playerRoot, repositoryRoot, productionPlayerEnvironment } from './scripts/player-release-environment.mjs';

const archive = path.join(repositoryRoot, 'out', 'local-ios-release', 'OrbitPlayer.xcarchive');
if (fs.existsSync(archive)) throw new Error('Preserve the existing archive and choose a new candidate path.');
fs.mkdirSync(path.dirname(archive), { recursive: true });
const result = spawnSync('xcodebuild', [
  '-workspace', path.join(playerRoot, 'ios', 'OrbitPlayer.xcworkspace'),
  '-scheme', 'OrbitPlayer', '-configuration', 'Release',
  '-destination', 'generic/platform=iOS', '-archivePath', archive, 'archive'
], {
  cwd: playerRoot,
  env: productionPlayerEnvironment({ ...process.env, EXPO_NO_TELEMETRY: '1' }),
  stdio: 'inherit'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
NODE
```

This invokes Xcode with the validated production environment during `export:embed`. Opening Xcode from the Dock does not establish that environment for a new GUI build. If building through the GUI instead, first arrange the same approved variables in the native bundle phase's ignored environment configuration and verify the actual embedded bundle; do not assume terminal exports reach an already running Xcode application.

Before upload, inspect the archived app at `Products/Applications/OrbitPlayer.app`: confirm its bundle identifier, version, selected build number, Release bundle, signing team, production App Attest entitlement, and aggregated privacy manifests. Record the source commit, toolchain, archive hash, build number, and verification results. Use the privacy and device-acceptance requirements in [APP_STORE_SUBMISSION.md](./APP_STORE_SUBMISSION.md); simulator success does not establish signed-device App Attest acceptance.

## Upload directly with Apple tools

1. Open the archive in Xcode Organizer, or open the `.xcarchive` in Finder and select it in Organizer.
2. Choose **Distribute App > App Store Connect** and follow Xcode's validation/upload prompts for the confirmed team and app. Recheck the version/build number shown in the final upload summary. To export an `.ipa` instead, choose the export option and upload that file with Apple's Transporter application.
3. Wait for Apple's processing result, then find the same version/build under **App Store Connect > Orbit Player > TestFlight**.
4. After the exact build passes the required physical-device checks, complete the listing, privacy, screenshots, and reviewer access. Select the build on the app-version page, then use **Add for Review** and **Submit for Review** when authorized. Uploading a binary does not itself complete App Review submission.

The repository's `submit:testflight` script accepts an exact EAS build ID and therefore is not the uploader for this local Xcode archive. Follow [Expo's manual Xcode/Transporter guide](https://docs.expo.dev/submit/ios-manual/) and Apple's [upload guidance](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/). Keep all archives, `.ipa` files, logs, caches, and signing material out of commits.

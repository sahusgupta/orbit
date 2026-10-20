# Apple device enrollment authentication — 2026-10-13

Current enrollment/signing checkpoint: the user reported **Registration completed**, then completed the private signing-credentials workflow and reported **Credentials ready**. The bounded Expo query at `21:25:19.936Z–21:25:21.824Z` returned exit0/HTTP200, verified the expected account/project and found team/iPhone records. After the historical missing-credentials attempt below, managed signing reuse succeeded: first physical job `66450c80-12f5-4479-ac03-3a63753f42d0` finished at `22:06:55.003Z`, and its actual IPA inspection passed for preceding `b5e6`/`a9e3` source. The [canonical Map build record](./2026-10-13-player-iphone-map-build.md) owns current `6d4b`/128, immutable `cbc60`/132 digest `9e4f5a…`, all13/1,887-test verification and subsequent managed job/status evidence. It is the live-status reference; installation, intended-phone inclusion and genuine App Attest/provider/API acceptance remain unverified.

The user requested an installable iPhone test build and setup help, supplied `com.caminuslabs.orbit`, confirmed paid Apple Developer membership, and reported that the recommended pinned `device:create` command failed with **“Authentication with Apple Developer Portal failed! iTunes service key is empty.”** No passwords, codes or device identifiers were requested or read.

## Verified diagnosis and narrow fix

The installed repository tool is EAS CLI 23.2.0 with `@expo/apple-utils` 2.1.22. Its service-key getter uses Apple's older `olympus/v1/app/config?hostname=itunesconnect.apple.com` endpoint and asserts that the returned public authentication-service configuration contains the expected fields. The failure occurs in that bootstrap path; it is not evidence that the user's password, paid membership or Firebase bundle is invalid.

Expo's maintainer confirms this exact issue was resolved in [EAS CLI 24.4.1](https://github.com/expo/eas-cli/issues/4392), whose [release](https://github.com/expo/eas-cli/releases/tag/v24.4.1) updates Apple utilities to 2.2.1. The current official [24.13.0 release](https://github.com/expo/eas-cli/releases/tag/v24.13.0) and read-only public npm metadata confirm that it contains that same fixed utility version. Root did not execute sign-in or install/update a repository or global package.

Independent checksum-verified public package inspection compared the old/new authentication modules in memory. The newer getter obtains the public widget configuration through Apple's logout redirect and writes the same service-key cache object shape; cookie serializer, loader, restoration and validation implementations are byte-identical. The pinned 23.2.0 build can therefore reuse a real successful session under the same user profile or the compatible populated key cache. This is a source-based compatibility inference, not a live sign-in result or permanent remedy for expired sessions/future Apple changes. Credential/session caches were not opened, copied, edited or printed; no manual key override was used.

## Completed private enrollment retry (historical command)

The user ran account-level device enrollment outside the project so the reviewed build's exact CLI constraint remained intact. This completed command is retained for provenance; it is not the current next step:

```powershell
Push-Location -LiteralPath $env:TEMP
npx --yes eas-cli@24.13.0 device:create
Pop-Location
```

The user completed the existing `saussy` account's **Website** enrollment through iPhone Safari and reported success. Root independently confirmed the account-level record presence above. Credentials and verification codes stayed in the local/provider workflow. At that enrollment checkpoint, signing was still a separate step; later managed signing completed as recorded above. Intended-device inclusion and Apple installation trust are not established by enrollment presence.

## Bounded Expo enrollment presence check

Root reviewed a separate read-only helper for the existing `saussy` Expo account and project `bb2059b7-91b3-4a6b-a66e-d5618e794fd3`. It preserves the installed SDK's managed authentication and actor validation. The additional query requests at most one team and one iPhone record, selecting only their presence rather than team/device identifiers. Exact query ASTs, project, owner, HTTPS endpoint, POST method and request budgets are guarded. Child stdout/stderr remain ignored; results contain only fixed categories, booleans and HTTP status. No credential/session-cache file was manually opened, copied, changed or printed, and no Apple login, registration mutation, signing or remote build was performed.

- The original `20:50:07.209Z` attempt returned `blocked_transport`, HTTP status `null`, child exit 0 and parent exit 1. Its first blocked layer was not recorded, so it did not establish enrollment state. The original helper and result remain preserved.
- Installed `node-fetch` source revealed a local guard defect: legacy `Url.parse` produces `port: null` for implicit HTTPS, and the old guard converted it to zero. A separate diagnostic copy adds only fixed blocked-stage labels and normalizes that absent port to 443. The pure legacy-options regression failed before the fix (**1 failed / 4 passed**) and passed afterward (**5 passed**); all **12 existing query/target guards** and syntax checks passed. Explicit wrong ports, hosts, methods, paths, redirects, mutations and expanded queries remain rejected. No SDK authentication adapter, query allowance or source dependency changed.
- The default-sandbox diagnostic attempt at `21:02:16.935Z` returned `query_budget`, HTTP status `null`, child exit 0 and parent exit 1. The SDK's normal retry can reach that budget after an earlier failure, but this bounded result does not identify the initial transport cause or prove absence.
- Root's approved execution of the **identical helper** outside the sandbox at `21:04:21.393Z` finished at `21:04:23.036Z`, exit 0 and HTTP **200**. The expected account/project was verified; **teamRecordPresent=false** and **iphoneRecordPresent=false**. Root index bytes were unchanged. This establishes only the absence of those Expo account records at that observation time. It does not contradict the user's paid Apple membership or establish whether any device is registered directly with Apple, included in a provisioning profile, signed or installable.

Ignored results retain their exact timestamp names under `out/player-iphone-enrollment-presence-*.json`; diagnostic source, pure tests and preparation evidence are separate from the original failed helper. The new21:25 positive observation was made only after the user's completed-registration report. The helper pins retained artifact `e357be…`; the separately reviewed [card-facts source/archive](./2026-10-13-player-card-facts.md) is historical `8fe1ce…` /128 inputs, immutable commit `0e3a623…` with132-file digest `ec601f…`. Its660 source comparisons and actual local archive byte/blob checks preserve its two shipping changes and all build protections; neither artifact is a signed iPhone candidate.

The standalone **EAS 24.13.0** enrollment step is complete. Historically, the first pinned-CLI frozen reuse attempt ran `21:49:49.133Z–21:50:20.820Z`, exit1, with `credentialsMissing=true`, `submitted=false` and no observed build ID. Its normal credential setup precedes source upload/job submission. The CLI also reported remote build-number initialization; that attempt was a managed build operation rather than a read-only preflight, even though `autoIncrement` is false. Source and root index were unchanged. That failed attempt verified no signing profile/device inclusion and performed no store submission; later successful signing does not rewrite its result.

## Completed private signing setup (historical command)

After that first failure, the user completed the requested normal interactive credentials command from the reviewed immutable project and reported **Credentials ready**. The command is retained for provenance, not as an outstanding setup instruction:

```powershell
Set-Location -LiteralPath 'C:\Users\herob\OneDrive\Documents\GitHub\TableManager\out\player-iphone-release-tournament-handoff\source\player-app'
node 'C:\Users\herob\OneDrive\Documents\GitHub\TableManager\node_modules\eas-cli\bin\run' credentials:configure-build --platform ios --profile iphone-test
```

That normal interactive workflow loads the inherited production profile environment and resolves the same `saussy` project and `com.caminuslabs.orbit` bundle. Apple sign-in and team/profile choices remained in the user's private local/provider prompts; root received only the completion result. No new enrollment, dependency-pin change or credential-cache edit was used. Subsequent pinned-CLI frozen managed reuse actually submitted and completed the first physical build. Its packaged profile/executable identity, certificate allowance/date checks and production entitlement claims passed bounded IPA inspection; exact intended-phone inclusion, Apple trust and attestation acceptance were not established. The earlier source-based session-compatibility inference is not a guarantee for expired sessions or future Apple changes.

Correct intended-device/profile inclusion, Apple installation trust, Firebase Team association and genuine App Attest/API acceptance remain separate checks. No automatic ad-hoc refresh or validation bypass was used. Exact current source/job reconciliation and subsequent build status are maintained in the canonical Map build record linked above.

No `EAS_SKIP_CLI_VERSION_CHECK`, debug App Check provider, source pin change, `npm audit fix`, dependency upgrade, cache deletion, store upload or hosted player operation was introduced. The [iPhone registration record](./2026-10-13-player-ios-registration.md) retains the last observed missing Apple Team association; completed signing does not itself verify or update Firebase provider association or protected API allowance. Those and physical-device acceptance remain pilot gates.

# Update signing (one-click updates)

## Server / browser install (git, npm, npx)
1. Generate an Ed25519 key pair once (offline):
   `openssl genpkey -algorithm ed25519 -out kmy-release.pem && openssl pkey -in kmy-release.pem -pubout -out kmy-release.pub`
2. Put the **public** key (PEM) into `server/update-key.js` → `RELEASE_PUBLIC_KEY`.
3. Store the **private** key as GitHub secret `KMY_RELEASE_SIGNING_KEY`. Never commit it.
4. Tagged releases then ship `kmy-terminal-<v>.tgz`, `SHA256SUMS`, `SHA256SUMS.sig`.
   The app verifies the signature, then the SHA-256 of the package, installs it in a separate
   folder (`<data>/updates/<v>`), and restarts. Roll back: delete `<data>/updates/active.json`.
Without a public key one-click install stays disabled (notice + manual download only).

## macOS app (Sparkle 2)
1. `./bin/generate_keys` from the Sparkle release → EdDSA key pair.
2. Repo **variable** `SPARKLE_PUBLIC_ED_KEY` (public), **secret** `SPARKLE_PRIVATE_KEY` (private).
3. CI writes `SUPublicEDKey` into Info.plist and creates a signed `appcast.xml`, which must be
   uploaded to the release (feed: `releases/latest/download/appcast.xml`).
4. Recommended: Apple Developer ID certificate + notarization (secrets `APPLE_DEVELOPER_ID_P12`,
   `APPLE_DEVELOPER_ID_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`); without them
   the app stays ad-hoc signed and Gatekeeper warns on first launch.

## Opt-out
Settings → update check (`updateCheck: false`) or `KMY_NO_UPDATE_CHECK=1`; also disables Sparkle
auto-checks. `KMY_NO_UPDATE_APPLY=1` ignores an installed update at startup.

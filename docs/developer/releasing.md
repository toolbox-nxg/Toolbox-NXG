# Releasing

## Versioning

Toolbox version numbers are identified by a major.minor.patch stable release identifier (e.g. `6.1.13`) and an incrementing build number within each stable release. Beta releases use the version number of the stable release they will eventually be a part of (i.e. prereleases should not use a major.minor.patch which is already used by a stable release). Whenever a release is first made on a new major.minor.patch version (beta or stable), the build number resets to 1; subsequent releases increment the build number further, including the final stable release.

Git tags of stable releases use only the major.minor.patch identifier with a `v` prefix (e.g. `v6.1.13`). Prereleases also include a `-beta.#` suffix, where `#` is the build number (e.g. `v7.0.0-beta.1`).

The manifest `version` field combines the major.minor.patch and the build number into a single four-segment version string (e.g. `6.1.13.1`). The `version_name` field uses only the major.minor.patch, in addition to whatever fun name is selected for the release (e.g. `6.1.13 "Delaying Donkey"`).

As an example, a release timeline might look something like this:

| Manifest `version` | Git tag          | Release type | Notes                                        |
| ------------------ | ---------------- | ------------ | -------------------------------------------- |
| `7.0.0.1`          | `v7.0.0-beta.1`  | beta         | Beta testing of 7.0.0 begins                 |
| `7.0.0.2`          | `v7.0.0-beta.2`  | beta         | Iteration in the beta channel                |
| `7.0.0.21`         | `v7.0.0-beta.21` | beta         | Last beta release of 7.0.0                   |
| `7.0.0.21`         | `v7.0.0`         | stable       | Same build then released as stable           |
| `7.0.1.1`          | `v7.0.1`         | stable       | Hotfixes can be released without a beta test |
| `7.1.0.1`          | `v7.1.0-beta.1`  | beta         | Development of 7.1.0 begins                  |

We generally only change the release name for major or minor bumps. Tradition dictates it should be an adjective and an animal that both start with the same letter.

## Tagging a New Release

1. Make sure the working directory is clear and you're on the `main` branch.
2. `firefox_manifest.json`'s `strict_min_version` is synced automatically by the release script (step 3): it reads the latest ESR from [Mozilla's product-details feed](https://product-details.mozilla.org/1.0/firefox_versions.json) and bumps the floor to that major version. If the latest ESR is _lower_ than the current floor (or the feed can't be reached), the script keeps the existing value and prints a notice -- no manual action needed unless you intend to override the floor. [The FF release calendar is here for reference](https://whattrainisitnow.com/calendar/).
3. Run `npm run release`. This script will prompt you for the new four-segment version number, then the release name. Every release is currently a beta and is tagged `vX.Y.Z-beta.<build>`, so there is no release-type prompt.
   - Ensure the major.minor.patch is set correctly. You should only need to update this when starting a new major.minor.patch.
   - Increment the build number by 1 from the previous release (reset it to 1 only when the major.minor.patch changes).
   - To run non-interactively, supply any of the values up front via CLI flags or environment variables; whatever you omit is still prompted for. Flags: `npm run release -- --version 8.0.0.4 --name "Forked Phoenix"`. Equivalent env vars: `RELEASE_VERSION`, `RELEASE_NAME`.

   The script will then automatically commit and tag the release in your local clone.
4. Verify that the commit created by the release script contains nothing except changes to the version strings in the manifest files (plus, if the ESR floor moved, Firefox's `strict_min_version`).
5. Push the commit and tag: `git push && git push --tags`. Pushing the tag is the only manual trigger; the [publish workflow](../../.github/workflows/publish.yml) takes it from there.

## What the publish workflow does

Pushing a `v*` tag runs [`publish.yml`](../../.github/workflows/publish.yml), which re-runs the full CI gate, builds production bundles, and publishes to a single public store listing per browser (Chrome `kglcfhgacmfabofjhbjlonpihkhonmkh`, Firefox `adhesivecheese@toolbox-team-nxg`).

Every tag currently publishes to **everyone**. The extension has no stable release yet, so all builds are betas shipped publicly (the bundle stamps `BUILD_TYPE: beta`, which surfaces "beta" in the version string). There is no separate testing track at the moment; if one is reintroduced later, branch the Chrome `action` and Firefox `self-hosted` inputs (and `BUILD_TYPE`) on the tag shape.

- **Firefox source review is automated:** AMO requires the source of bundled add-ons, so the workflow uploads a `git archive` of the tag (minus `docs/`) as `source-file-path` plus reviewer build instructions (`approval-notes`). No manual source upload.
- The workflow creates the GitHub release for the tag. Notes are generated from the commit history since the previous tag by [git-cliff](https://github.com/orhun/git-cliff) (config: [`cliff.toml`](../../cliff.toml)), which groups commits by their leading verb (`Add*` -> Added, `Fix*` -> Fixed, `Remove*` -> Removed, most others -> Changed). No draft needs to be staged ahead of time. To preview the notes _before_ tagging (while the commits are not yet on any tag) use `npx git-cliff --unreleased --strip all`; the workflow itself runs after the tag is pushed and so uses `--latest`. Hand-edit the notes on GitHub afterward if you want them curated. Good grouping depends on starting commit subjects with a clear verb.

You do not need to build or upload anything to the stores by hand. If you ever need the artifacts locally, `BUILD_TYPE=beta BUILD_SHA=$(git rev-parse HEAD) npm run build` writes per-platform zips to `build/toolbox-nxg-<platform>-<version>.zip` (requires the system `zip` command; if missing, the build warns and skips packaging).

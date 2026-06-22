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
2. Update `firefox_manifest.json`'s `strict_min_version` to the latest ESR version of Firefox. [Here's a link to the FF release calendar for reference](https://whattrainisitnow.com/calendar/).
3. Run `npm run release`. This script will prompt you for the new four-segment version number, then the release name.
   - Ensure the major.minor.patch is set correctly. You should only need to update this if the previous release was a stable release.
   - If the previous release was a beta release, increment the build number by 1. If the previous release was a stable release, instead reset the build number _to_ 1.

   The script will then automatically commit and tag the release in your local clone.
4. Verify that the commit created by the release script contains nothing except changes to the version strings in the manifest files.
5. Push the commit and tag: `git push && git push --tags`.
6. Build the release artifacts (`BUILD_TYPE=stable BUILD_SHA=$(git rev-parse HEAD) npm run build`). For `beta` and `stable` builds this also writes a per-platform zip to `build/toolbox-nxg-<platform>-<version>.zip` (e.g. `build/toolbox-nxg-chrome-8.0.0.2.zip`) ready for web store upload; upload these to the respective web stores and attach them to the [GitHub releases page](https://github.com/toolbox-nxg/toolbox-nxg/releases). (The zip step requires the system `zip` command; if it is missing the build prints a warning and skips packaging.)

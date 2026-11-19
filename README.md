# Episodes of Concern and Proximity-Viz

Static publication of Engineering Space Policy Laboratory interfaces:

- `dynamic-table/` browses the public Episodes of Concern records.
- `visualization/` presents the E-001 Luch (Olymp-K) and Athena-Fidus historical orbital reconstruction.
- `visualization/Viz/compare.html?episode=E-002` loads the shared page shell with four historical chapters and parallel A–B/C–B charts, where B is USA 245. Pairwise one-minute dwell counts use a 12-hour element-age gate; January USA 245 statistics are unavailable. Add `&dev=1` to open its in-page camera keyframe editor. The table miniature at `visualization/dev/e002/mini.html` uses a December 8 co-moving orbital frame and the saved “This one please” camera view. The original development playback and camera explorer remain available at `visualization/dev/e002/`.

Open `index.html` for navigation. All application paths are relative, so the site works at `https://thomasgroberts.github.io/proximity-viz/`.

## Local preview

From the directory containing this repository, run `python3 -m http.server 8770` and open `http://127.0.0.1:8770/proximity-viz-site/`. The table and visualization are available at `/proximity-viz-site/dynamic-table/` and `/proximity-viz-site/visualization/`. On GitHub Pages, the folder name is the repository name, `proximity-viz`.

## GitHub Pages

This is a static site with no build step. Pages is published by `.github/workflows/pages.yml`, which injects the comment backend URLs from repository secrets. In repository **Settings → Pages**, set **Source** to **GitHub Actions**, then add these repository secrets:

- `APPSCRIPT1_URL` — the Apps Script Web App URL that verifies logins against the `Auth` sheet.
- `APPSCRIPT2_URL` — the Apps Script Web App URL that reads and appends the `Comments` sheet.

The workflow rewrites `shared/comments/comment-secrets.js` before uploading the artifact, so the URLs stay out of the repository. It fails instead of publishing if either secret is missing. Never commit the real URLs.

The expected addresses are:

- `https://thomasgroberts.github.io/proximity-viz/`
- `https://thomasgroberts.github.io/proximity-viz/dynamic-table/`
- `https://thomasgroberts.github.io/proximity-viz/visualization/`
- `https://thomasgroberts.github.io/proximity-viz/visualization/Viz/compare.html?episode=E-002`
- `https://thomasgroberts.github.io/proximity-viz/visualization/dev/e002/`

Wait for the Pages deployment to finish, then open each address and check the E-001 visualization preview and the return link. Do not assume a URL is live until that check succeeds.

For local comment testing, set `window.APPSCRIPT1_URL` and `window.APPSCRIPT2_URL` before `comments.js` loads, or fill `shared/comments/comment-secrets.js` temporarily and revert it before committing.

## Data and attribution

On each load, the Dynamic Table fetches the published Episodes and Descriptions tabs by header name with browser caching disabled; E-001 visualization fetches the Episodes tab. The Episodes tab supplies current episode metadata and the inclusive UTC date interval. A Description record appears only when its ID is listed by the episode and its `Episode` cell matches that episode, so a blank association remains unlinked and the same URL can serve separate episodes. If the Episodes sheet is unavailable or its dates are invalid, the applications show a source error instead of presenting an older interval as current. The Dynamic Table's `data/table.json` supplies bundled source metadata, preview assets, and object information; its older description rows are superseded by the live tab. Titles, dates, publishers, and thumbnails are enriched offline from source URLs where available, then bundled in that file. The original local table server and its refresh utilities remain in the ESPL project workspace; local caches and unpublished research files are excluded from this repository.

The table computes E-001 minimum separation, minimum relative velocity, and dwell time from the public TLE histories at 15-minute intervals across the current sheet dates. The full visualization uses the same interval and analysis. `shared/e001-series.json` is an older archived sample and is not loaded by either application. Other episodes show an unavailable state until their orbital histories are reconstructed. The E-001 table preview runs a lightweight Earth-fixed relative scene using the same public TLEs and propagation method as Proximity-Viz, with a still image as a loading fallback. It mounts only while E-001 is expanded and disposes when the episode closes.

The orbital visualization is adapted from [Willa Madsen's *How Close Is Too Close?*](https://github.com/willamadsen/How-Close-Is-Too-Close). Her historical orbital elements, Three.js scene structure, and scientific implementation are credited here; this repository does not replace or modify her upstream project. The E-001 configuration documents the public TLE sources and the analysis limitations. Satellite positions are reconstructed from dated orbital elements; times without supported data are not interpolated as verified positions. Original third-party notices are retained in `visualization/Viz/vendor/satellite/LICENSE` and `visualization/Viz/assets/flags/LICENSE-flag-icons.txt`.

This repository contains only the two public E-001 TLE histories required for that reconstruction. E-002 retrieves checksum-pinned, already published historical subsets from Willa Madsen's project and commits no duplicate raw E-002 elements. E-002's [`episode.json`](visualization/dev/e002/episode.json) defines participants, supported windows, pair choices, thresholds, and data gates. The E-002 route shares the E-001 page shell and panel components; its scene and pair-series adapters remain episode-specific. A future step is to consolidate those controllers into one data-driven engine. Its static table snapshot and source thumbnails are public-facing data, with no credentials or local caches.

The bundled satellite identity fields and launch-site codes were fetched from CelesTrak SATCAT. Displayed launch-site names follow the lab's editorial naming convention for those codes, matching the CSIS spaceports work authored by the lab. The table snapshot retains both the raw CelesTrak codes and the editorial name map. The single visible SATCAT source link remains CelesTrak; the name expansion is a display convention. Orbital Details identify the selected TLE source separately. Space-Track historical queries use the selected element epoch and may require sign-in.

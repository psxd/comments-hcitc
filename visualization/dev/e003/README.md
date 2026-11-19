# E-003 full-view review draft

Local review: `http://127.0.0.1:8769/visualization/Viz/compare.html?dev=1&episode=E-003`

This draft uses the E-002/E-005 full-view layout, charts, playback controls, relative-motion scene, spot comments, and a low horizontal camera workshop. It reads the published Episodes sheet on load, including the author's changing chapter centers and widths. Only the two published participants are shown: USA 271 (41745, yellow) and SJ-20 (44910, gray). No public E-003 model link has been published yet.

Dated elements are from the author's Space-Track SATCAT export and an authenticated Space-Track GP_HISTORY retrieval. The query covers 2020-04-01 through 2020-11-20. USA 271 has 21 TLEs in that range; SJ-20 has 744. The selected TLE ages are shown in the expanded spacecraft details. The visualization is illustrative, and the sparse USA 271 observations make the August and October/November numerical reconstruction particularly sensitive to propagation.

E-003 spot comments share the local review comment store. Camera views are stored separately in `saved-camera-views.json` and can be exported from the camera workshop. The workshop asks for six relative-motion routes: three chapters × USA 271 or SJ-20 centered. ECI uses the orbital-plane normal and a fixed wide view, so it does not request camera opinions.

The E-003 Dynamic Table row is now available only in the local review at `http://127.0.0.1:8769/dynamic-table/?review=E-003`. Its mini scene begins in the August chapter using an author-saved camera angle, and the review ribbon can edit the loop and camera. The public table still excludes E-003 until it is approved for release.

## Camera export and latest review

The November 17 author export contains 344 camera views across all six relative-motion chapter/origin routes and matches the local saved view store exactly. The saved path is loaded automatically and interpolated between distinct timestamps; outside the saved timestamps, it holds the nearest author view. Representative start, quarter, midpoint, and end samples of all six routes kept both spacecraft visible. An additional 85-point check of the November USA 271-centered route found no hidden spacecraft.

The latest all-episode spot comment asked for complete launch-site names. E-003 now shows Cape Canaveral / Kennedy Space Center for USA 271 and Wenchang Satellite Launch Center for SJ-20; E-001, E-002, and E-005 already used complete names. The comment is archived and the active review list is empty.

The next all-episode spot comment requested dwell time in days and hours or hours and minutes. The active E-001, E-002, E-003, and E-005 full views now share a compact formatter (`d h` or `h min`). E-003's default full-view playback was already six simulated hours per real second, matching the other GEO full views. This comment is archived and the active review list is clear.

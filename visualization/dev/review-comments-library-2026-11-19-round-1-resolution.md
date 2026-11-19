# Dynamic Library review — November 19, 2026

- E-008 mini view: the local review server's save validation omitted this orbital asset, so Save requests were rejected and the published settings stayed old. Added the asset to validation, restarted the server, and verified a Save request returns HTTP 200. The user saved the angle again; copied that exact camera and viewport offset to the published mini settings.
- E-008 New York Times record: replaced the designed placeholder with ICEYE's original satellite concept image from its press site, and corrected the card click-through to the article's canonical URL. The exact Times feature image could not be fetched or independently matched because the Times blocks automated access.
- E-001 mini view: restored the cached reference-orbit geometry after a camera-frame switch.
- All mini previews: centered the loading motif in the area after the episode cell and above the records pane, with a full-width fallback when responsive layout stacks the cells.
- Public IDs: review links, review comment labels, mini settings exports, and visible error messages use current Episode IDs from the Episodes sheet. Orbital asset keys remain internal. A final check also corrected load-error messages in the E-004 through E-007 viewers.

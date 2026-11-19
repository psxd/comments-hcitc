# Shared glossary plan

The Dynamic Table already loads glossary text as part of its bundled table payload and renders glossary triggers in `dynamic-table/app.js`. The full visualization has separate presentation code in `visualization/Viz/compare.js` and its HTML. Future terms such as minimum separation, minimum relative velocity, and dwell time should have one canonical definition rather than two sets of copy.

Add `shared/glossary.json` with stable term IDs, a concise definition, optional long explanation, and optional source links. Have both pages load the same JSON and call a small shared rendering module that creates an accessible trigger and a single tooltip/dialog pattern. Keep each page's layout styling local. Link source-record terminology to the same IDs where possible. The Table's current bundled glossary fields can be migrated to those IDs once the wording is reviewed. This plan makes no user-facing glossary changes yet.

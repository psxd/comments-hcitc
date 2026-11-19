# November 19 review round

The 15 comments are preserved in `review-comments-2026-11-19-archived.json`; the active review pool was cleared after implementation.

- E-002 mini trails now fade at their oldest point. ECI playback holds one nearest TLE per object at the chapter anchor so the reconstructed path does not switch elements mid-chapter. A missing sample ends the older trail segment instead of drawing a bridge across it.
- E-001 ECI tails use the same fading shader and target opacity as E-002. Its default relative-velocity threshold is 10 m/s, and its local review starts playing at the first chapter's start.
- The E-003 and E-016 mini scenes fill the expanded-row edge; a row-wide color wash no longer dims their markers. E-005 and E-006 expanded rows omit the unplotted third object's dimmed header line. The E-006 description is feathered locally.
- E-005, E-006, and E-016 resize the canvas to the renderer's measured aspect ratio so mini globes remain round. E-003, E-008, and E-059 already used that sizing.
- Full episode panels have sheet-ordered previous and next links, wrapping at the ends. Every focus card except E-002 also shows the chapter period. E-059 minimum distances below 1 km display in meters, and minimum relative velocities display in m/s.
- The Dynamic Table now renders rows before starting reusable mini scenes and supplemental metric requests. Afterward it staggers three reusable mini scenes and prefetches versioned scripts and orbital element files in idle periods. Orbital data are still SHA-256 checked on load; the sheet is still fetched fresh on page load.
- The latest E-008 and E-059 mini-preview settings and the newly saved E-005 camera view were retained.

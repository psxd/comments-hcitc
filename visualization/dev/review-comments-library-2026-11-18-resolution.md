# Dynamic Library review, November 18, 2026

The 14 imported spot comments are preserved in `review-comments-library-2026-11-18-archived.json`. The active shared comment list was cleared for the next round. These changes are local review changes; they have not been pushed.

- Added E-006 to the review switcher on the library and all current episode review pages. The E-006 page retains its camera workshop and spot comments.
- Added space below the model action and record cards; aligned the action arrow with its text.
- Kept the Earth and reference orbit visible when an E-001 mini loop reaches an invalid propagated sample.
- Set mini globe dots to the same 12 CSS-pixel outlined size as the table's object dots, independent of camera zoom or viewport height. Mini trails now use the same 1.55-pixel half-width in E-001, E-002, E-003, and E-005.
- Kept the existing warm Earth tint, satellite pulse, and model-action animation linked to mini-scene hover. Extended the warm scene treatment across the expanded row while retaining a transparent overlay above the preloaded WebGL scenes.
- Extended the E-001, E-002, and E-005 mini scenes behind the record cards. E-003 now reaches the right edge and uses a 100-pixel overscan below its original viewport, with a projection correction to preserve the saved camera's apparent scale and position.
- Animated source-carousel changes so continuing cards shift into their new positions and entering/leaving cards slide at the edges.
- Corrected the source-card publisher to `VPK.name`; the Secure World Foundation fact sheet title and June 12, 2026 date; and the E-005 source dates June 30, 2022 and September 2024. The September date remains month-precision in the visible card.

Visual checks covered the E-001 and E-003 mini scenes and the E-006 full review page. DOM checks covered the E-002 carousel and the E-005 source dates.

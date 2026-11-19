# Shared review round 3 — Dynamic Library

The five E-001 miniature comments are preserved in `review-comments-round-3-archived.json`. This round changed the local Dynamic Library review only. The full E-001 and E-002 episode views were not reviewed or changed.

- The review ribbon now has X/Y camera-position nudges for the E-001 miniature. These move the scene in screen coordinates, and the existing Save preview control stores the resulting camera position and target.
- The E-001 miniature Earth uses a neutral warm brown at rest. Hover darkens only the Earth; the surrounding scene and orbit line are unchanged. The two satellite markers are larger and gently pulse during hover, subject to reduced-motion preference.
- The model invitation arrow uses the SBI project's inline text-sized arrow proportions and spacing.
- The E-001 miniature has no card border, including while its camera is being edited.
- The embedded E-001 scene mounts as soon as its module is ready; it no longer waits for the unrelated series-data request before appearing.

The five comments were removed from the active shared review file after implementation so the next local review begins empty.

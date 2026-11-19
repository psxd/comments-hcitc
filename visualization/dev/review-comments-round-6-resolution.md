# Shared review round 6 — camera workshop and Dynamic Library

The six Library comments are preserved in `review-comments-round-6-archived.json`. The active shared review file was cleared after this pass.

- E-001 and E-002 camera workshops now ask for relative-motion views only. Full-globe ECI uses a camera on the orbital-plane normal, framed to show the entire trajectory. E-002's automatic ECI framing also ignores learned camera views.
- Both full-episode review ribbons now expose **Export camera views**. The saved view files currently contain 12 E-001 and 68 E-002 views; their note fields are empty, so no written relative-motion camera notes are available in those files yet.
- The E-001 Library mini globe has a circular projection correction. Its country borders use a mipmapped map in the miniature to avoid the subpixel flicker of moving 3D line segments; the full episode keeps its existing borders.
- The Library mini editor separates **Camera X/Y** from **Scene X/Y**. Scene controls move the whole E-001 mini asset within its viewport, and the offset is saved with its preview configuration.
- The mini playback menu extends through **240 min/s**. Satellite trails render behind their dots. The arrow after the full-model link has more space and sits lower beside its label.

The local review server continues to use port 8769. These changes have not been applied to the published site.

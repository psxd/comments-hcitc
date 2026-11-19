# Shared review round 5 — Dynamic Library

The three comments are preserved in `review-comments-round-5-archived.json`.

- The E-001 miniature renderer now fills its iframe without the inset reserved for the hidden full-episode panel. A camera-facing limb shade gives its Earth a rounder appearance. The full episode renderer is unchanged.
- The E-001 miniature pins one nearest TLE for each satellite at the saved loop midpoint (or chapter anchor before a loop is saved). It propagates those same elements throughout playback and when the loop repeats. Selecting another chapter or changing the loop repins once for the new interval. The full episode keeps its normal nearest-TLE behavior.
- E-002's local Dynamic Library miniature now shares E-001's hover treatment: warm gray-brown Earth, subtle brown darkening of the Earth alone, and pulsing satellite dots. The previous whole-scene filter remains only as a fallback for the separate published E-002 mini renderer.
- The Library spot-comment form now offers **Apply to all table episodes**. The shared JSON records the choice in `appliesToAllEpisodes`; review lists distinguish it from a full-episode-wide comment.

The active shared review file was cleared after implementation.

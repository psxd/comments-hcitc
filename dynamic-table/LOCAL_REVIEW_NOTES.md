# Dynamic Table local review

## November 18 E-002 mini review

Round 11's six comments are archived in `../visualization/dev/review-comments-round-11-archived.json`. E-002 now keeps its 340-pixel scene iframe in the same screen position in both mini-editing and viewing modes; the expanded row no longer resizes the 3D scene or places a mask over it. The iframe, backdrop, and expanded card all use `#fffcf6`. The attached E-002 camera and loop already matched the local saved settings. The source grid becomes a three-card carousel when a fourth source exists, with the same chevron and expanding-dot motif as the lab research-area news carousel. Hovered source cards come to the front.

E-001's local mini preloads in a persistent offscreen iframe so expanding the row reveals an already-running scene. Its saved loop now uses the sheet's November 24 chapter (chapter 2) and pins one TLE per spacecraft throughout that loop. E-005's miniature omits the nonselected Shiyan 12 02 tail. The active shared review file is clear.

## November 18 follow-up

E-003 now has a review-only expanded row at `http://127.0.0.1:8769/dynamic-table/?review=E-003`, with a live two-object mini scene and the same spot comments, loop, chapter, and camera controls as the other local previews. The initial August loop uses an author-saved E-003 camera view and Space-Track names. The E-003 public model link and table approval remain pending review; this localhost row does not add E-003 to the published table.

Round 10's three Library comments are archived in `../visualization/dev/review-comments-round-10-archived.json`. Description cards now follow each Description row's comma-separated `Episode` tags, including D-041 for E-005, even if the Episodes row's `Descriptions` field omits that ID. D-041 has an actual first-page preview and title from the AMOS paper. E-005's table objects use exact Space-Track SATNAME values; the two Shiyan targets share gray dots, while the target not selected in the mini scene fades in the table cell as well. E-002's mini camera compensates for the expanded backdrop's larger height so the edited visual scale persists on first load and after closing the editor. The active shared comment file is clear.

## November 18 Library comments

The eight comments in `../visualization/dev/review-comments-round-9-archived.json` are implemented in the local Library review. The E-005 mini loop now pins one Space-Track TLE per spacecraft at the loop midpoint; changing its loop or chapter repins the trio. Mini scenes use the same warm Earth palette and screen-space dot/trail sizing. The exported E-001, E-002, and E-005 mini settings already matched `../visualization/dev/e002-control-panel-preview/table-preview.json`, so their saved cameras and loops were preserved.

The row title and description now come from the current Episodes sheet. The current E-005 sheet row has a title but no description, so the row shows the pending-description state until it is filled in. Description records with multiple comma-separated episode IDs are associated with each listed episode. The E-005 GlobalSecurity/Global Times source card uses a crop of the actual article masthead and headline; other sources without a capture show their recorded publisher and title in a source-record layout instead of a missing-image error. Description text sits in front of the mini-scene fade, and the model-link arrow is centered with its label. The active shared comment file was cleared after archiving this round.

The E-002 mini preview uses the saved camera and loop in `visualization/dev/e002-control-panel-preview/table-preview.json`. The current local design review is separate from the published table.

## Future mini scene controls

The **Adjust mini scene** bar now has X and Y arrow buttons for the E-001 miniature. Each press nudges the scene within its viewport while keeping the camera angle. **Save preview loop & camera** stores the adjusted position alongside the loop. E-002 keeps its existing mini camera controls.

The E-001 local ribbon also has an **Origin** selector for the two satellites in the relative-motion frame. The selected origin is stored in the saved mini camera. E-001 miniature labels are hidden, while full episode labels remain visible.

The E-001 mini scene now holds one TLE per satellite for its selected playback loop, chosen at the loop midpoint. Changing the chapter or loop chooses a new fixed pair. Both local mini scenes share globe-only hover darkening and a stronger marker pulse. Library spot comments can be marked **Apply to all table episodes**; that scope stays distinct from full-episode-wide feedback.

The latest shared round is recorded in `../visualization/dev/review-comments-round-6-resolution.md`. For E-001, **Camera X/Y** keeps the existing camera pan and **Scene X/Y** places the entire mini asset within the preview; save stores both. The menu reaches 240 min/s. Its Earth has a rounder projection and mipmapped country borders, and the satellite tails draw below their markers. The full ECI camera is automatic, while the workshop collects only relative-motion views. The full-episode ribbons now offer **Export camera views**.

Round 7 is recorded in `../visualization/dev/review-comments-round-7-resolution.md`. The mini editor now displays the last server save time and exports both saved settings and the current unsaved draft. E-002 supports the same Camera X/Y and Scene X/Y controls as E-001 and has no editing viewport outline. The local review switcher includes E-005, whose full reconstruction is documented in `../visualization/dev/e005/README.md`.

## Latest table review

The four latest comments are archived in `../visualization/dev/e002-control-panel-preview/table-comments-round-4-archived.json`. The reveal cue belongs at the **bottom-right** of each mini preview; the earlier bottom-left request was a misunderstanding. E-001's Period cell uses the same early/mid/late wording as legacy rows and now reads **Late 2017**. Both miniature globes have more visible country borders, with the full views unchanged. Object tooltips use the published field names and open beside stacked satellite names so switching between them does not require crossing the first tooltip.

The next single comment is archived in `../visualization/dev/e002-control-panel-preview/table-comments-round-5-archived.json`; the active table comment file is clear. E-001's mini scene now embeds the same satellite-centered renderer as the full E-001 visualization. The public table also reads the reviewed Space-Track identity extract and E-002 chapter metrics. The local review ribbon remains exclusive to the localhost review server on port 8769.

## Shared review pass

The three top links on port 8769 now connect the E-001 full review, E-002 full review, and Dynamic Library. The comment drawer reads the shared `visualization/dev/review-comments.json` record, retains its open state across those views while there are active comments, and sits beside the table when opened. The four latest Library comments were processed alongside the two E-001 and eight E-002 comments, then archived in `visualization/dev/review-comments-round-1-archived.json`. The active pane is clear for a fresh round.

This local pass makes the displayed episode count match the rows actually shown, enables direct camera and loop editing for E-001's mini scene as well as E-002's, keeps the visualization call to action visible below the episode description, and adds a gentle hover cue on the miniature. The call to action appears on E-001 and E-002; the other six current rows have no full model destination. Mini camera and loop choices are stored separately by episode. The review bar and comment drawer remain local-only.

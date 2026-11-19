# Shared review round 10: Dynamic Library

The three attached Library comments are preserved in `review-comments-round-10-archived.json`. The active shared review file contains zero comments.

- **E-002 mini:** the view-mode backdrop is much taller than the 340-pixel edit viewport. Its camera now adjusts its vertical field of view to keep the edited scene at the same on-screen scale. A software-WebGL browser check measured a 35° edit projection and an 85° full-backdrop projection, both on first load and after leaving edit mode.
- **E-005 objects:** the table uses the exact Space-Track `SATNAME` records. Both Shiyan target dots use the same gray; the nonselected target's whole line fades to 30%, matching the mini scene. The local mini exposes its selected slot so the table can follow a selection change.
- **Description cards:** the `Episode` tags in each Descriptions-sheet row determine which episodes display it. The published D-041 row tags E-002, E-005, E-029, and E-043; it now appears for E-005, with the paper's title and a rendered first page.

The local Library review remains at `http://127.0.0.1:8769/dynamic-table/?review=E-005`. No published site was deployed.

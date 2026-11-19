// Deployment overrides for the comment backend.
//
// This file is committed empty so the page never requests a missing module.
// .github/workflows/pages.yml rewrites it from the APPSCRIPT1_URL and
// APPSCRIPT2_URL repository secrets before publishing.
//
// Do not commit real URLs here. For local testing, set window.APPSCRIPT1_URL
// and window.APPSCRIPT2_URL before comments.js loads, or fill this file in
// temporarily and revert it before committing.
export const APPSCRIPT1_URL = "";
export const APPSCRIPT2_URL = "";

# New Findings

Review date: 2026-05-23

## Status

No new submission-review findings remain after the follow-up fixes.

## What was fixed

- The embedded map now uses the same-origin tile proxy instead of loading OpenStreetMap tiles directly from the browser.
- Widget CSP metadata was narrowed to remove external tile resource domains that are no longer needed.
- The privacy page was updated to describe the server-side tile fetch behavior accurately.
- `area-app-search` metadata in both the live tool descriptor and `chatgpt-app-submission.json` now matches its bootstrap-only `area-loading` behavior.
- A regression test now locks the narrowed CSP and the corrected `area-app-search` descriptor text.

## Verification

- `npm test`
- `npm run build`

Result on 2026-05-23: all checks passed locally and the submission review surface is green from source inspection.

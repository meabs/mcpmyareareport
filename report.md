# MyAreaReport Reliability Fix Report

Date: 2026-05-23

## Summary

This report records the reliability and submission-readiness work completed for the MyAreaReport MCP App.

## Fixed

| Area | Change |
|---|---|
| Fuel Finder auth | Switched OAuth token generation to JSON body `{ client_id, client_secret }` without the unsupported scope parameter |
| Fuel Finder batches | Accepts both raw array responses and wrapped `{ data: [...] }` responses |
| Fuel Finder keys | Normalizes fuel names to `E10`, `E5`, `B7_STANDARD`, `B7_PREMIUM`, `B10`, and `HVO` |
| Fuel Finder errors | Distinguishes `credentials_missing`, `auth_failed`, and `unavailable` |
| Local env | `npm run dev`, `npm start`, and `npm run start:stdio` load `.env` automatically if present |
| Output schemas | All model-visible and app-only tools now declare output schemas |
| Widget metadata | UI resource declares a stable widget domain and production CSP |
| Request logging | MCP tool calls no longer log raw user arguments such as postcodes/place names |
| Tile proxy | Tile coordinates are validated before proxying to OpenStreetMap |
| Readiness | Added `/ready` endpoint for build and Fuel Finder configuration checks |
| Tests | Added Fuel Finder regression tests and Apps SDK metadata tests |

## Live Fuel Finder Verification

A live test with temporary credentials successfully loaded the Fuel Finder station database and returned nearby stations for Westminster.

Observed result:

- station database loaded: 7,908 stations
- nearby stations returned: 20
- canonical fuel keys present: `E10`, `E5`, `B7_STANDARD`, `B7_PREMIUM`

Temporary credentials used for verification should be rotated before submission.

## Remaining Recommendations

- Add golden prompt tests in ChatGPT Developer Mode.
- Add source freshness/status indicators to the UI.
- Add persistent/shared rate limiting for multi-instance production deployments.
- Consider a durable cache or scheduled refresh job for DfT and Fuel Finder data.
- Add production monitoring for upstream API latency, non-200 rates and cache warmup failures.

## Verification Commands

```bash
npm test
npm run build
```


# MyAreaReport Reliability and Day-One App Review Recommendations

Review date: 2026-05-23

Implementation status: the highest-priority issues from this review have been addressed on `codex/reliability-fixes`: Fuel Finder auth/batch parsing, output schemas, production widget domain/CSP, safer MCP logging, tile validation, `.env` loading, `/ready`, and regression tests.

Scope: local review of the current Node/Vite MCP app, with OpenAI Apps SDK submission guidance checked against current official docs.

## Executive Summary

MyAreaReport is a credible read-only ChatGPT app candidate: the product has a clear UK-local use case, uses official/public data sources, provides an embedded UI, and already has submission metadata in `chatgpt-app-submission.json`.

The main day-one risk is reliability, not product concept. Most user-facing behavior depends on live third-party APIs, several upstream failures are silently converted to empty datasets, and the automated test suite currently covers an older card-demo module rather than the active area intelligence tools. Before submission, I would prioritize deterministic error handling, output schema enforcement, observability, and a golden-prompt review set.

## OpenAI Apps SDK Review Context

Relevant current OpenAI guidance:

- ChatGPT apps run as MCP Apps inside sandboxed iframes and should prefer standard MCP Apps keys such as `_meta.ui.resourceUri` and `ui/*` bridge behavior, with ChatGPT-specific extensions treated as optional. Source: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- Public app submission requires a working MCP endpoint, app name, logo, description, company/privacy URLs, MCP/tool information, screenshots, test prompts and responses, and localization information. Source: https://developers.openai.com/apps-sdk/deploy/submission
- Common rejection reasons include OpenAI being unable to connect to the MCP server or use supplied review credentials. Source: https://developers.openai.com/apps-sdk/deploy/submission
- Metadata strongly affects tool invocation. OpenAI recommends a labelled prompt set covering direct, indirect, and negative prompts, then repeated developer-mode evaluation for precision and recall. Source: https://developers.openai.com/apps-sdk/guides/optimize-metadata
- Apps should validate all inputs server-side, redact PII in logs, keep audit/debug correlation IDs, monitor anomalous traffic, and keep dependencies patched. Source: https://developers.openai.com/apps-sdk/guides/security-privacy
- Tool annotations such as `readOnlyHint`, `destructiveHint`, and `openWorldHint` influence ChatGPT framing, but the server must still enforce authorization and safety logic. Source: https://developers.openai.com/apps-sdk/reference
- App submission requires `_meta.ui.domain` / widget domain metadata for the component origin. Source: https://developers.openai.com/apps-sdk/reference

## High-Priority Reliability Recommendations

1. Add real tests for the active area-data app.

   Current tests in `test/demo-data.test.js` exercise `src/demo-data.js`, which appears unrelated to the MyAreaReport tools. Add unit tests for `src/area-data.js`, integration tests for each registered MCP tool in `src/server.js`, and fixture-backed tests for upstream API failures. This is the largest reliability gap because the app can pass `npm test` while none of the submitted area tools are checked.

2. Attach and enforce output schemas on tool descriptors.

   `src/server.js` defines detailed `OUT_OVERVIEW`, `OUT_CRIME`, `OUT_FLOOD`, `OUT_PROPERTY`, `OUT_ROADS`, and `OUT_FUEL` schemas, but the registered tools do not appear to include `outputSchema`. OpenAI's reference notes that `structuredContent` must match the declared output schema when one is provided. Add these schemas to the descriptors and validate returned payloads in tests before submission.

3. Standardize upstream error semantics.

   Several fetch helpers return empty arrays for network or API failures, for example Police UK and Environment Agency calls in `src/area-data.js`. This can make "API failed" look identical to "no crimes" or "no flood alerts". Return explicit source-level statuses such as `ok`, `unavailable`, `partial`, and `stale`, then surface them in both `structuredContent` and assistant text.

4. Add timeouts to every outbound request.

   Some calls use `AbortSignal.timeout`, but core paths such as `geocodePostcode`, `fetchCrimes`, `fetchStopSearch`, `fetchFloodAlerts`, `fetchFloodStations`, and `fetchStationReading` do not. A slow upstream can hold an MCP tool call open and create poor ChatGPT review behavior. Set bounded timeouts per source and use an overall tool-call deadline.

5. Add retry policy and circuit breakers per upstream.

   The app calls Postcodes.io, Police UK, Environment Agency, Land Registry, WebTRIS, DfT, Fuel Finder, and OSM. Use short retries for transient `429`, `502`, `503`, and network resets, but avoid retry storms. Add a per-source circuit breaker so one failing provider does not degrade all tools or exhaust the process.

6. Fix request logging before public review.

   `/mcp` currently logs full tool arguments in `src/index.js`. A postcode is not usually highly sensitive, but it can still be location data. Redact or hash raw postcodes, add request IDs, and log source status/latency rather than raw user inputs. The privacy page says user-submitted postcodes are not stored; logs should match that claim.

7. Make rate limiting production-safe.

   The current in-memory IP limiter resets every minute and will not work consistently across multiple instances, restarts, or proxy misconfiguration. Put rate limiting at the edge or in shared storage, normalize trusted proxy headers, and return MCP-shaped errors consistently. Keep separate limits for `/mcp`, `/api/area`, and tile proxy traffic.

8. Harden the tile proxy.

   `/api/tiles/:z/:x/:y` accepts unbounded route params and forwards to OSM. Validate numeric tile coordinates and zoom ranges, add cache controls aligned with OSM tile policy, and consider using a proper tile provider or a static-map fallback for production review.

9. Persist warm caches or prebuild large lookup data.

   `warmupCaches()` preloads Fuel Finder and DfT data in memory. This helps a warm process, but cold starts and restarts still require large upstream fetches. For day one, consider a scheduled background cache refresh, a durable cache layer, or a build/deploy-time snapshot for DfT count points.

10. Add health checks that reflect dependency readiness.

   `/health` currently returns only process status. Add `/ready` or richer health output for build artifact availability, cache readiness, Fuel Finder credential presence, and recent upstream failures. Keep sensitive details out of public responses, but expose them to monitoring.

## API and Tooling Recommendations

1. Use consistent postcode/place resolution across LLM-visible tools.

   App-only `area-app-search` accepts place names and outcodes via `resolveInputToPostcode`, but LLM-visible tools mostly require a postcode. For better ChatGPT invocation, either allow all public tools to accept `query` or clearly constrain metadata to full UK postcodes. This will reduce failed calls on prompts like "crime in Chester".

2. Declare app-only tools carefully in submission metadata.

   `chatgpt-app-submission.json` includes both LLM-visible and app-only tools. That may be fine if the review form asks for all tools, but make sure app-only tools are marked as UI-only in the live descriptors and have test cases that prove they are not chosen for normal chat prompts.

3. Add `_meta.ui.domain` for the app component origin.

   The resource metadata currently declares CSP domains but not a dedicated widget domain. OpenAI's reference says `_meta.ui.domain` is required for app submission. Add the production component origin when ready.

4. Add ChatGPT compatibility aliases where useful.

   The app uses standard `_meta.ui.resourceUri`, which is good for portability. For ChatGPT-specific review stability, consider adding compatibility metadata such as `openai/outputTemplate`, `openai/widgetDescription`, and invocation status strings where supported by the SDK.

5. Narrow CSP before submission.

   The resource CSP includes public API domains and localhost. For the production submission, remove localhost from production metadata, proxy API calls server-side where possible, and keep the iframe CSP as small as the UI actually needs.

6. Review `openWorldHint`.

   The tools query public third-party APIs using user-provided area input. The current `openWorldHint: false` can be defensible because the tools are read-only and do not publish or mutate state, but document this rationale clearly in the submission. If OpenAI interprets "reaches outside" broadly, be ready to set it to `true` for public network reads.

7. Align submission JSON with the actual production app.

   `chatgpt-app-submission.json` is currently untracked according to `git status`. Ensure the final submission artifact matches the deployed descriptors, exact MCP endpoint, privacy URL, screenshots, and tested prompts. Do not let stale demo metadata survive into review.

## Data Quality and User Trust Recommendations

1. Show data freshness per source.

   Crime data, flood alerts, property sales, traffic, and fuel prices refresh on different schedules. Every returned payload and UI tab should show the source timestamp or data month. This is especially important for safety-adjacent crime and flood answers.

2. Avoid overclaiming "real-time".

   The README and manifest use "real-time" broadly. Some sources are live-ish, some are monthly, and Land Registry sales are delayed. Use more precise language: "latest available official data" with source-specific freshness.

3. Replace the fixed national crime average with contextual caveats.

   `NATIONAL_AVG_MONTHLY = 30` is a rough heuristic. It should be labelled as an estimate or replaced with a more defensible baseline by force area, population, postcode density, or comparable radius.

4. Treat approximate place-name results as approximate everywhere.

   Outcode/place-name lookup uses a random postcode in an outcode. That is useful for exploration but can mislead users if not prominent. Keep the approximation flag in every downstream tool call and in model-visible summaries.

5. Keep emergency/safety disclaimers targeted.

   Flood warnings and crime/safety outputs should not pretend to be emergency guidance. Add concise language in the UI and tool summaries that users should check official emergency sources for immediate risk.

## Day-One Feature Recommendations

These are not all required for submission, but they would improve first-user value and review confidence.

1. "Source and freshness" panel.

   Add a compact panel listing each source, latest timestamp/month, API status, and whether data is complete, partial, stale, or unavailable. This directly addresses trust and support burden.

2. Shareable report summary.

   Provide a model-visible concise report users can ask ChatGPT to reuse: area, month, top crime categories, flood status, property summary, road/fuel highlights, and caveats. Keep it read-only and avoid storing user data.

3. Comparison mode.

   Let users compare two postcodes or a postcode against a nearby/UK baseline. This is likely a strong day-one feature because users naturally ask "is this area better than X?" and it reuses existing data sources.

4. Commute and live disruption layer.

   Road traffic is already present. A day-one differentiator would be adding rail/tube/bus disruption data or a simple "commute risk" view for common routes. Only add this if reliable official APIs are available and it can be clearly caveated.

5. Saved examples for review and demos.

   Add built-in example prompts/locations that are known to produce representative data across crime, flood, property, roads, and fuel. This helps reviewers see the app working even if a random postcode has sparse data.

6. Accessibility and mobile review checklist.

   The app should be tested in ChatGPT iframe sizes, mobile safe areas, keyboard navigation, reduced motion, and high contrast. This is not a feature users request directly, but it improves review quality and public launch polish.

## Suggested Pre-Submission Checklist

- Run a hosted MCP endpoint from a clean production environment and verify OpenAI can connect.
- Remove localhost from production CSP and add `_meta.ui.domain`.
- Add output schemas to registered tools and validate all `structuredContent`.
- Add deterministic tests for each area tool with mocked upstreams.
- Add developer-mode golden prompt tests covering direct, indirect, and negative prompts.
- Confirm privacy policy matches actual logs and retention.
- Add source freshness, partial-failure states, and user-visible caveats.
- Verify screenshots, logo, app description, privacy URL, and test prompts match the deployed app.
- Load-test cold start, DfT warmup, Fuel Finder cache load, and repeated ChatGPT tool calls.
- Document support contacts, monitoring, alerting, and rollback procedure.

## Priority Order

1. Testing and schema enforcement.
2. Upstream timeout/error handling and observability.
3. Submission metadata alignment, including `_meta.ui.domain` and production CSP.
4. Golden prompt evaluation in ChatGPT developer mode.
5. Data freshness/caveat UI.
6. Comparison mode and other new day-one features.

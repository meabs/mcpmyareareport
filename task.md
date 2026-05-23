# MyAreaReport Product and Architecture Brief

Status: submission-readiness draft  
Date: 2026-05-23

## Purpose

MyAreaReport is a read-only ChatGPT MCP App for exploring UK area intelligence from public and official data sources. Users enter a UK postcode, outcode or place name and receive an embedded dashboard covering crime, flood warnings, property prices, road traffic and fuel prices.

## Scope

In scope:

- UK postcode and place-based lookup
- interactive MCP App UI
- model-visible tools for direct user prompts
- app-only tools for tab loading and search form interactions
- official/public data APIs
- no user accounts and no persistent user-submitted location storage

Out of scope for day one:

- saving reports
- emailing or messaging reports
- paid property valuations
- insurance, mortgage, legal or emergency advice
- international area data
- write actions against third-party systems

## Data Sources

| Domain | Source |
|---|---|
| Postcode geocoding | Postcodes.io |
| Crime and stop/search | Police UK API |
| Flood warnings and river stations | Environment Agency flood monitoring API |
| Property prices | HM Land Registry Price Paid SPARQL endpoint |
| Motorway/trunk road traffic | National Highways WebTRIS |
| Local A-road count points | DfT road traffic API |
| Fuel prices | GOV.UK Fuel Finder |
| Map tiles | OpenStreetMap |

## Tool Surface

Model-visible tools:

- `area-search`
- `area-crime`
- `area-flood`
- `area-property`
- `area-roads`
- `area-fuel`

App-only tools:

- `area-app-search`
- `area-app-crime`
- `area-app-flood`
- `area-app-property`
- `area-app-roads`
- `area-app-fuel`

All tools are read-only and declare output schemas. Tool arguments should not be logged in production.

## Reliability Requirements

- Every outbound API request must have a bounded timeout.
- Fuel Finder must support JSON OAuth and wrapped `{ data: [...] }` batch responses.
- Empty upstream Fuel Finder batches should surface as `unavailable`, not as "no nearby stations".
- Widget CSP should be narrow for production.
- `/ready` should report build artifact readiness and Fuel Finder configuration presence.
- Tests should cover Fuel Finder parsing, output schema registration and widget metadata.

## Submission Requirements

- Production MCP endpoint: `https://mcp.myareareport.com/mcp`
- Privacy policy: `https://mcp.myareareport.com/privacy`
- Logo: `https://mcp.myareareport.com/logo.png`
- Stable widget domain configured with `MCP_APP_UI_DOMAIN`
- `chatgpt-app-submission.json` aligned with live tool names and test prompts


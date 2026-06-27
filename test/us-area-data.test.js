import test from "node:test";
import assert from "node:assert/strict";

import {
  getUsAreaReport,
  getUsPropertyData,
  isLikelyUsInput,
  resolveUsInput,
} from "../src/us-area-data.js";

function mockUsFetch(t) {
  t.mock.method(globalThis, "fetch", async (url) => {
    const value = String(url);
    if (value.includes("tigerWMS_Current/MapServer/2/query")) {
      return Response.json({
        features: [{
          attributes: {
            ZCTA5: "10001",
            GEOID: "10001",
            INTPTLAT: "40.7506",
            INTPTLON: "-73.9972",
          },
        }],
      });
    }
    if (value.includes("State_County/MapServer/1/query")) {
      return Response.json({
        features: [{
          attributes: {
            NAME: "New York County",
            STATE: "36",
            COUNTY: "061",
            GEOID: "36061",
          },
        }],
      });
    }
    if (value.includes("api.weather.gov/alerts/active")) {
      return Response.json({ features: [] });
    }
    if (value.includes("waterservices.usgs.gov/nwis/site")) {
      return new Response("# no stations\n", { status: 200 });
    }
    if (value.includes("api.eia.gov/v2/petroleum/pri/gnd/data")) {
      return Response.json({
        response: {
          data: [{ value: "3.215", period: "2026-06-22" }],
        },
      });
    }
    if (value.includes("fred.stlouisfed.org/graph/fredgraph.csv")) {
      return new Response("observation_date,NYSTHPI\n2021-01-01,900.0\n2025-01-01,1100.0\n2026-01-01,1155.0\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  });
}

test("detects supported USA inputs without catching UK place names", () => {
  assert.equal(isLikelyUsInput("10001"), true);
  assert.equal(isLikelyUsInput("Miami, FL"), true);
  assert.equal(isLikelyUsInput("Austin TX"), true);
  assert.equal(isLikelyUsInput("1600 Pennsylvania Ave NW, Washington, DC 20500"), true);
  assert.equal(isLikelyUsInput("Chester"), false);
  assert.equal(isLikelyUsInput("SW1A 2AA"), false);
});

test("resolves a USA ZIP using Census metadata", async (t) => {
  mockUsFetch(t);

  const area = await resolveUsInput("10001");

  assert.equal(area.countryCode, "US");
  assert.equal(area.postcode, "10001");
  assert.equal(area.zip, "10001");
  assert.equal(area.state, "NY");
  assert.equal(area.county, "New York County");
});

test("builds a USA overview without retaining or requiring raw lookup credentials", async (t) => {
  delete process.env.CENSUS_API_KEY;
  delete process.env.FBI_API_KEY;
  delete process.env.DATA_GOV_API_KEY;
  delete process.env.NREL_API_KEY;
  mockUsFetch(t);

  const report = await getUsAreaReport("10001");

  assert.equal(report.kind, "area-overview");
  assert.equal(report.area.countryCode, "US");
  assert.equal(report.crime.status, "unavailable");
  assert.equal(report.flood.source, "National Weather Service and USGS Water Data");
  assert.equal(report.fuel.status, "ok");
  assert.equal(report.fuel.cheapest.E10.price, 3.215);
});

test("USA housing falls back to FHFA state HPI when ACS credentials are absent", async (t) => {
  delete process.env.CENSUS_API_KEY;
  mockUsFetch(t);

  const property = await getUsPropertyData("10001");

  assert.equal(property.kind, "area-property");
  assert.equal(property.area.countryCode, "US");
  assert.equal(property.error, undefined);
  assert.equal(property.hpi.latestIndex, 1155);
  assert.equal(property.hpi.oneYearChangePct, 5);
  assert.match(property.source, /FHFA House Price Index/);
  assert.match(property.caveat, /state-level/);
});

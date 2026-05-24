import test from "node:test";
import assert from "node:assert/strict";

const MODULE_URL = "../src/area-data.js";

async function importFreshAreaData() {
  return import(`${MODULE_URL}?t=${Date.now()}-${Math.random()}`);
}

function withFuelEnv() {
  process.env.FUEL_FINDER_CLIENT_ID = "test-client-id";
  process.env.FUEL_FINDER_CLIENT_SECRET = "test-client-secret";
}

function withoutFuelEnv() {
  delete process.env.FUEL_FINDER_CLIENT_ID;
  delete process.env.FUEL_FINDER_CLIENT_SECRET;
}

test("fuel prices load from wrapped Fuel Finder responses and canonicalise fuel keys", async (t) => {
  withFuelEnv();

  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    requests.push({ url: String(url), options });

    if (String(url).endsWith("/oauth/generate_access_token")) {
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(options.body), {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
      });
      return Response.json({ data: { access_token: "token", expires_in: 3600 } });
    }

    if (String(url).includes("/api/v1/pfs?batch-number=1")) {
      return Response.json({
        success: true,
        data: [{
          node_id: "station-1",
          trading_name: "Central Fuel",
          brand_name: "TestBrand",
          public_phone_number: "01234",
          is_supermarket_service_station: false,
          location: {
            latitude: "51.5000",
            longitude: "-0.1200",
            postcode: "SW1A 1AA",
          },
        }],
      });
    }

    if (String(url).includes("/api/v1/pfs/fuel-prices?batch-number=1")) {
      return Response.json({
        success: true,
        data: [{
          node_id: "station-1",
          trading_name: "Central Fuel",
          public_phone_number: "01234",
          fuel_prices: [
            { fuel_type: "unleaded", price: "139.9", price_change_effective_timestamp: "2026-05-22T10:00:00Z" },
            { fuel_type: "diesel", price: 146.5, price_change_effective_timestamp: "2026-05-22T10:05:00Z" },
          ],
        }],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices, formatToolResultText } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.equal(result.kind, "area-fuel");
  assert.equal(result.status, "ok");
  assert.equal(result.error, undefined);
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].prices.E10, 139.9);
  assert.equal(result.stations[0].prices.B7_STANDARD, 146.5);
  assert.equal(result.cheapest.E10.name, "Central Fuel");
  assert.equal(result.cheapest.B7_STANDARD.price, 146.5);
  assert.match(formatToolResultText("area-fuel", result), /Cheapest diesel/);
  assert.equal(requests.some(r => String(r.url).includes("/api/v1/pfs?batch-number=1")), true);
});

test("fuel prices return auth_failed for rejected Fuel Finder credentials", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/oauth/generate_access_token")) {
      return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.deepEqual(result, {
    kind: "area-fuel",
    status: "unavailable",
    reason: "auth_failed",
    stations: [],
    cheapest: {},
    error: "auth_failed",
  });
});

test("fuel prices return auth_failed when Fuel Finder reports invalid credentials in the JSON body", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/oauth/generate_access_token")) {
      return Response.json({
        success: false,
        data: {
          success: false,
          data: null,
          message: "Invalid client credentials",
          error: { code: 401, details: null },
        },
        message: { code: 401, details: null },
        error: { code: 401, details: { code: 401, details: null } },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices, formatToolResultText } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.deepEqual(result, {
    kind: "area-fuel",
    status: "unavailable",
    reason: "auth_failed",
    stations: [],
    cheapest: {},
    error: "auth_failed",
  });
  assert.equal(
    formatToolResultText("area-fuel", result),
    "Fuel price data: API credentials were rejected by Fuel Finder.",
  );
});

test("fuel prices report unavailable when upstream fuel batches are empty", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/oauth/generate_access_token")) {
      return Response.json({ data: { access_token: "token", expires_in: 3600 } });
    }
    if (String(url).includes("/api/v1/pfs")) {
      return Response.json({ data: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.deepEqual(result, {
    kind: "area-fuel",
    status: "unavailable",
    reason: "upstream_unavailable",
    stations: [],
    cheapest: {},
    error: "upstream_unavailable",
  });
});

test("fuel prices return credentials_missing when Fuel Finder env is absent", async () => {
  withoutFuelEnv();

  const { getFuelPrices } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.deepEqual(result, {
    kind: "area-fuel",
    status: "unavailable",
    reason: "credentials_missing",
    stations: [],
    cheapest: {},
    error: "credentials_missing",
  });
});

test("fuel prices return auth_failed when auth response JSON is invalid", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/oauth/generate_access_token")) {
      return new Response("{", { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "auth_failed");
  assert.equal(result.error, "auth_failed");
});

test("fuel prices return no_results when no station is within radius", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/oauth/generate_access_token")) {
      return Response.json({ data: { access_token: "token", expires_in: 3600 } });
    }
    if (String(url).includes("/api/v1/pfs?batch-number=1")) {
      return Response.json({ data: [{
        node_id: "station-1",
        trading_name: "Remote Fuel",
        location: { latitude: "55.9533", longitude: "-3.1883", postcode: "EH1 1AA" },
      }] });
    }
    if (String(url).includes("/api/v1/pfs/fuel-prices?batch-number=1")) {
      return Response.json({ data: [{
        node_id: "station-1",
        fuel_prices: [{ fuel_type: "unleaded", price: 139.9 }],
      }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getFuelPrices } = await importFreshAreaData();
  const result = await getFuelPrices(51.5, -0.12);

  assert.deepEqual(result, {
    kind: "area-fuel",
    status: "no_results",
    reason: "no_sites_in_radius",
    stations: [],
    cheapest: {},
    error: "no_sites_in_radius",
  });
});

test("area overview includes fuel data so the widget can render fuel without a second round trip", async (t) => {
  withFuelEnv();

  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const href = String(url);

    if (href.includes("api.postcodes.io/postcodes/")) {
      return Response.json({
        result: {
          postcode: "M1 1AE",
          latitude: 53.483487,
          longitude: -2.231182,
          admin_district: "Manchester",
          admin_ward: "Piccadilly",
          admin_county: "Manchester",
          region: "North West",
          country: "England",
          pfa: "Greater Manchester",
        },
      });
    }

    if (href.endsWith("/crime-last-updated")) {
      return Response.json({ date: "2026-03-31" });
    }

    if (href.includes("/crimes-street/all-crime?")) {
      return Response.json(Array.from({ length: 10 }, (_, idx) => ({
        category: idx < 5 ? "other-theft" : "violent-crime",
        location: { latitude: "53.4831", longitude: "-2.2349" },
      })));
    }

    if (href.includes("/stops-street?")) {
      return Response.json([{ object_of_search: "Stolen goods" }]);
    }

    if (href.includes("/id/floods")) {
      return Response.json({ items: [] });
    }

    if (href.includes("/id/stations?")) {
      return Response.json({ items: [] });
    }

    if (href.endsWith("/oauth/generate_access_token")) {
      assert.equal(options.headers["Content-Type"], "application/json");
      return Response.json({ data: { access_token: "token", expires_in: 3600 } });
    }

    if (href.includes("/api/v1/pfs?batch-number=1")) {
      return Response.json({
        data: [{
          node_id: "station-1",
          trading_name: "Central Fuel",
          brand_name: "TestBrand",
          public_phone_number: "01234",
          is_supermarket_service_station: false,
          location: {
            latitude: "53.4830",
            longitude: "-2.2300",
            postcode: "M1 1AE",
          },
        }],
      });
    }

    if (href.includes("/api/v1/pfs/fuel-prices?batch-number=1")) {
      return Response.json({
        data: [{
          node_id: "station-1",
          fuel_prices: [
            { fuel_type: "unleaded", price: "139.9", price_change_effective_timestamp: "2026-05-22T10:00:00Z" },
            { fuel_type: "diesel", price: 146.5, price_change_effective_timestamp: "2026-05-22T10:05:00Z" },
          ],
        }],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  const { getAreaReport } = await importFreshAreaData();
  const result = await getAreaReport("M1 1AE");

  assert.equal(result.kind, "area-overview");
  assert.equal(result.fuel?.kind, "area-fuel");
  assert.equal(result.fuel?.status, "ok");
  assert.equal(result.fuel?.error, undefined);
  assert.equal(result.fuel?.stations.length, 1);
  assert.equal(result.fuel?.cheapest?.E10?.name, "Central Fuel");
});

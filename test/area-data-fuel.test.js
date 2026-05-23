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

  assert.deepEqual(result, { kind: "area-fuel", stations: [], error: "auth_failed" });
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

  assert.deepEqual(result, { kind: "area-fuel", stations: [], error: "unavailable" });
});


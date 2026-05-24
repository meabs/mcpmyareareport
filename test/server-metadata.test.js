import test from "node:test";
import assert from "node:assert/strict";

async function importFreshServer() {
  return import(`../src/server.js?t=${Date.now()}-${Math.random()}`);
}

test("all registered app tools declare output schemas", async (t) => {
  delete process.env.FUEL_FINDER_CLIENT_ID;
  delete process.env.FUEL_FINDER_CLIENT_SECRET;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/count-points")) return Response.json({ data: [], last_page: 1 });
    throw new Error(`Unexpected fetch during server import: ${url}`);
  });

  const { createServer } = await importFreshServer();
  const server = createServer();
  const toolNames = [
    "area-search",
    "area-crime",
    "area-flood",
    "area-property",
    "area-roads",
    "area-fuel",
    "area-app-search",
    "area-app-crime",
    "area-app-flood",
    "area-app-property",
    "area-app-fuel",
    "area-app-roads",
  ];

  for (const name of toolNames) {
    assert.ok(server._registeredTools[name], `${name} should be registered`);
    assert.ok(server._registeredTools[name].outputSchema, `${name} should declare outputSchema`);
  }
});

test("UI resource declares a stable production widget domain and narrow CSP", async (t) => {
  delete process.env.FUEL_FINDER_CLIENT_ID;
  delete process.env.FUEL_FINDER_CLIENT_SECRET;
  process.env.MCP_APP_UI_DOMAIN = "https://mcp.myareareport.com";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/count-points")) return Response.json({ data: [], last_page: 1 });
    throw new Error(`Unexpected fetch during server import: ${url}`);
  });

  const { createServer } = await importFreshServer();
  const server = createServer();
  const resource = server._registeredResources["ui://myareareport/app.html"];

  assert.ok(resource, "UI resource should be registered");
  const uiMeta = resource.metadata._meta.ui;

  assert.equal(uiMeta.domain, "https://mcp.myareareport.com");
  assert.equal(resource.metadata._meta["openai/widgetDomain"], "https://mcp.myareareport.com");
  assert.deepEqual(uiMeta.csp.connectDomains, ["https://mcp.myareareport.com"]);
  assert.deepEqual(uiMeta.csp.resourceDomains, ["https://mcp.myareareport.com"]);
  assert.equal(uiMeta.csp.connectDomains.includes("http://localhost:3001"), false);
  assert.equal(uiMeta.csp.connectDomains.includes("https://data.police.uk"), false);
});

test("area-app-search metadata matches its bootstrap-only behavior", async (t) => {
  delete process.env.FUEL_FINDER_CLIENT_ID;
  delete process.env.FUEL_FINDER_CLIENT_SECRET;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/count-points")) return Response.json({ data: [], last_page: 1 });
    throw new Error(`Unexpected fetch during server import: ${url}`);
  });

  const { createServer } = await importFreshServer();
  const server = createServer();
  const tool = server._registeredTools["area-app-search"];

  assert.ok(tool, "area-app-search should be registered");
  assert.equal(
    tool.description,
    "Resolve a postcode or place name entered in the search form and return area metadata for app bootstrap.",
  );
});

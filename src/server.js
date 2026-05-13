import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CHANNELS,
  CUSTOMER_TYPES,
  EMPLOYMENT_STATUSES,
  NEEDS,
  createApplicationJourney,
  getCardRecommendations,
  getDemoPayload,
  runEligibilityCheck,
} from "./demo-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const RESOURCE_URI = "ui://embedded-sales/demo.html";

async function readBundledAppHtml() {
  const candidatePaths = [
    path.join(DIST_DIR, "mcp-app.html"),
    path.join(DIST_DIR, "src", "mcp-app.html"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return await fs.readFile(candidatePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error("Bundled MCP App HTML was not found. Run `npm run build` first.");
}

function summaryTextForDemo(payload) {
  return [
    `${payload.hero.title} for ${payload.brand.name}.`,
    `Recommended lead offer: ${payload.eligibility.recommendedCard?.name ?? "Refer to assisted journey"}.`,
    `Architecture phases: ${payload.architecturePhases.map((phase) => phase.title).join(", ")}.`,
  ].join(" ");
}

export function createServer() {
  const server = new McpServer({
    name: "Verdant Bank Embedded Sales Demo",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "embedded-sales-demo",
    {
      title: "Open embedded sales demo",
      description:
        "Launch the Verdant Bank embedded sales MCP App with card discovery, eligibility and onboarding mockups.",
      inputSchema: {
        channel: z.enum(CHANNELS.map((item) => item.id)).optional(),
        need: z.enum(NEEDS.map((item) => item.id)).optional(),
        creditBand: z.enum(["fair", "good", "excellent"]).optional(),
        annualIncome: z.number().optional(),
        employmentStatus: z.enum(EMPLOYMENT_STATUSES.map((item) => item.id)).optional(),
        existingCustomer: z.boolean().optional(),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
        },
      },
    },
    async (args) => {
      const payload = getDemoPayload(args);
      return {
        content: [{ type: "text", text: summaryTextForDemo(payload) }],
        structuredContent: payload,
      };
    },
  );

  registerAppTool(
    server,
    "recommend-embedded-card",
    {
      title: "Recommend embedded card",
      description:
        "Return card discovery recommendations for a partner channel and customer need.",
      inputSchema: {
        channel: z.enum(CHANNELS.map((item) => item.id)),
        need: z.enum(NEEDS.map((item) => item.id)),
        existingCustomer: z.boolean().optional(),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
        },
      },
    },
    async (args) => {
      const payload = getCardRecommendations(args);
      return {
        content: [
          {
            type: "text",
            text: `Top discovery recommendation: ${payload.cards[0]?.name ?? "No matching card"}.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  registerAppTool(
    server,
    "run-eligibility-check",
    {
      title: "Run eligibility check",
      description:
        "Simulate embedded eligibility orchestration for a card applicant profile.",
      inputSchema: {
        creditBand: z.enum(["fair", "good", "excellent"]),
        annualIncome: z.number(),
        employmentStatus: z.enum(EMPLOYMENT_STATUSES.map((item) => item.id)),
        existingCustomer: z.boolean().optional(),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
        },
      },
    },
    async (args) => {
      const payload = runEligibilityCheck(args);
      return {
        content: [
          {
            type: "text",
            text: payload.recommendedCard
              ? `${payload.decision}: ${payload.recommendedCard.name}`
              : "Refer applicant for assisted review or an alternative proposition.",
          },
        ],
        structuredContent: payload,
      };
    },
  );

  registerAppTool(
    server,
    "prepare-application-journey",
    {
      title: "Prepare application journey",
      description:
        "Generate the onboarding and fulfilment steps for a selected card and customer type.",
      inputSchema: {
        cardId: z.enum(["verdant-everyday", "verdant-travel", "verdant-foundations"]),
        customerType: z.enum(CUSTOMER_TYPES.map((item) => item.id)),
        leadSource: z.enum(CHANNELS.map((item) => item.id)),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
        },
      },
    },
    async (args) => {
      const payload = createApplicationJourney(args);
      return {
        content: [
          {
            type: "text",
            text: `Prepared ${payload.customerType} onboarding flow for ${payload.card.name}.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  registerAppResource(
    server,
    "Embedded Sales Demo UI",
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Verdant Bank embedded sales UI mockups for card acquisition.",
    },
    async () => {
      const html = await readBundledAppHtml();

      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}

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
  CARDS,
  CUSTOMER_TYPES,
  EMPLOYMENT_STATUSES,
  createApplicationJourney,
  getCardRecommendations,
  getDemoPayload,
  runEligibilityCheck,
} from "./demo-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const RESOURCE_URI = "ui://blackwell/app.html";

async function readBundledAppHtml() {
  const candidatePaths = [
    path.join(DIST_DIR, "mcp-app.html"),
    path.join(DIST_DIR, "src", "mcp-app.html"),
  ];
  for (const candidatePath of candidatePaths) {
    try {
      return await fs.readFile(candidatePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Bundled MCP App HTML not found. Run `npm run build` first.");
}

const CARD_IDS = /** @type {[string, ...string[]]} */ (CARDS.map((c) => c.id));

export function createServer() {
  const server = new McpServer({
    name: "Blackwell Bank Card Services",
    version: "1.0.0",
  });

  // ── Scenario 1: Full sales UI ─────────────────────────────────────────────
  registerAppTool(
    server,
    "blackwell-browse-cards",
    {
      title: "Browse Blackwell Bank cards",
      description:
        "Opens the full Blackwell Bank interactive card UI — browse cards, check eligibility, and apply. Call this as the ONLY Blackwell tool; never call it alongside blackwell-card-detail, blackwell-check-eligibility, or blackwell-apply.",
      inputSchema: {
        need: z.enum(["everyday-spend", "travel", "credit-building"]).optional(),
        creditBand: z.enum(["fair", "good", "excellent"]).optional(),
        annualIncome: z.number().optional(),
        employmentStatus: z.enum(EMPLOYMENT_STATUSES.map((i) => i.id)).optional(),
        existingCustomer: z.boolean().optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const payload = getDemoPayload(args);
      const cardNames = payload.recommendations.cards.map((c) => c.name).join(" and ");
      return {
        content: [{ type: "text", text: `Blackwell Bank cards: ${cardNames}.` }],
        structuredContent: payload,
      };
    },
  );

  // ── Scenario 2: Single card detail fragment ───────────────────────────────
  registerAppTool(
    server,
    "blackwell-card-detail",
    {
      title: "Blackwell Bank card details",
      description:
        "Shows a focused detail panel for one specific Blackwell Bank card. Use INSTEAD OF blackwell-browse-cards when the user asks about a single card only, not the full catalogue.",
      inputSchema: {
        cardId: z.enum(CARD_IDS).optional(),
        existingCustomer: z.boolean().optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const recommendations = getCardRecommendations({ existingCustomer: args.existingCustomer });
      const selectedCard = args.cardId
        ? CARDS.find((c) => c.id === args.cardId)
        : recommendations.cards[0];
      return {
        content: [{ type: "text", text: `Showing ${selectedCard?.name ?? "card"} details.` }],
        structuredContent: {
          ...recommendations,
          mode: "card-detail",
          selectedCardId: selectedCard?.id ?? recommendations.cards[0]?.id,
        },
      };
    },
  );

  // ── Scenario 3: Eligibility widget fragment ───────────────────────────────
  registerAppTool(
    server,
    "blackwell-check-eligibility",
    {
      title: "Check Blackwell Bank card eligibility",
      description:
        "Shows only the Blackwell Bank eligibility result widget for given profile details. Use INSTEAD OF blackwell-browse-cards when the user wants only an eligibility check, not the full catalogue.",
      inputSchema: {
        creditBand: z.enum(["fair", "good", "excellent"]),
        annualIncome: z.number(),
        employmentStatus: z.enum(EMPLOYMENT_STATUSES.map((i) => i.id)),
        cardId: z.enum(CARD_IDS).optional(),
        existingCustomer: z.boolean().optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const payload = runEligibilityCheck(args);
      const outcome = payload.decision === "pre-qualified" ? "likely eligible" : "referred for review";
      return {
        content: [
          {
            type: "text",
            text: payload.recommendedCard
              ? `Eligibility: ${outcome} for ${payload.recommendedCard.name}.`
              : "Eligibility: referred for manual review.",
          },
        ],
        structuredContent: payload,
      };
    },
  );

  // ── Scenario 4: Application stepper fragment ──────────────────────────────
  registerAppTool(
    server,
    "blackwell-apply",
    {
      title: "Apply for a Blackwell Bank card",
      description:
        "Shows only the Blackwell Bank application form. Use INSTEAD OF blackwell-browse-cards when the user explicitly asks to apply for a specific card directly.",
      inputSchema: {
        cardId: z.enum(CARD_IDS).optional(),
        customerType: z.enum(CUSTOMER_TYPES.map((i) => i.id)).optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const payload = createApplicationJourney({
        cardId: args.cardId ?? "blackwell-rewards",
        customerType: args.customerType ?? "new-to-bank",
        leadSource: "digital-banking",
      });
      return {
        content: [{ type: "text", text: `Starting application for ${payload.card.name}.` }],
        structuredContent: payload,
      };
    },
  );

  // ── App-only: card selection (hidden from LLM) ────────────────────────────
  registerAppTool(
    server,
    "blackwell-select-card",
    {
      title: "Select card",
      description: "Switch the selected card in the catalogue view.",
      inputSchema: {
        cardId: z.enum(CARD_IDS),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["app"],
        },
      },
    },
    async (args) => {
      const card = CARDS.find((c) => c.id === args.cardId) ?? CARDS[0];
      const recommendations = getCardRecommendations();
      return {
        content: [{ type: "text", text: `Selected ${card.name}.` }],
        structuredContent: {
          kind: "card-selected",
          mode: "card-detail",
          selectedCardId: card.id,
          recommendations,
        },
      };
    },
  );

  // ── App-only: application form submission (hidden from LLM) ───────────────
  registerAppTool(
    server,
    "blackwell-submit-application",
    {
      title: "Submit application",
      description: "Submit the card application form and return a confirmation payload.",
      inputSchema: {
        cardId: z.enum(CARD_IDS),
        applicantName: z.string().optional(),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["app"],
        },
      },
    },
    async (args) => {
      const card = CARDS.find((c) => c.id === args.cardId) ?? CARDS[0];
      return {
        content: [
          {
            type: "text",
            text: `Application submitted for ${card.name}. Decision expected within minutes.`,
          },
        ],
        structuredContent: {
          kind: "application-submitted",
          mode: "application",
          submitted: true,
          cardId: card.id,
          cardName: card.name,
          applicantName: args.applicantName ?? "Alex",
        },
      };
    },
  );

  // ── UI resource ───────────────────────────────────────────────────────────
  registerAppResource(
    server,
    "Blackwell Bank Card Services UI",
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Blackwell Bank card services UI — card discovery, eligibility and application.",
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

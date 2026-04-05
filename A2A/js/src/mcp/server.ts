// ================= MCP SERVER ENTRY POINT =================
// Starts the DynDisc MCP server with stdio transport.
// Registers all 5 tools. Zero business logic here.

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  ComputeDDRateSchema,
  CalcDiscountSchema,
  GenerateDDOfferSchema,
  handleComputeDDRate,
  handleCalcDiscount,
  handleGenerateDDOffer,
} from "./tools/dd-tools.js";

import {
  SubmitActusSchema,
  handleSubmitActus,
} from "./tools/actus-tools.js";

import {
  GetSummarySchema,
  handleGetDDSummary,
} from "./tools/summary-tools.js";

// ── Startup validation ────────────────────────────────────────────────────────
// NOTE: GROQ_API_KEY is NOT needed by any MCP tool.
// Tools 1-3 use pure math (dd-calculator.ts).
// Tool 4 uses direct HTTP calls to ACTUS.
// Tool 5 reads in-memory state.
// ACTUS URLs are the only required env vars.

if (!process.env.ACTUS_URL || !process.env.ACTUS_RISK_URL) {
  console.error(
    "[DynDisc MCP] WARNING: ACTUS_URL or ACTUS_RISK_URL not set. " +
    "Falling back to defaults: http://34.203.247.32:8083 and http://34.203.247.32:8082. " +
    "Tool 4 (submit_dd_to_actus) may fail if ACTUS servers are unreachable."
  );
}

// ── Create MCP Server ─────────────────────────────────────────────────────────

const server = new McpServer({
  name:    process.env.MCP_SERVER_NAME    ?? "dynd-disc-server",
  version: process.env.MCP_SERVER_VERSION ?? "1.0.0",
});

// ── Tool 1: compute_dd_rate ───────────────────────────────────────────────────

server.tool(
  "compute_dd_rate",
  "Calculate the maximum safe discount rate a seller can offer for early payment. " +
  "Input: agreed price, seller floor price, optional safety factor (default 0.5). " +
  "Output: safe discount rate, percentage, profit per unit, and plain English explanation.",
  {
    agreed_price:  z.number().positive().describe("Price both parties agreed on, e.g. 370"),
    margin_price:  z.number().positive().describe("Seller's absolute cost floor, e.g. 350"),
    safety_factor: z.number().min(0).max(1).optional().describe("Fraction of margin to give away, default 0.5"),
  },
  async (input) => {
    try {
      const result = handleComputeDDRate(input);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error in compute_dd_rate: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 2: calculate_early_payment_discount ─────────────────────────────────

server.tool(
  "calculate_early_payment_discount",
  "Given a settlement date, calculate the exact discount amount and savings for early payment. " +
  "Uses a linear sliding scale: more days early = larger discount. " +
  "Input: invoice total, max discount rate (from compute_dd_rate), invoice date, due date, settlement date. " +
  "Output: days early, applied rate, discounted amount, saving amount.",
  {
    invoice_total:     z.number().positive().describe("Full bill amount including GST, e.g. 873200"),
    max_discount_rate: z.number().min(0).max(1).describe("Max discount rate from compute_dd_rate, e.g. 0.027027"),
    invoice_date:      z.string().describe("Invoice date in YYYY-MM-DD format"),
    due_date:          z.string().describe("Payment due date in YYYY-MM-DD format"),
    settlement_date:   z.string().describe("Buyer's chosen early payment date in YYYY-MM-DD format"),
  },
  async (input) => {
    try {
      const result = handleCalcDiscount(input);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error in calculate_early_payment_discount: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: generate_dd_offer ────────────────────────────────────────────────

server.tool(
  "generate_dd_offer",
  "Build the complete Dynamic Discounting offer object that the seller sends to the buyer. " +
  "Includes the full sliding scale table showing discount for every possible payment date. " +
  "Automatically stores the negotiation in memory for later retrieval via get_dd_summary.",
  {
    invoice_id:           z.string().describe("Invoice ID, e.g. INV-1774467379154"),
    negotiation_id:       z.string().describe("Negotiation ID, e.g. NEG-1774466532237"),
    agreed_price:         z.number().positive().describe("Negotiated price per unit"),
    margin_price:         z.number().positive().describe("Seller's cost floor per unit"),
    quantity:             z.number().positive().describe("Units ordered"),
    gst_rate:             z.number().min(0).max(1).optional().describe("GST rate, default 0.18"),
    payment_terms_days:   z.number().int().positive().optional().describe("Payment term in days, default 30"),
    proposed_early_days:  z.number().int().min(0).optional().describe("Seller's proposed early payment day, default 10"),
  },
  async (input) => {
    try {
      const result = handleGenerateDDOffer(input);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error in generate_dd_offer: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 4: submit_dd_to_actus ────────────────────────────────────────────────

server.tool(
  "submit_dd_to_actus",
  "Run the 4-step ACTUS simulation after buyer accepts the DD offer. " +
  "Steps: (1) add reference index, (2) add early settlement model, " +
  "(3) add scenario, (4) run PAM contract simulation. " +
  "Returns simulation events, contract ID, and confirmed final payoff amount.",
  {
    invoice_id:        z.string().describe("Invoice ID — used as ACTUS contract ID"),
    negotiation_id:    z.string().describe("Negotiation ID — used to derive unique ACTUS scenario IDs"),
    invoice_date:      z.string().describe("Invoice date in YYYY-MM-DD format"),
    due_date:          z.string().describe("Payment due date in YYYY-MM-DD format"),
    settlement_date:   z.string().describe("Buyer's chosen early payment date in YYYY-MM-DD format"),
    invoice_total:     z.number().positive().describe("Full invoice amount including GST"),
    max_discount_rate: z.number().min(0).max(1).describe("Safe DD rate from compute_dd_rate"),
    seller_revenue:    z.number().positive().describe("Seller revenue — used as ACTUS reference index baseline"),
    hurdle_rate:       z.number().min(0).max(1).optional().describe("Hurdle rate, default 0.075 (7.5%)"),
  },
  async (input) => {
    try {
      const result = await handleSubmitActus(input);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
        isError: !result.success,
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error in submit_dd_to_actus: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 5: get_dd_summary ────────────────────────────────────────────────────

server.tool(
  "get_dd_summary",
  "Return a complete plain-English audit of any negotiation's dynamic discounting deal. " +
  "Shows invoice details, DD offer made, buyer decision, ACTUS result, and a narrative summary. " +
  "Only works for negotiations created in the current session via generate_dd_offer.",
  {
    negotiation_id: z.string().describe("The negotiation ID to look up, e.g. NEG-1774466532237"),
  },
  async (input) => {
    try {
      const result = handleGetDDSummary(input);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error in get_dd_summary: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// ── Connect transport and start ───────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(
  `[DynDisc MCP] Server running — ACTUS: ${process.env.ACTUS_URL ?? "http://34.203.247.32:8083"}`
);

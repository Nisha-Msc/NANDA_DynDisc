// ================= MCP SERVER — SSE TRANSPORT =================
// 13 tools exposed over HTTP/SSE for remote access (NEST/OpenClaw/HTTP-based MCP clients).
//
// Usage:
//   npx tsx src/mcp/server-sse.ts
//   → Server listening on http://0.0.0.0:3100/sse
//
// Railway sets PORT automatically. Locally defaults to 3100.

import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

import { handleComputeDDRate, handleCalcDiscount, handleGenerateDDOffer } from "./tools/dd-tools.js";
import { handleSubmitActus } from "./tools/actus-tools.js";
import { handleGetDDSummary } from "./tools/summary-tools.js";
import { handleNegotiate } from "./tools/negotiate-tools.js";
import { handleVerifyAgent, handleGetMarketData, handleGetDelegationStatus } from "./tools/vlei-market-tools.js";
import { handleLookupGleifEntity, LookupGleifEntitySchema } from "./tools/gleif-tools.js";
import { handleConsultTreasury } from "./tools/treasury-tools.js";
import { handleGetBuyerAgentCard, handleGetSellerAgentCard } from "./tools/agent-card-tools.js";
import { sessionMemory } from "./session-memory.js";

// Railway sets PORT automatically. Locally defaults to 3100.
const PORT = parseInt(process.env.PORT ?? process.env.MCP_SSE_PORT ?? "3100");

if (!process.env.ACTUS_URL || !process.env.ACTUS_RISK_URL) {
  console.error("[DynDisc MCP-SSE] WARNING: ACTUS_URL or ACTUS_RISK_URL not set.");
}

// ── Helper ────────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ── Register all 10 tools on a new McpServer instance ─────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name:    process.env.MCP_SERVER_NAME    ?? "dynd-disc-server",
    version: process.env.MCP_SERVER_VERSION ?? "2.0.0",
  });

  // Tool 1: negotiate_price
  server.tool(
    "negotiate_price",
    "Negotiate a price for goods between buyer and seller. " +
    "Uses rule-based constraints: seller floor ₹350, target ₹385; buyer budget ₹400, target ₹330. " +
    "Returns ACCEPT, COUNTER, or REJECT with reasoning and next step.",
    {
      role:         z.string().describe("'buyer' or 'seller'"),
      offer_price:  z.number().positive().describe("The price being offered"),
      round:        z.number().int().min(1).max(3).describe("Current round (1-3)"),
      margin_price: z.number().positive().optional(),
      target_price: z.number().positive().optional(),
      max_budget:   z.number().positive().optional(),
      quantity:     z.number().positive().optional(),
    },
    async (input) => {
      try {
        const result = handleNegotiate(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 2: compute_dd_rate
  server.tool(
    "compute_dd_rate",
    "Calculate the maximum safe discount rate for early payment.",
    {
      agreed_price:  z.number().positive().optional(),
      margin_price:  z.number().positive().optional(),
      safety_factor: z.number().min(0).max(1).optional(),
    },
    async (input) => {
      try {
        const deal = sessionMemory.getCurrentDeal();
        const agreed = input.agreed_price ?? deal?.agreedPrice;
        const margin = input.margin_price ?? deal?.marginPrice ?? 350;
        if (!agreed) return { content: [{ type: "text", text: "Error: No agreed_price. Run negotiate_price first." }], isError: true };
        const result = handleComputeDDRate({ agreed_price: agreed, margin_price: margin, safety_factor: input.safety_factor });
        sessionMemory.updateCurrentDeal({ safeDDRate: result.safeDDRate, marginPrice: margin });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 3: calculate_early_payment_discount
  server.tool(
    "calculate_early_payment_discount",
    "Calculate exact discount amount for early payment.",
    {
      invoice_total:     z.number().positive().optional(),
      max_discount_rate: z.number().min(0).max(1).optional(),
      invoice_date:      z.string().optional(),
      due_date:          z.string().optional(),
      settlement_date:   z.string().optional(),
    },
    async (input) => {
      try {
        const deal = sessionMemory.getCurrentDeal();
        const total = input.invoice_total ?? deal?.invoiceTotal;
        const rate = input.max_discount_rate ?? deal?.safeDDRate;
        const invDate = input.invoice_date ?? deal?.invoiceDate ?? new Date().toISOString().split("T")[0];
        if (!total || !rate) return { content: [{ type: "text", text: "Error: Missing invoice_total or max_discount_rate." }], isError: true };
        const actualDue = input.due_date ?? deal?.dueDate ?? addDays(invDate, 30);
        const actualSettle = input.settlement_date ?? deal?.settlementDate ?? addDays(invDate, 10);
        const result = handleCalcDiscount({ invoice_total: total, max_discount_rate: rate, invoice_date: invDate, due_date: actualDue, settlement_date: actualSettle });
        sessionMemory.updateCurrentDeal({ settlementDate: actualSettle, discountedAmount: result.discountedAmount, savingAmount: result.savingAmount, appliedRate: result.appliedRate, daysEarly: result.daysEarly });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 4: generate_dd_offer
  server.tool(
    "generate_dd_offer",
    "Build the complete DD offer with sliding scale table.",
    {
      invoice_id:          z.string().optional(),
      negotiation_id:      z.string().optional(),
      agreed_price:        z.number().positive().optional(),
      margin_price:        z.number().positive().optional(),
      quantity:            z.number().positive().optional(),
      gst_rate:            z.number().min(0).max(1).optional(),
      payment_terms_days:  z.number().int().positive().optional(),
      proposed_early_days: z.number().int().min(0).optional(),
    },
    async (input) => {
      try {
        const deal = sessionMemory.getCurrentDeal();
        const agreed = input.agreed_price ?? deal?.agreedPrice;
        const margin = input.margin_price ?? deal?.marginPrice ?? 350;
        const qty = input.quantity ?? deal?.quantity ?? 2000;
        const negId = input.negotiation_id ?? deal?.negotiationId ?? `NEG-${Date.now()}`;
        const invId = input.invoice_id ?? `INV-${Date.now()}`;
        if (!agreed) return { content: [{ type: "text", text: "Error: No agreed_price." }], isError: true };
        const result = handleGenerateDDOffer({ invoice_id: invId, negotiation_id: negId, agreed_price: agreed, margin_price: margin, quantity: qty, gst_rate: input.gst_rate, payment_terms_days: input.payment_terms_days, proposed_early_days: input.proposed_early_days });
        const invoiceTotal = result.invoice?.total ?? agreed * qty * 1.18;
        const invoiceDate = result.invoice?.invoiceDate ?? new Date().toISOString().split("T")[0];
        const dueDate = result.invoice?.dueDate ?? addDays(invoiceDate, 30);
        sessionMemory.updateCurrentDeal({ invoiceId: invId, invoiceTotal, invoiceDate, dueDate, status: "DD_OFFERED" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 5: submit_dd_to_actus
  server.tool(
    "submit_dd_to_actus",
    "Run ACTUS PAM simulation to validate settlement.",
    {
      invoice_id:        z.string().optional(),
      negotiation_id:    z.string().optional(),
      invoice_date:      z.string().optional(),
      due_date:          z.string().optional(),
      settlement_date:   z.string().optional(),
      invoice_total:     z.number().positive().optional(),
      max_discount_rate: z.number().min(0).max(1).optional(),
      seller_revenue:    z.number().positive().optional(),
      hurdle_rate:       z.number().min(0).max(1).optional(),
    },
    async (input) => {
      try {
        const deal = sessionMemory.getCurrentDeal();
        const invId = input.invoice_id ?? deal?.invoiceId ?? `INV-${Date.now()}`;
        const negId = input.negotiation_id ?? deal?.negotiationId ?? `NEG-${Date.now()}`;
        const invDate = input.invoice_date ?? deal?.invoiceDate ?? new Date().toISOString().split("T")[0];
        const dueDate = input.due_date ?? deal?.dueDate ?? addDays(invDate, 30);
        const settleDate = input.settlement_date ?? deal?.settlementDate ?? addDays(invDate, 10);
        const total = input.invoice_total ?? deal?.invoiceTotal;
        const rate = input.max_discount_rate ?? deal?.safeDDRate;
        const revenue = input.seller_revenue ?? total;
        if (!total || !rate) return { content: [{ type: "text", text: "Error: Missing invoice_total or max_discount_rate." }], isError: true };
        const result = await handleSubmitActus({ invoice_id: invId, negotiation_id: negId, invoice_date: invDate, due_date: dueDate, settlement_date: settleDate, invoice_total: total, max_discount_rate: rate, seller_revenue: revenue!, hurdle_rate: input.hurdle_rate });
        sessionMemory.updateCurrentDeal({ actusStatus: result.success ? "SUCCESS" : "FAILED", actusContractId: result.contractId, actusEvents: result.events, status: "SETTLED" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 6: get_dd_summary
  server.tool(
    "get_dd_summary",
    "Return a complete audit of the deal — from negotiation through settlement.",
    { negotiation_id: z.string().optional() },
    async (input) => {
      try {
        const deal = sessionMemory.getCurrentDeal();
        const negId = input.negotiation_id ?? deal?.negotiationId;
        if (!negId) return { content: [{ type: "text", text: "Error: No negotiation_id and no deal in memory." }], isError: true };
        let ddSummary: any = null;
        try { ddSummary = handleGetDDSummary({ negotiation_id: negId }); } catch {}
        const sessionSummary = deal ? {
          negotiationId: deal.negotiationId, status: deal.status,
          negotiation: { rounds: deal.rounds, agreedPrice: deal.agreedPrice, quantity: deal.quantity },
          discounting: { safeDDRate: deal.safeDDRate, invoiceTotal: deal.invoiceTotal, discountedAmount: deal.discountedAmount, savingAmount: deal.savingAmount, daysEarly: deal.daysEarly },
          actus: { status: deal.actusStatus, contractId: deal.actusContractId },
          timeline: { invoiceDate: deal.invoiceDate, settlementDate: deal.settlementDate, dueDate: deal.dueDate },
          priceHistoryAllDeals: sessionMemory.getPriceHistory(),
        } : null;
        return { content: [{ type: "text", text: JSON.stringify({ ddToolsSummary: ddSummary, sessionMemorySummary: sessionSummary }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 7: verify_agent_vlei
  server.tool(
    "verify_agent_vlei",
    "Verify an agent's vLEI delegation chain via KERI cryptographic proof.",
    {
      agent_type:        z.enum(["seller", "buyer"]),
      verification_type: z.enum(["DEEP", "DEEP-EXT"]).optional(),
    },
    async (input) => {
      try {
        const result = await handleVerifyAgent(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 8: get_market_data
  server.tool(
    "get_market_data",
    "Fetch real-time market data: SOFR rate from Federal Reserve FRED API, ICE Cotton #2 " +
    "futures from Yahoo Finance, USD/INR FX rate from FRED. Returns the current snapshot " +
    "plus a commodity-adjusted margin price and SOFR-adjusted safety factor for use in " +
    "downstream negotiation and dynamic-discounting decisions.",
    {},
    async () => {
      try {
        const result = await handleGetMarketData({});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 9: get_delegation_status
  server.tool(
    "get_delegation_status",
    "Get the full vLEI delegation chain status for all agents.",
    {},
    async () => {
      try {
        const result = await handleGetDelegationStatus();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 10: lookup_gleif_entity
  server.tool(
    "lookup_gleif_entity",
    "Look up a legal entity in the GLEIF Global LEI Index (the global registry of " +
    "legal entities recognized by financial regulators worldwide). Returns entity status, " +
    "registration status, legal form, country, and addresses. Use this as the FIRST step " +
    "in any procurement deal to confirm both buyer and seller are real registered companies. " +
    "Provide the company's legal name (REQUIRED). LEI and country are OPTIONAL but improve " +
    "match accuracy. Source: api.gleif.org (public, no auth, citable).",
    LookupGleifEntitySchema.shape,
    async (input) => {
      try {
        const result = await handleLookupGleifEntity(input);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 11: consult_treasury
  server.tool(
    "consult_treasury",
    "Consult JUPITER KNITTING COMPANY's Treasury Agent (delegated from Chief Sales Officer via vLEI) " +
    "for cash-flow approval on a proposed deal. The treasury agent runs a real ACTUS PAM cash-flow " +
    "simulation against current liquidity and returns: approval/rejection decision, NPV of the deal, " +
    "net profit (after working-capital financing cost), projected minimum cash balance, and a full " +
    "ACTUS event schedule (production outflow + invoice collection). Call this BEFORE accepting a " +
    "large purchase order to verify the deal won't breach Jupiter's safety threshold. " +
    "Source: Live Jupiter Treasury Agent on AWS (real ACTUS PAM, real cash flow model).",
    {
      negotiation_id: z.string().describe("Negotiation/deal identifier"),
      price_per_unit: z.number().positive().describe("Price per unit in INR"),
      quantity:       z.number().positive().describe("Number of units"),
      payment_terms:  z.number().int().positive().optional().describe("Payment terms in days (default 30)"),
      round:          z.number().int().positive().optional().describe("Negotiation round (default 1)"),
    },
    async (input) => {
      try {
        const result = await handleConsultTreasury({
          negotiationId: input.negotiation_id,
          pricePerUnit:  input.price_per_unit,
          quantity:      input.quantity,
          paymentTerms:  input.payment_terms,
          round:         input.round,
        });
        const isError = result.error != null || result.http_status === 0;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 12: get_buyer_agent_card
  server.tool(
    "get_buyer_agent_card",
    "Fetch the live A2A agent card for the Tommy Hilfiger Buyer Agent on AWS. " +
    "Returns the full agent card JSON plus a 'highlights' summary that surfaces the cryptographic " +
    "trust chain: Tommy's LEI, KERI agent identifiers (AIDs), the verified vLEI delegation path " +
    "(GLEIF ROOT → QVI → Tommy Hilfiger Europe B.V. → Chief Procurement Officer → buyer agent), " +
    "OOR holder, and verification status. Use this to PROVE that the buyer agent is cryptographically " +
    "delegated from a real, named human officer at a real GLEIF-registered legal entity. " +
    "Source: Live A2A agent at http://54.84.215.140:9090 (override via BUYER_AGENT_URL).",
    {},
    async () => {
      try {
        const result = await handleGetBuyerAgentCard();
        const isError = result.error != null || result.http_status === 0;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // Tool 13: get_seller_agent_card
  server.tool(
    "get_seller_agent_card",
    "Fetch the live A2A agent card for the Jupiter Knitting Seller Agent on AWS. " +
    "Returns the full agent card JSON plus a 'highlights' summary surfacing Jupiter's LEI, " +
    "KERI agent identifiers, and the verified vLEI delegation path " +
    "(GLEIF ROOT → QVI → Jupiter Knitting Company → Chief Sales Officer → seller agent). " +
    "Use this together with get_buyer_agent_card and lookup_gleif_entity to demonstrate the " +
    "end-to-end accountability chain from the global legal-entity registry down to the autonomous " +
    "agents acting on behalf of the firms. " +
    "Source: Live A2A agent at http://54.84.215.140:8080 (override via SELLER_AGENT_URL).",
    {},
    async () => {
      try {
        const result = await handleGetSellerAgentCard();
        const isError = result.error != null || result.http_status === 0;
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  return server;
}

// ── Express + SSE Transport ───────────────────────────────────────────────────

const app = express();
app.use(cors());

// Track active transports for cleanup
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  console.error(`[DynDisc MCP-SSE] New SSE connection from ${req.ip}`);
  const mcpServer = createServer();
  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports.set(sessionId, transport);

  res.on("close", () => {
    console.error(`[DynDisc MCP-SSE] SSE connection closed: ${sessionId}`);
    transports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "Unknown session" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "dynd-disc-server",
    version: "2.0.0",
    tools: 13,
    transport: "SSE",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.error(`[DynDisc MCP-SSE] Server running on http://0.0.0.0:${PORT}`);
  console.error(`[DynDisc MCP-SSE] SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  console.error(`[DynDisc MCP-SSE] Health check: http://0.0.0.0:${PORT}/health`);
  console.error(`[DynDisc MCP-SSE] 13 tools + session memory`);
  console.error(`[DynDisc MCP-SSE] ACTUS:    ${process.env.ACTUS_URL ?? "http://34.203.247.32:8083"}`);
  console.error(`[DynDisc MCP-SSE] vLEI:     ${process.env.VLEI_API_URL ?? "http://localhost:4000 (DEFAULT — set VLEI_API_URL on Railway)"}`);
  console.error(`[DynDisc MCP-SSE] Treasury: ${process.env.TREASURY_AGENT_URL ?? "http://54.84.215.140:7070 (default)"}`);
  console.error(`[DynDisc MCP-SSE] Buyer:    ${process.env.BUYER_AGENT_URL  ?? "http://54.84.215.140:9090 (default)"}`);
  console.error(`[DynDisc MCP-SSE] Seller:   ${process.env.SELLER_AGENT_URL ?? "http://54.84.215.140:8080 (default)"}`);
  console.error(`[DynDisc MCP-SSE] GLEIF:    https://api.gleif.org/api/v1 (public, no auth)`);
});
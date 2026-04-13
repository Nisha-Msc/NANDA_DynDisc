// ================= MCP SERVER ENTRY POINT =================
// 9 tools with session memory — tools chain automatically.
// negotiate_price writes agreed price → compute_dd_rate reads it → etc.
// Tools 7-9: vLEI verification, market data, delegation status.

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { handleComputeDDRate, handleCalcDiscount, handleGenerateDDOffer } from "./tools/dd-tools.js";
import { handleSubmitActus } from "./tools/actus-tools.js";
import { handleGetDDSummary } from "./tools/summary-tools.js";
import { handleNegotiate } from "./tools/negotiate-tools.js";
import { handleVerifyAgent, handleGetMarketData, handleGetDelegationStatus } from "./tools/vlei-market-tools.js";
import { sessionMemory } from "./session-memory.js";

if (!process.env.ACTUS_URL || !process.env.ACTUS_RISK_URL) {
  console.error("[DynDisc MCP] WARNING: ACTUS_URL or ACTUS_RISK_URL not set.");
}

const server = new McpServer({
  name:    process.env.MCP_SERVER_NAME    ?? "dynd-disc-server",
  version: process.env.MCP_SERVER_VERSION ?? "2.0.0",
});

// ── Tool 1: negotiate_price ───────────────────────────────────────────────────

server.tool(
  "negotiate_price",
  "Negotiate a price for goods between buyer and seller. " +
  "Uses rule-based constraints: seller floor ₹350, target ₹385; buyer budget ₹400, target ₹330. " +
  "Returns ACCEPT, COUNTER, or REJECT with reasoning and next step. " +
  "Remembers past negotiations to improve future deals. " +
  "Call repeatedly with alternating roles to simulate multi-round negotiation.",
  {
    role:         z.string().describe("'buyer' or 'seller' — who is responding to this offer"),
    offer_price:  z.number().positive().describe("The price being offered, e.g. 340"),
    round:        z.number().int().min(1).max(3).describe("Current negotiation round (1, 2, or 3)"),
    margin_price: z.number().positive().optional().describe("Seller's cost floor, default 350"),
    target_price: z.number().positive().optional().describe("Ideal price for this role"),
    max_budget:   z.number().positive().optional().describe("Buyer's max budget, default 400"),
    quantity:     z.number().positive().optional().describe("Units to order, default 2000"),
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

// ── Tool 2: compute_dd_rate ───────────────────────────────────────────────────

server.tool(
  "compute_dd_rate",
  "Calculate the maximum safe discount rate for early payment. " +
  "If a deal was just negotiated, reads agreed_price and margin_price from memory automatically. " +
  "You can also pass them explicitly. " +
  "TIP: Call get_market_data first to get SOFR-adjusted safety_factor for real-world accuracy.",
  {
    agreed_price:  z.number().positive().optional().describe("Price agreed on — auto-read from memory if omitted"),
    margin_price:  z.number().positive().optional().describe("Seller's cost floor — auto-read from memory if omitted"),
    safety_factor: z.number().min(0).max(1).optional().describe("Fraction of margin to give away, default 0.5. Use get_market_data for SOFR-adjusted value."),
  },
  async (input) => {
    try {
      const deal = sessionMemory.getCurrentDeal();
      const agreed = input.agreed_price ?? deal?.agreedPrice;
      const margin = input.margin_price ?? deal?.marginPrice ?? 350;

      if (!agreed) {
        return { content: [{ type: "text", text: "Error: No agreed_price provided and no deal in memory. Run negotiate_price first or pass agreed_price explicitly." }], isError: true };
      }

      const result = handleComputeDDRate({ agreed_price: agreed, margin_price: margin, safety_factor: input.safety_factor });

      sessionMemory.updateCurrentDeal({ safeDDRate: result.safeDDRate, marginPrice: margin });

      return { content: [{ type: "text", text: JSON.stringify({ ...result, source: deal ? `Auto-read from deal ${deal.negotiationId}` : "Explicit input" }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// ── Tool 3: calculate_early_payment_discount ─────────────────────────────────

server.tool(
  "calculate_early_payment_discount",
  "Calculate exact discount amount for early payment. " +
  "Auto-reads invoice_total and max_discount_rate from memory if available.",
  {
    invoice_total:     z.number().positive().optional().describe("Full bill amount — auto-read from memory if omitted"),
    max_discount_rate: z.number().min(0).max(1).optional().describe("Max rate from compute_dd_rate — auto-read if omitted"),
    invoice_date:      z.string().optional().describe("Invoice date YYYY-MM-DD — auto-read if omitted"),
    due_date:          z.string().optional().describe("Due date YYYY-MM-DD — auto-read if omitted"),
    settlement_date:   z.string().optional().describe("Early payment date YYYY-MM-DD — defaults to 10 days after invoice"),
  },
  async (input) => {
    try {
      const deal = sessionMemory.getCurrentDeal();
      const total = input.invoice_total ?? deal?.invoiceTotal;
      const rate = input.max_discount_rate ?? deal?.safeDDRate;
      const invDate = input.invoice_date ?? deal?.invoiceDate ?? new Date().toISOString().split("T")[0];
      const dueDate = input.due_date ?? deal?.dueDate;
      const settleDate = input.settlement_date ?? deal?.settlementDate;

      if (!total || !rate) {
        return { content: [{ type: "text", text: "Error: Missing invoice_total or max_discount_rate. Run generate_dd_offer first or pass values explicitly." }], isError: true };
      }

      const actualDue = dueDate ?? addDays(invDate, 30);
      const actualSettle = settleDate ?? addDays(invDate, 10);

      const result = handleCalcDiscount({ invoice_total: total, max_discount_rate: rate, invoice_date: invDate, due_date: actualDue, settlement_date: actualSettle });

      sessionMemory.updateCurrentDeal({
        settlementDate: actualSettle,
        discountedAmount: result.discountedAmount,
        savingAmount: result.savingAmount,
        appliedRate: result.appliedRate,
        daysEarly: result.daysEarly,
      });

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// ── Tool 4: generate_dd_offer ────────────────────────────────────────────────

server.tool(
  "generate_dd_offer",
  "Build the complete DD offer with sliding scale table. " +
  "Auto-reads agreed_price, margin_price, and quantity from memory.",
  {
    invoice_id:           z.string().optional().describe("Invoice ID — auto-generated if omitted"),
    negotiation_id:       z.string().optional().describe("Negotiation ID — auto-read from memory"),
    agreed_price:         z.number().positive().optional().describe("Auto-read from memory"),
    margin_price:         z.number().positive().optional().describe("Auto-read from memory"),
    quantity:             z.number().positive().optional().describe("Auto-read from memory"),
    gst_rate:             z.number().min(0).max(1).optional().describe("GST rate, default 0.18"),
    payment_terms_days:   z.number().int().positive().optional().describe("Payment term days, default 30"),
    proposed_early_days:  z.number().int().min(0).optional().describe("Proposed early days, default 10"),
  },
  async (input) => {
    try {
      const deal = sessionMemory.getCurrentDeal();
      const agreed = input.agreed_price ?? deal?.agreedPrice;
      const margin = input.margin_price ?? deal?.marginPrice ?? 350;
      const qty = input.quantity ?? deal?.quantity ?? 2000;
      const negId = input.negotiation_id ?? deal?.negotiationId ?? `NEG-${Date.now()}`;
      const invId = input.invoice_id ?? `INV-${Date.now()}`;

      if (!agreed) {
        return { content: [{ type: "text", text: "Error: No agreed_price. Run negotiate_price first." }], isError: true };
      }

      const result = handleGenerateDDOffer({ invoice_id: invId, negotiation_id: negId, agreed_price: agreed, margin_price: margin, quantity: qty, gst_rate: input.gst_rate, payment_terms_days: input.payment_terms_days, proposed_early_days: input.proposed_early_days });

      const invoiceTotal = result.invoice?.total ?? agreed * qty * 1.18;
      const invoiceDate = result.invoice?.invoiceDate ?? new Date().toISOString().split("T")[0];
      const dueDate = result.invoice?.dueDate ?? addDays(invoiceDate, 30);
      sessionMemory.updateCurrentDeal({
        invoiceId: invId,
        invoiceTotal: invoiceTotal,
        invoiceDate: invoiceDate,
        dueDate: dueDate,
        status: "DD_OFFERED",
      });

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// ── Tool 5: submit_dd_to_actus ────────────────────────────────────────────────

server.tool(
  "submit_dd_to_actus",
  "Run ACTUS PAM simulation to validate settlement. " +
  "Auto-reads all parameters from memory if available.",
  {
    invoice_id:        z.string().optional().describe("Auto-read from memory"),
    negotiation_id:    z.string().optional().describe("Auto-read from memory"),
    invoice_date:      z.string().optional().describe("Auto-read from memory"),
    due_date:          z.string().optional().describe("Auto-read from memory"),
    settlement_date:   z.string().optional().describe("Auto-read from memory"),
    invoice_total:     z.number().positive().optional().describe("Auto-read from memory"),
    max_discount_rate: z.number().min(0).max(1).optional().describe("Auto-read from memory"),
    seller_revenue:    z.number().positive().optional().describe("Auto-read from memory"),
    hurdle_rate:       z.number().min(0).max(1).optional().describe("Default 0.075"),
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

      if (!total || !rate) {
        return { content: [{ type: "text", text: "Error: Missing invoice_total or max_discount_rate. Run earlier tools first." }], isError: true };
      }

      const result = await handleSubmitActus({ invoice_id: invId, negotiation_id: negId, invoice_date: invDate, due_date: dueDate, settlement_date: settleDate, invoice_total: total, max_discount_rate: rate, seller_revenue: revenue!, hurdle_rate: input.hurdle_rate });

      sessionMemory.updateCurrentDeal({
        actusStatus: result.success ? "SUCCESS" : "FAILED",
        actusContractId: result.contractId,
        actusEvents: result.events,
        status: "SETTLED",
      });

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.success };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// ── Tool 6: get_dd_summary ────────────────────────────────────────────────────

server.tool(
  "get_dd_summary",
  "Return a complete audit of the deal — from negotiation through settlement. " +
  "Reads from both the DD tools memory and session memory for a full picture. " +
  "Auto-reads negotiation_id from memory if omitted.",
  {
    negotiation_id: z.string().optional().describe("Auto-read from current deal if omitted"),
  },
  async (input) => {
    try {
      const deal = sessionMemory.getCurrentDeal();
      const negId = input.negotiation_id ?? deal?.negotiationId;

      if (!negId) {
        return { content: [{ type: "text", text: "Error: No negotiation_id and no deal in memory." }], isError: true };
      }

      let ddSummary: any = null;
      try { ddSummary = handleGetDDSummary({ negotiation_id: negId }); } catch { /* may not exist */ }

      const sessionSummary = deal ? {
        negotiationId: deal.negotiationId,
        status: deal.status,
        negotiation: {
          rounds: deal.rounds,
          agreedPrice: deal.agreedPrice,
          quantity: deal.quantity,
        },
        discounting: {
          safeDDRate: deal.safeDDRate,
          invoiceTotal: deal.invoiceTotal,
          discountedAmount: deal.discountedAmount,
          savingAmount: deal.savingAmount,
          daysEarly: deal.daysEarly,
        },
        actus: {
          status: deal.actusStatus,
          contractId: deal.actusContractId,
        },
        timeline: {
          invoiceDate: deal.invoiceDate,
          settlementDate: deal.settlementDate,
          dueDate: deal.dueDate,
        },
        priceHistoryAllDeals: sessionMemory.getPriceHistory(),
      } : null;

      const combined = { ddToolsSummary: ddSummary, sessionMemorySummary: sessionSummary };
      return { content: [{ type: "text", text: JSON.stringify(combined, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// ── Tool 7: verify_agent_vlei ─────────────────────────────────────────────────

server.tool(
  "verify_agent_vlei",
  "Verify an agent's vLEI delegation chain via KERI cryptographic proof. " +
  "Proves the agent was authorized by a real legal entity (GLEIF-registered LEI) " +
  "through the chain: GLEIF ROOT → QVI → Legal Entity → OOR Holder → Agent. " +
  "Requires the vLEI Docker infrastructure and api-server (port 4000) to be running.",
  {
    agent_type:        z.enum(["seller", "buyer"]).describe("Which agent to verify: 'seller' (Jupiter Knitting) or 'buyer' (Tommy Hilfiger)"),
    verification_type: z.enum(["DEEP", "DEEP-EXT"]).optional().describe("DEEP = standard delegation check, DEEP-EXT = cross-org verification. Default: DEEP"),
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

// ── Tool 8: get_market_data ───────────────────────────────────────────────────

server.tool(
  "get_market_data",
  "Fetch real-time market data: SOFR rate from Federal Reserve FRED API, " +
  "ICE Cotton #2 commodity price, and compute SOFR-adjusted safety factor " +
  "and commodity-adjusted margin price. Use these values in compute_dd_rate " +
  "for market-aware dynamic discounting instead of hardcoded defaults.",
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

// ── Tool 9: get_delegation_status ─────────────────────────────────────────────

server.tool(
  "get_delegation_status",
  "Get the full vLEI delegation chain status for all agents. " +
  "Shows GLEIF ROOT → QVI → Legal Entity → OOR Holder → Agent → Sub-agent " +
  "with AIDs, credentials, and verification state. " +
  "Reads from the vLEI api-server status endpoint (no re-verification needed).",
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

// ── Helper ────────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ── Connect transport and start ───────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`[DynDisc MCP] Server running (9 tools + session memory) — ACTUS: ${process.env.ACTUS_URL ?? "http://34.203.247.32:8083"}`);

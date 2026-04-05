// ================= ACTUS TOOL (Tool 4) =================
// Thin wrapper around ActusClient.submitDDContract()
// Zero new ACTUS logic — only MCP schema + state update.

import { z } from "zod";
import { ActusClient } from "../../shared/actus-client.js";
import {
  type ActusToolResult,
  negotiationStore,
} from "../types/mcp-types.js";

// ── Zod schema ────────────────────────────────────────────────────────────────

export const SubmitActusSchema = z.object({
  invoice_id:        z.string().min(1, "invoice_id is required"),
  negotiation_id:    z.string().min(1, "negotiation_id is required"),
  invoice_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  due_date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  settlement_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  invoice_total:     z.number().positive("invoice_total must be > 0"),
  max_discount_rate: z.number().min(0).max(1),
  seller_revenue:    z.number().positive("seller_revenue must be > 0"),
  hurdle_rate:       z.number().min(0).max(1).optional().default(0.075),
});

// ── Tool 4: submit_dd_to_actus ────────────────────────────────────────────────

export async function handleSubmitActus(raw: unknown): Promise<ActusToolResult> {
  const input = SubmitActusSchema.parse(raw);

  const client = new ActusClient({
    riskServiceUrl: process.env.ACTUS_RISK_URL ?? "http://34.203.247.32:8082",
    actusUrl:       process.env.ACTUS_URL       ?? "http://34.203.247.32:8083",
  });

  const result = await client.submitDDContract({
    contractId:           input.invoice_id,
    negotiationId:        input.negotiation_id,
    invoiceDate:          input.invoice_date,
    dueDate:              input.due_date,
    settlementDate:       input.settlement_date,
    notionalAmount:       input.invoice_total,
    maxDiscountRate:      input.max_discount_rate,
    hurdleRateAnnualized: input.hurdle_rate,
    sellerRevenue:        input.seller_revenue,
  });

  // Extract final payoff — the IED or PR event closest to settlement date
  let finalPayoff: number | null = null;
  if (result.success && result.events && result.events.length > 0) {
    // Find the event with the largest absolute payoff (usually IED or RR)
    const payoffEvents = result.events.filter(
      (e) => e.payoff !== 0
    );
    if (payoffEvents.length > 0) {
      finalPayoff = Math.abs(
        payoffEvents.reduce((best, e) =>
          Math.abs(e.payoff) > Math.abs(best.payoff) ? e : best
        ).payoff
      );
    }
  }

  // Update negotiation state if this negotiation_id is tracked
  const record = negotiationStore.get(input.negotiation_id);
  if (record) {
    record.actus_status      = result.success ? "SUCCESS" : "FAILED";
    record.actus_contract_id = result.contractId;
    record.actus_scenario_id = result.scenarioId;
    record.actus_error       = result.error ?? null;
    record.status            = result.success ? "DD_COMPLETED" : record.status;
    if (result.success && finalPayoff !== null) {
      record.final_amount  = finalPayoff;
      record.saving_amount = parseFloat(
        (input.invoice_total - finalPayoff).toFixed(2)
      );
      record.buyer_decision = "ACCEPTED";
      record.chosen_date    = input.settlement_date;
    }
    negotiationStore.set(input.negotiation_id, record);
  }

  return {
    success:            result.success,
    contract_id:        result.contractId,
    scenario_id:        result.scenarioId,
    reference_index_id: result.referenceIndexId,
    early_settle_id:    result.earlySettleId,
    events: (result.events ?? []).map((e) => ({
      type:         e.type,
      time:         e.time,
      payoff:       e.payoff,
      nominalValue: e.nominalValue,
    })),
    final_payoff:       finalPayoff,
    error:              result.error ?? null,
  };
}

// ================= SUMMARY TOOL (Tool 5) =================
// Reads in-memory negotiation state and generates a plain-English audit.

import { z } from "zod";
import {
  type DDSummaryOutput,
  negotiationStore,
} from "../types/mcp-types.js";

// ── Zod schema ────────────────────────────────────────────────────────────────

export const GetSummarySchema = z.object({
  negotiation_id: z.string().min(1, "negotiation_id is required"),
});

// ── Tool 5: get_dd_summary ────────────────────────────────────────────────────

export function handleGetDDSummary(raw: unknown): DDSummaryOutput {
  const { negotiation_id } = GetSummarySchema.parse(raw);

  const record = negotiationStore.get(negotiation_id);

  // If no record found, return a clear "not found" response
  if (!record) {
    return {
      negotiation_id,
      status:        "NOT_FOUND",
      agreed_price:  0,
      quantity:      0,
      invoice: {
        invoice_id:     "—",
        original_total: 0,
        gst_amount:     0,
        subtotal:       0,
        due_date:       "—",
      },
      dd_offer: {
        was_made:      false,
        proposed_date: null,
        max_rate_pct:  null,
        proposed_saving: null,
      },
      buyer_decision: {
        decision:       "PENDING",
        chosen_date:    null,
        actual_rate_pct: null,
        final_amount:   null,
        saving_amount:  null,
      },
      actus: {
        status:      "NOT_RUN",
        contract_id: null,
        scenario_id: null,
        error:       null,
      },
      plain_english_summary:
        `No negotiation found for ID "${negotiation_id}". ` +
        `Use generate_dd_offer first to create one, or check the negotiation_id.`,
    };
  }

  // Build plain English summary
  const summary = buildPlainEnglishSummary(record);

  return {
    negotiation_id:  record.negotiation_id,
    status:          record.status,
    agreed_price:    record.agreed_price,
    quantity:        record.quantity,

    invoice: {
      invoice_id:     record.invoice_id,
      original_total: record.original_total,
      gst_amount:     record.gst_amount,
      subtotal:       record.subtotal,
      due_date:       record.due_date,
    },

    dd_offer: {
      was_made:        true,
      proposed_date:   record.proposed_date,
      max_rate_pct:    `${(record.max_discount_rate * 100).toFixed(2)}%`,
      proposed_saving: record.proposed_saving,
    },

    buyer_decision: {
      decision:        record.buyer_decision,
      chosen_date:     record.chosen_date,
      actual_rate_pct: record.saving_amount && record.final_amount
        ? `${(((record.original_total - record.final_amount) / record.original_total) * 100).toFixed(2)}%`
        : null,
      final_amount:  record.final_amount,
      saving_amount: record.saving_amount,
    },

    actus: {
      status:      record.actus_status,
      contract_id: record.actus_contract_id,
      scenario_id: record.actus_scenario_id,
      error:       record.actus_error,
    },

    plain_english_summary: summary,
  };
}

// ── Helper: build plain English narrative ─────────────────────────────────────

function buildPlainEnglishSummary(record: ReturnType<typeof negotiationStore.get> & object): string {
  const lines: string[] = [];

  lines.push(
    `Negotiation ${record!.negotiation_id}: ` +
    `${record!.quantity} units at ₹${record!.agreed_price}/unit.`
  );

  lines.push(
    `Invoice total: ₹${record!.original_total.toLocaleString("en-IN")} ` +
    `(subtotal ₹${record!.subtotal.toLocaleString("en-IN")} + GST ₹${record!.gst_amount.toLocaleString("en-IN")}). ` +
    `Due date: ${record!.due_date}.`
  );

  lines.push(
    `DD offer made: max discount ${(record!.max_discount_rate * 100).toFixed(2)}%. ` +
    `Proposed settlement on ${record!.proposed_date} — potential saving ₹${record!.proposed_saving.toLocaleString("en-IN")}.`
  );

  if (record!.buyer_decision === "ACCEPTED" && record!.final_amount !== null) {
    lines.push(
      `Buyer ACCEPTED and paid on ${record!.chosen_date}. ` +
      `Final amount: ₹${record!.final_amount.toLocaleString("en-IN")}. ` +
      `Actual saving: ₹${record!.saving_amount?.toLocaleString("en-IN")}.`
    );
  } else if (record!.buyer_decision === "REJECTED") {
    lines.push(`Buyer REJECTED the DD offer. Full amount of ₹${record!.original_total.toLocaleString("en-IN")} is due.`);
  } else {
    lines.push(`Buyer decision: PENDING — no settlement date chosen yet.`);
  }

  if (record!.actus_status === "SUCCESS") {
    lines.push(
      `ACTUS simulation: SUCCESS. ` +
      `Contract ID: ${record!.actus_contract_id}. ` +
      `Scenario ID: ${record!.actus_scenario_id}.`
    );
  } else if (record!.actus_status === "FAILED") {
    lines.push(`ACTUS simulation: FAILED — ${record!.actus_error}`);
  } else {
    lines.push(`ACTUS simulation: not yet run.`);
  }

  return lines.join(" ");
}

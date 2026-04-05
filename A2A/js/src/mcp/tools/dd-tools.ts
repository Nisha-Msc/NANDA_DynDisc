// ================= DD TOOLS (Tools 1, 2, 3) =================
// Thin wrappers around existing dd-calculator.ts functions.
// Zero new business logic — only MCP schema + formatting.

import { z } from "zod";
import {
  computeSafeDDRate,
  computeLinearDiscount,
  addDays,
} from "../../shared/dd-calculator.js";
import {
  type ComputeDDRateOutput,
  type CalcDiscountOutput,
  type DDOfferOutput,
  type SlidingScaleRow,
  negotiationStore,
  type NegotiationRecord,
} from "../types/mcp-types.js";

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const ComputeDDRateSchema = z.object({
  agreed_price:   z.number().positive("agreed_price must be > 0"),
  margin_price:   z.number().positive("margin_price must be > 0"),
  safety_factor:  z.number().min(0).max(1).optional().default(0.5),
});

export const CalcDiscountSchema = z.object({
  invoice_total:       z.number().positive(),
  max_discount_rate:   z.number().min(0).max(1),
  invoice_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  due_date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  settlement_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export const GenerateDDOfferSchema = z.object({
  invoice_id:           z.string().min(1),
  negotiation_id:       z.string().min(1),
  agreed_price:         z.number().positive(),
  margin_price:         z.number().positive(),
  quantity:             z.number().positive(),
  gst_rate:             z.number().min(0).max(1).optional().default(0.18),
  payment_terms_days:   z.number().int().positive().optional().default(30),
  proposed_early_days:  z.number().int().min(0).optional().default(10),
});

// ── Tool 1: compute_dd_rate ───────────────────────────────────────────────────

export function handleComputeDDRate(
  raw: unknown
): ComputeDDRateOutput {
  const { agreed_price, margin_price, safety_factor } =
    ComputeDDRateSchema.parse(raw);

  if (margin_price >= agreed_price) {
    return {
      safe_dd_rate:    0,
      safe_dd_pct:     "0.00%",
      profit_per_unit: 0,
      max_dd_rate:     0,
      explanation:
        `Margin price (${margin_price}) must be less than agreed price (${agreed_price}). ` +
        `No discount can be offered — seller is at or below cost.`,
    };
  }

  const profitPerUnit = agreed_price - margin_price;
  const maxDDRate     = profitPerUnit / agreed_price;
  const safeDDRate    = computeSafeDDRate(agreed_price, margin_price, safety_factor);
  const keptProfit    = profitPerUnit - safeDDRate * agreed_price;

  return {
    safe_dd_rate:    safeDDRate,
    safe_dd_pct:     `${(safeDDRate * 100).toFixed(2)}%`,
    profit_per_unit: profitPerUnit,
    max_dd_rate:     parseFloat(maxDDRate.toFixed(6)),
    explanation:
      `Seller's margin per unit is ₹${profitPerUnit} ` +
      `(agreed ₹${agreed_price} − floor ₹${margin_price}). ` +
      `Using safety factor ${safety_factor}, max safe discount rate is ${(safeDDRate * 100).toFixed(2)}%. ` +
      `Seller retains at least ₹${keptProfit.toFixed(2)} per unit even if buyer pays immediately.`,
  };
}

// ── Tool 2: calculate_early_payment_discount ─────────────────────────────────

export function handleCalcDiscount(raw: unknown): CalcDiscountOutput {
  const input = CalcDiscountSchema.parse(raw);

  const result = computeLinearDiscount(
    input.invoice_total,
    input.max_discount_rate,
    input.invoice_date,
    input.due_date,
    input.settlement_date
  );

  return {
    days_early:        result.daysEarly,
    total_days:        result.totalDays,
    applied_rate:      result.appliedRate,
    applied_rate_pct:  `${(result.appliedRate * 100).toFixed(2)}%`,
    discounted_amount: result.discountedAmount,
    saving_amount:     result.savingAmount,
    full_amount:       input.invoice_total,
  };
}

// ── Tool 3: generate_dd_offer ────────────────────────────────────────────────

export function handleGenerateDDOffer(raw: unknown): DDOfferOutput {
  const input = GenerateDDOfferSchema.parse(raw);

  const today       = new Date().toISOString().split("T")[0];
  const invoiceDate = today;
  const dueDate     = addDays(today, input.payment_terms_days);

  const subtotal     = input.agreed_price * input.quantity;
  const gstAmount    = parseFloat((subtotal * input.gst_rate).toFixed(2));
  const totalAmount  = parseFloat((subtotal + gstAmount).toFixed(2));

  const safeDDRate           = computeSafeDDRate(
    input.agreed_price,
    input.margin_price
  );
  const proposedSettleDate   = addDays(invoiceDate, input.proposed_early_days);

  const proposedDiscount = computeLinearDiscount(
    totalAmount,
    safeDDRate,
    invoiceDate,
    dueDate,
    proposedSettleDate
  );

  // Build sliding scale — one row per day from invoice_date to due_date
  const slidingScale: SlidingScaleRow[] = [];
  for (let d = 0; d <= input.payment_terms_days; d++) {
    const dateStr = addDays(invoiceDate, d);
    const res     = computeLinearDiscount(
      totalAmount, safeDDRate, invoiceDate, dueDate, dateStr
    );
    slidingScale.push({
      date:       dateStr,
      days_early: res.daysEarly,
      rate:       res.appliedRate,
      rate_pct:   `${(res.appliedRate * 100).toFixed(2)}%`,
      amount:     res.discountedAmount,
      saving:     res.savingAmount,
    });
  }

  // Store in negotiation state so Tool 5 can read it
  const record: NegotiationRecord = {
    negotiation_id:    input.negotiation_id,
    status:            "DD_OFFERED",
    agreed_price:      input.agreed_price,
    quantity:          input.quantity,
    invoice_id:        input.invoice_id,
    invoice_date:      invoiceDate,
    due_date:          dueDate,
    original_total:    totalAmount,
    gst_amount:        gstAmount,
    subtotal,
    max_discount_rate: safeDDRate,
    proposed_date:     proposedSettleDate,
    proposed_saving:   proposedDiscount.savingAmount,
    buyer_decision:    "PENDING",
    chosen_date:       null,
    final_amount:      null,
    saving_amount:     null,
    actus_status:      "NOT_RUN",
    actus_contract_id: null,
    actus_scenario_id: null,
    actus_error:       null,
  };
  negotiationStore.set(input.negotiation_id, record);

  return {
    invoice_id:               input.invoice_id,
    negotiation_id:           input.negotiation_id,
    invoice_date:             invoiceDate,
    due_date:                 dueDate,
    original_total:           totalAmount,
    gst_amount:               gstAmount,
    subtotal,
    max_discount_rate:        safeDDRate,
    max_discount_rate_pct:    `${(safeDDRate * 100).toFixed(2)}%`,
    proposed_settlement_date: proposedSettleDate,
    discount_at_proposed_date: {
      days_early:        proposedDiscount.daysEarly,
      total_days:        proposedDiscount.totalDays,
      applied_rate:      proposedDiscount.appliedRate,
      applied_rate_pct:  `${(proposedDiscount.appliedRate * 100).toFixed(2)}%`,
      discounted_amount: proposedDiscount.discountedAmount,
      saving_amount:     proposedDiscount.savingAmount,
      full_amount:       totalAmount,
    },
    sliding_scale_table: slidingScale,
  };
}

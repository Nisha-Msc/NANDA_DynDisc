// ================= MCP SHARED TYPES =================
// Shared input/output TypeScript interfaces for all 5 MCP tools.
// No business logic here — pure type definitions.

// ── Tool 1: compute_dd_rate ───────────────────────────────────────────────────

export interface ComputeDDRateInput {
  agreed_price:   number;
  margin_price:   number;
  safety_factor?: number; // default 0.5
}

export interface ComputeDDRateOutput {
  safe_dd_rate:    number; // e.g. 0.027027
  safe_dd_pct:     string; // e.g. "2.70%"
  profit_per_unit: number; // e.g. 20
  max_dd_rate:     number; // 100% of margin as discount (before safety factor)
  explanation:     string; // plain English
}

// ── Tool 2: calculate_early_payment_discount ─────────────────────────────────

export interface CalcDiscountInput {
  invoice_total:       number; // full bill incl. GST
  max_discount_rate:   number; // from Tool 1
  invoice_date:        string; // ISO date "YYYY-MM-DD"
  due_date:            string;
  settlement_date:     string;
}

export interface CalcDiscountOutput {
  days_early:         number;
  total_days:         number;
  applied_rate:       number; // e.g. 0.018018
  applied_rate_pct:   string; // e.g. "1.80%"
  discounted_amount:  number;
  saving_amount:      number;
  full_amount:        number; // original, without discount
}

// ── Tool 3: generate_dd_offer ────────────────────────────────────────────────

export interface GenerateDDOfferInput {
  invoice_id:           string;
  negotiation_id:       string;
  agreed_price:         number;
  margin_price:         number;
  quantity:             number;
  gst_rate?:            number; // default 0.18
  payment_terms_days?:  number; // default 30
  proposed_early_days?: number; // default 10
}

export interface SlidingScaleRow {
  date:       string;
  days_early: number;
  rate:       number;
  rate_pct:   string;
  amount:     number;
  saving:     number;
}

export interface DDOfferOutput {
  invoice_id:                  string;
  negotiation_id:              string;
  invoice_date:                string;
  due_date:                    string;
  original_total:              number;
  gst_amount:                  number;
  subtotal:                    number;
  max_discount_rate:           number;
  max_discount_rate_pct:       string;
  proposed_settlement_date:    string;
  discount_at_proposed_date:   CalcDiscountOutput;
  sliding_scale_table:         SlidingScaleRow[];
}

// ── Tool 4: submit_dd_to_actus ───────────────────────────────────────────────

export interface SubmitActusInput {
  invoice_id:        string;
  negotiation_id:    string;
  invoice_date:      string;
  due_date:          string;
  settlement_date:   string;
  invoice_total:     number;
  max_discount_rate: number;
  seller_revenue:    number;
  hurdle_rate?:      number; // default 0.075
}

export interface ActusToolResult {
  success:           boolean;
  contract_id:       string;
  scenario_id:       string;
  reference_index_id:string;
  early_settle_id:   string;
  events:            Array<{
    type:         string;
    time:         string;
    payoff:       number;
    nominalValue: number;
  }>;
  final_payoff:      number | null;
  error:             string | null;
}

// ── Tool 5: get_dd_summary ────────────────────────────────────────────────────

export interface GetSummaryInput {
  negotiation_id: string;
}

export interface DDSummaryOutput {
  negotiation_id:      string;
  status:              string;
  agreed_price:        number;
  quantity:            number;

  invoice: {
    invoice_id:        string;
    original_total:    number;
    gst_amount:        number;
    subtotal:          number;
    due_date:          string;
  };

  dd_offer: {
    was_made:          boolean;
    proposed_date:     string | null;
    max_rate_pct:      string | null;
    proposed_saving:   number | null;
  };

  buyer_decision: {
    decision:          "ACCEPTED" | "REJECTED" | "PENDING";
    chosen_date:       string | null;
    actual_rate_pct:   string | null;
    final_amount:      number | null;
    saving_amount:     number | null;
  };

  actus: {
    status:            "SUCCESS" | "FAILED" | "NOT_RUN";
    contract_id:       string | null;
    scenario_id:       string | null;
    error:             string | null;
  };

  plain_english_summary: string;
}

// ── In-memory state store (shared across tools) ───────────────────────────────

export interface NegotiationRecord {
  negotiation_id:    string;
  status:            string;
  agreed_price:      number;
  quantity:          number;
  invoice_id:        string;
  invoice_date:      string;
  due_date:          string;
  original_total:    number;
  gst_amount:        number;
  subtotal:          number;
  max_discount_rate: number;
  proposed_date:     string;
  proposed_saving:   number;
  buyer_decision:    "ACCEPTED" | "REJECTED" | "PENDING";
  chosen_date:       string | null;
  final_amount:      number | null;
  saving_amount:     number | null;
  actus_status:      "SUCCESS" | "FAILED" | "NOT_RUN";
  actus_contract_id: string | null;
  actus_scenario_id: string | null;
  actus_error:       string | null;
}

// Global in-memory store — keyed by negotiation_id
export const negotiationStore = new Map<string, NegotiationRecord>();

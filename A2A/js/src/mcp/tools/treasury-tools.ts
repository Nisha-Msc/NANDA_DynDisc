// ================= TREASURY TOOL — MCP TOOL 11 =================
// Thin HTTP-POST passthrough to the live Jupiter Treasury Agent on AWS.
// Returns ACTUS PAM cash-flow simulation result with NPV, net profit, ACTUS events.
//
// AWS endpoint default: 54.84.215.140:7070  (PM2-managed, online as of May 6 2026)
// Override via TREASURY_AGENT_URL env var.

const TREASURY_BASE_URL = process.env.TREASURY_AGENT_URL ?? "http://54.84.215.140:7070";
const TREASURY_TIMEOUT_MS = 8000;

export interface ConsultTreasuryInput {
  negotiationId: string;
  pricePerUnit:  number;
  quantity:      number;
  paymentTerms?: number;
  round?:        number;
}

export interface ConsultTreasuryResult {
  source:                  "Jupiter Treasury Agent (AWS)";
  endpoint:                string;
  fetched_at:              string;
  http_status:             number;
  approved?:               boolean;
  currentBalance?:         number;
  availableLiquidity?:     number;
  safetyThreshold?:        number;
  productionCost?:         number;
  grossRevenue?:           number;
  workingCapitalCost?:     number;
  netProfit?:              number;
  npvOfDeal?:              number;
  projectedMinBalance?:    number;
  failReasons?:            string[];
  recommendation?:         string;
  actusEvents?:            any[];
  error?:                  string;
}

function nowISO(): string {
  return new Date().toISOString();
}

export async function handleConsultTreasury(input: ConsultTreasuryInput): Promise<ConsultTreasuryResult> {
  const url = `${TREASURY_BASE_URL}/consult`;
  const body = {
    negotiationId: input.negotiationId,
    pricePerUnit:  input.pricePerUnit,
    quantity:      input.quantity,
    paymentTerms:  input.paymentTerms ?? 30,
    round:         input.round        ?? 1,
  };

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TREASURY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    clearTimeout(tid);

    let parsed: any = null;
    try { parsed = await resp.json(); } catch { parsed = null; }

    if (!resp.ok) {
      return {
        source:      "Jupiter Treasury Agent (AWS)",
        endpoint:    url,
        fetched_at:  nowISO(),
        http_status: resp.status,
        error:       `Treasury returned HTTP ${resp.status}`,
      };
    }

    return {
      source:               "Jupiter Treasury Agent (AWS)",
      endpoint:             url,
      fetched_at:           nowISO(),
      http_status:          resp.status,
      approved:             parsed?.approved,
      currentBalance:       parsed?.currentBalance,
      availableLiquidity:   parsed?.availableLiquidity,
      safetyThreshold:      parsed?.safetyThreshold,
      productionCost:       parsed?.productionCost,
      grossRevenue:         parsed?.grossRevenue,
      workingCapitalCost:   parsed?.workingCapitalCost,
      netProfit:            parsed?.netProfit,
      npvOfDeal:            parsed?.npvOfDeal,
      projectedMinBalance:  parsed?.projectedMinBalance,
      failReasons:          parsed?.failReasons,
      recommendation:       parsed?.recommendation,
      actusEvents:          parsed?.actusEvents,
    };
  } catch (err: any) {
    clearTimeout(tid);
    return {
      source:      "Jupiter Treasury Agent (AWS)",
      endpoint:    url,
      fetched_at:  nowISO(),
      http_status: 0,
      error:       err?.name === "AbortError"
        ? `Treasury request timed out after ${TREASURY_TIMEOUT_MS}ms`
        : (err?.message ?? String(err)),
    };
  }
}

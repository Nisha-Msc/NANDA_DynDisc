// ================= VLEI + MARKET DATA TOOLS (Tools 7, 8, 9) =================
// Thin wrappers around existing shared modules.
// These expose the vLEI verification and market data capabilities as MCP tools
// so OpenClaw / external agents can see the legal-entity accountability layer.

import { z } from "zod";
import { getMarketSnapshot, computeAdjustedSafetyFactor, computeAdjustedMarginPrice, type MarketSnapshot } from "../../shared/market-data-client.js";
import { sessionMemory } from "../session-memory.js";

// ── VLEI CONFIG ──────────────────────────────────────────────────────────────

const VLEI_API_URL = process.env.VLEI_API_URL ?? "http://localhost:4000";

// ── Tool 7: verify_agent_vlei ────────────────────────────────────────────────

export const VerifyAgentSchema = z.object({
  agent_type:        z.enum(["seller", "buyer"]).describe("Which agent to verify: 'seller' (jupiterSellerAgent) or 'buyer' (tommyBuyerAgent)"),
  verification_type: z.enum(["DEEP", "DEEP-EXT"]).optional().describe("Verification depth: DEEP (standard) or DEEP-EXT (cross-org). Default: DEEP"),
});

export async function handleVerifyAgent(raw: unknown): Promise<{
  success: boolean;
  agent: string;
  verification_type: string;
  delegation_chain: string[];
  details: any;
  error?: string;
}> {
  const input = VerifyAgentSchema.parse(raw);
  const agentType = input.agent_type;
  const mode = input.verification_type ?? "DEEP";

  const caller = agentType === "seller" ? "buyer" : "seller";
  const target = agentType;
  const endpoint = mode === "DEEP-EXT"
    ? `${VLEI_API_URL}/api/${caller}/verify/ext/${target}`
    : `${VLEI_API_URL}/api/${caller}/verify/${target}`;

  try {
    const healthResp = await fetch(`${VLEI_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthResp.ok) {
      return {
        success: false,
        agent: agentType === "seller" ? "jupiterSellerAgent" : "tommyBuyerAgent",
        verification_type: mode,
        delegation_chain: [],
        details: null,
        error: `vLEI API server not reachable at ${VLEI_API_URL}. Ensure Docker containers are running and api-server is started.`,
      };
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
    });

    const result = await resp.json();

    const agentName = agentType === "seller" ? "jupiterSellerAgent" : "tommyBuyerAgent";
    const delegationChain = agentType === "seller"
      ? ["GLEIF ROOT → QVI", "QVI → JUPITER KNITTING COMPANY → Chief Sales Officer → jupiterSellerAgent"]
      : ["GLEIF ROOT → QVI", "QVI → TOMMY HILFIGER EUROPE B.V. → Chief Procurement Officer → tommyBuyerAgent"];

    return {
      success: result.success ?? false,
      agent: agentName,
      verification_type: mode,
      delegation_chain: delegationChain,
      details: result,
    };
  } catch (err: any) {
    return {
      success: false,
      agent: agentType === "seller" ? "jupiterSellerAgent" : "tommyBuyerAgent",
      verification_type: mode,
      delegation_chain: [],
      details: null,
      error: err.message ?? String(err),
    };
  }
}

// ── Tool 8: get_market_data ──────────────────────────────────────────────────

export async function handleGetMarketData(raw: unknown): Promise<{
  snapshot: MarketSnapshot;
  adjusted_safety_factor: number;
  adjusted_margin_price: number;
  recommendation: string;
}> {
  const snapshot = await getMarketSnapshot(true); // force refresh
  const adjustedSF = computeAdjustedSafetyFactor(snapshot.effectiveBorrowingRate);
  const baseMargin = 350;
  const adjustedMargin = computeAdjustedMarginPrice(baseMargin, snapshot.commodityIndex);

  // Write to session memory so negotiate_price can read it
  sessionMemory.setMarketData({
    adjustedMarginPrice: adjustedMargin,
    adjustedSafetyFactor: adjustedSF,
    sofrRate: snapshot.sofrRate,
    cottonPricePerLb: snapshot.cottonPricePerLb,
    effectiveBorrowingRate: snapshot.effectiveBorrowingRate,
    fetchedAt: new Date().toISOString(),
  });

  const recommendation =
    `SOFR at ${(snapshot.sofrRate * 100).toFixed(2)}% (${snapshot.sofrSource}) → ` +
    `adjusted safety factor: ${adjustedSF} (range [0.3–0.6]). ` +
    `Cotton at $${snapshot.cottonPricePerLb.toFixed(2)}/lb → ` +
    `adjusted margin: ₹${adjustedMargin} (base ₹${baseMargin}). ` +
    `negotiate_price will now automatically use margin_price=₹${adjustedMargin} instead of ₹350.`;

  return {
    snapshot,
    adjusted_safety_factor: adjustedSF,
    adjusted_margin_price: adjustedMargin,
    recommendation,
  };
}

// ── Tool 9: get_delegation_status ────────────────────────────────────────────

export async function handleGetDelegationStatus(): Promise<{
  success: boolean;
  vlei_service_available: boolean;
  agents: any;
  error?: string;
}> {
  try {
    const healthResp = await fetch(`${VLEI_API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthResp.ok) {
      return {
        success: false,
        vlei_service_available: false,
        agents: null,
        error: `vLEI API server not reachable at ${VLEI_API_URL}`,
      };
    }

    const statusResp = await fetch(`${VLEI_API_URL}/api/status`, {
      signal: AbortSignal.timeout(10000),
    });
    const status = await statusResp.json();

    return {
      success: true,
      vlei_service_available: true,
      agents: status,
    };
  } catch (err: any) {
    return {
      success: false,
      vlei_service_available: false,
      agents: null,
      error: err.message ?? String(err),
    };
  }
}

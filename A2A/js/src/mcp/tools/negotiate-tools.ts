// ================= NEGOTIATE TOOL =================
// Rule-based price negotiation — no LLM, no network, instant response.
// Writes results to session memory so subsequent tools can read them.
// If get_market_data was called first, auto-reads adjusted margin price.

import { sessionMemory } from "../session-memory.js";

export interface NegotiateInput {
  role: string;
  offer_price: number;
  round: number;
  margin_price?: number;
  target_price?: number;
  max_budget?: number;
  quantity?: number;
}

export interface NegotiateResult {
  action: "ACCEPT" | "COUNTER" | "REJECT";
  price: number;
  role: string;
  round: number;
  reasoning: string;
  next_step: string;
  market_adjusted?: boolean;
  deal_context?: {
    negotiationId: string;
    totalRounds: number;
    priceHistory: { round: number; role: string; action: string; price: number }[];
    learning?: string;
  };
}

export function handleNegotiate(input: NegotiateInput): NegotiateResult {
  const role = input.role.toLowerCase();
  const round = input.round;
  const offer = input.offer_price;
  const maxRounds = 3;

  // Priority: explicit input > market data from session > hardcoded default
  const marketData = sessionMemory.getMarketData();
  const margin = input.margin_price ?? marketData?.adjustedMarginPrice ?? 350;
  const marketAdjusted = !input.margin_price && marketData !== null;

  // Seller target: 10% above margin
  const sellerTarget = input.target_price ?? Math.round(margin * 1.1);

  // Create or get deal from session memory
  let deal = sessionMemory.getCurrentDeal();
  if (!deal || deal.status !== "NEGOTIATING") {
    deal = sessionMemory.createDeal(undefined, input.quantity ?? 2000);
    deal.marginPrice = margin;
  }

  // Check price history for learning
  const history = sessionMemory.getPriceHistory();
  let learningNote: string | undefined;
  if (history.length > 0) {
    const avgPrice = Math.round(history.reduce((s, h) => s + h.agreedPrice, 0) / history.length);
    learningNote = `Based on ${history.length} past deal(s), average agreed price is ₹${avgPrice}`;
  }
  if (marketAdjusted) {
    const note = `Market-adjusted margin: ₹${margin} (cotton at $${marketData!.cottonPricePerLb.toFixed(2)}/lb). Seller target: ₹${sellerTarget}.`;
    learningNote = learningNote ? `${learningNote}. ${note}` : note;
  }

  let decision: { action: "ACCEPT" | "COUNTER" | "REJECT"; price: number; reasoning: string };

  if (role === "seller") {
    decision = sellerDecision(offer, round, maxRounds, margin, sellerTarget);
  } else {
    decision = buyerDecision(offer, round, maxRounds, input.max_budget ?? 400, input.target_price ?? 330);
  }

  // Write to session memory
  const action = decision.action === "COUNTER" ? "COUNTER" : decision.action;
  sessionMemory.addRound(round, role, action, decision.price);

  // Build next_step based on action
  let next_step: string;
  if (decision.action === "ACCEPT") {
    next_step = `Deal agreed at ₹${decision.price}. Next: call compute_dd_rate with agreed_price=${decision.price} and margin_price=${margin}`;
  } else if (decision.action === "REJECT") {
    next_step = "Negotiation failed. No deal.";
  } else {
    const nextRole = role === "seller" ? "buyer" : "seller";
    next_step = `Call negotiate_price again with role=${nextRole}, offer_price=${decision.price}, round=${round + 1}`;
  }

  return {
    action: decision.action,
    price: decision.price,
    role,
    round,
    reasoning: decision.reasoning,
    next_step,
    market_adjusted: marketAdjusted,
    deal_context: {
      negotiationId: deal.negotiationId,
      totalRounds: deal.rounds.length,
      priceHistory: deal.rounds,
      learning: learningNote,
    },
  };
}

function sellerDecision(offer: number, round: number, maxRounds: number, margin: number, target: number): { action: "ACCEPT" | "COUNTER" | "REJECT"; price: number; reasoning: string } {
  const floor = margin + 5;

  if (offer >= target) {
    return { action: "ACCEPT", price: offer, reasoning: `Offer ₹${offer} meets target ₹${target}. Deal accepted.` };
  }
  if (offer < floor) {
    if (round >= maxRounds) return { action: "REJECT", price: offer, reasoning: `Offer ₹${offer} below floor ₹${floor} in final round. No deal.` };
    return { action: "COUNTER", price: target, reasoning: `Offer ₹${offer} below floor ₹${floor}. Countering at target ₹${target}.` };
  }
  if (round >= maxRounds) {
    return { action: "ACCEPT", price: offer, reasoning: `Final round. Accepting ₹${offer} (above floor ₹${floor}).` };
  }
  const gap = target - offer;
  const concession = Math.round(gap * 0.4 * (round / maxRounds));
  const counter = Math.max(target - concession, floor);
  return { action: "COUNTER", price: counter, reasoning: `Offer ₹${offer} is ₹${gap} below target. Conceding ₹${concession}, countering at ₹${counter}.` };
}

function buyerDecision(offer: number, round: number, maxRounds: number, maxBudget: number, target: number): { action: "ACCEPT" | "COUNTER" | "REJECT"; price: number; reasoning: string } {
  if (offer <= target) {
    return { action: "ACCEPT", price: offer, reasoning: `Offer ₹${offer} meets target ₹${target}. Deal accepted.` };
  }
  if (offer > maxBudget) {
    if (round >= maxRounds) return { action: "REJECT", price: offer, reasoning: `Offer ₹${offer} exceeds budget ₹${maxBudget} in final round. No deal.` };
    const counter = Math.round(target + (maxBudget - target) * (round / maxRounds) * 0.6);
    return { action: "COUNTER", price: counter, reasoning: `Offer ₹${offer} over budget ₹${maxBudget}. Countering at ₹${counter}.` };
  }
  if (round >= maxRounds) {
    return { action: "ACCEPT", price: offer, reasoning: `Final round. Accepting ₹${offer} (within budget ₹${maxBudget}).` };
  }
  const gap = offer - target;
  const concession = Math.round(gap * 0.35 * (round / maxRounds));
  const counter = Math.min(target + concession, maxBudget);
  return { action: "COUNTER", price: counter, reasoning: `Offer ₹${offer} is ₹${gap} above target. Countering at ₹${counter}.` };
}

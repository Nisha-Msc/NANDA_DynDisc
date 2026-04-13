// ================= MARKET DATA TOOL =================
// MCP wrapper around market-data-client.ts.
// Exposes real FRED SOFR rates + commodity data to OpenClaw/MCP clients.
// Also computes SOFR-adjusted safety factor for smarter DD rate calculation.

import {
  getMarketSnapshot,
  computeAdjustedSafetyFactor,
  computeAdjustedMarginPrice,
} from "../../shared/market-data-client.js";

export interface MarketDataResult {
  success: boolean;
  snapshot: {
    sofr_rate: number;
    sofr_rate_pct: string;
    sofr_source: string;
    sofr_date: string;
    cotton_price_per_lb: number;
    cotton_source: string;
    commodity_index: number;
    risk_spread: number;
    effective_borrowing_rate: number;
    effective_borrowing_rate_pct: string;
  };
  adjustments: {
    adjusted_safety_factor: number;
    adjusted_margin_price: number;
    base_margin_price: number;
    explanation: string;
  };
  timestamp: string;
  error?: string;
}

export async function handleGetMarketData(input: {
  base_margin_price?: number;
  force_refresh?: boolean;
}): Promise<MarketDataResult> {
  try {
    const baseMargin = input.base_margin_price ?? 350;
    const snap = await getMarketSnapshot(input.force_refresh ?? false);

    const adjustedSafety = computeAdjustedSafetyFactor(snap.effectiveBorrowingRate);
    const adjustedMargin = computeAdjustedMarginPrice(baseMargin, snap.commodityIndex);

    return {
      success: true,
      snapshot: {
        sofr_rate: snap.sofrRate,
        sofr_rate_pct: `${(snap.sofrRate * 100).toFixed(2)}%`,
        sofr_source: snap.sofrSource,
        sofr_date: snap.sofrTimestamp,
        cotton_price_per_lb: snap.cottonPricePerLb,
        cotton_source: snap.cottonSource,
        commodity_index: snap.commodityIndex,
        risk_spread: snap.riskSpread,
        effective_borrowing_rate: snap.effectiveBorrowingRate,
        effective_borrowing_rate_pct: `${(snap.effectiveBorrowingRate * 100).toFixed(2)}%`,
      },
      adjustments: {
        adjusted_safety_factor: adjustedSafety,
        adjusted_margin_price: adjustedMargin,
        base_margin_price: baseMargin,
        explanation:
          `SOFR at ${(snap.sofrRate * 100).toFixed(2)}% (${snap.sofrSource}) → ` +
          `effective borrowing rate ${(snap.effectiveBorrowingRate * 100).toFixed(2)}% → ` +
          `safety factor adjusted from 0.50 to ${adjustedSafety.toFixed(4)} (range [0.3, 0.6]). ` +
          `Cotton at $${snap.cottonPricePerLb.toFixed(2)}/lb (index ${snap.commodityIndex.toFixed(3)}) → ` +
          `margin price adjusted from ₹${baseMargin} to ₹${adjustedMargin}. ` +
          `Use these adjusted values in compute_dd_rate for market-aware discounting.`,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      success: false,
      snapshot: {
        sofr_rate: 0, sofr_rate_pct: "N/A", sofr_source: "ERROR", sofr_date: "",
        cotton_price_per_lb: 0, cotton_source: "ERROR", commodity_index: 0,
        risk_spread: 0, effective_borrowing_rate: 0, effective_borrowing_rate_pct: "N/A",
      },
      adjustments: {
        adjusted_safety_factor: 0.5,
        adjusted_margin_price: input.base_margin_price ?? 350,
        base_margin_price: input.base_margin_price ?? 350,
        explanation: "Market data unavailable. Using defaults.",
      },
      timestamp: new Date().toISOString(),
      error: err?.message ?? String(err),
    };
  }
}

// ================= COST BUILD-UP â€” PREMIUM COTTON T-SHIRT =================
// Pure economic model. No I/O. Inputs: cotton price (USD/lb), USD-INR FX.
// Outputs: Jupiter Knitting floor + Tommy Hilfiger ceiling for procurement.

export const T_SHIRT_COST_COMPONENTS = {
  cottonLbPerShirt:      0.55,
  spinningKnittingINR:   80,
  dyeingFinishingINR:    45,
  cuttingStitchingINR:   65,
  trimsAndLabelsINR:     35,
  packingFreightINR:     25,
  overheadINR:           50,
  marketUpliftFactor:    0.15,
} as const;

export const TOMMY_POLICY = {
  ceilingMultiple:  1.10,
  targetMultiple:   1.04,
} as const;

export const JUPITER_POLICY = {
  targetMultiple:   1.10,
} as const;

export interface CostBuildUp {
  inputs: {
    cottonPriceUSDperLb: number;
    fxUsdInr:            number;
    commodityIndex:      number;
  };
  perUnitINR: {
    rawCotton:           number;
    spinningKnitting:    number;
    dyeingFinishing:     number;
    cuttingStitching:    number;
    trimsAndLabels:      number;
    packingFreight:      number;
    overhead:            number;
    trueFloor:           number;
    marketUplift:        number;
    jupiterFloor:        number;
    jupiterTarget:       number;
    tommyTarget:         number;
    tommyCeiling:        number;
  };
  computedAt:            string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
function r(n: number): number { return Math.round(n); }

export function computeCostBuildUp(
  cottonPriceUSDperLb: number,
  fxUsdInr:            number
): CostBuildUp {
  const c = T_SHIRT_COST_COMPONENTS;
  const rawCotton = c.cottonLbPerShirt * cottonPriceUSDperLb * fxUsdInr;
  const trueFloor =
    rawCotton +
    c.spinningKnittingINR + c.dyeingFinishingINR +
    c.cuttingStitchingINR + c.trimsAndLabelsINR +
    c.packingFreightINR + c.overheadINR;
  const commodityIndex = clamp((cottonPriceUSDperLb - 0.60) / 0.30, 0, 1);
  const marketUplift   = trueFloor * c.marketUpliftFactor * commodityIndex;
  const jupiterFloor   = trueFloor + marketUplift;
  const jupiterTarget  = jupiterFloor * JUPITER_POLICY.targetMultiple;
  const tommyTarget    = jupiterFloor * TOMMY_POLICY.targetMultiple;
  const tommyCeiling   = jupiterFloor * TOMMY_POLICY.ceilingMultiple;
  return {
    inputs: {
      cottonPriceUSDperLb, fxUsdInr,
      commodityIndex: parseFloat(commodityIndex.toFixed(4)),
    },
    perUnitINR: {
      rawCotton:        r(rawCotton),
      spinningKnitting: c.spinningKnittingINR,
      dyeingFinishing:  c.dyeingFinishingINR,
      cuttingStitching: c.cuttingStitchingINR,
      trimsAndLabels:   c.trimsAndLabelsINR,
      packingFreight:   c.packingFreightINR,
      overhead:         c.overheadINR,
      trueFloor:        r(trueFloor),
      marketUplift:     r(marketUplift),
      jupiterFloor:     r(jupiterFloor),
      jupiterTarget:    r(jupiterTarget),
      tommyTarget:      r(tommyTarget),
      tommyCeiling:     r(tommyCeiling),
    },
    computedAt: new Date().toISOString(),
  };
}

export function computeJupiterFloor(cottonPriceUSDperLb: number, fxUsdInr: number): number {
  return computeCostBuildUp(cottonPriceUSDperLb, fxUsdInr).perUnitINR.jupiterFloor;
}

export function computeTommyCeiling(cottonPriceUSDperLb: number, fxUsdInr: number): number {
  return computeCostBuildUp(cottonPriceUSDperLb, fxUsdInr).perUnitINR.tommyCeiling;
}

export function printCostBuildUp(cb: CostBuildUp, label = "T-SHIRT COST BUILD-UP") {
  const D = "\x1b[2m", B = "\x1b[1m", CY = "\x1b[36m", R = "\x1b[0m";
  const u = cb.perUnitINR;
  console.log("");
  console.log(`  ${CY}${B}  [COST] ${label}${R}`);
  console.log(`  ${D}  Cotton           : $${cb.inputs.cottonPriceUSDperLb.toFixed(4)}/lb  x  ${cb.inputs.fxUsdInr.toFixed(2)} INR/USD${R}`);
  console.log(`  ${D}  Commodity index  : ${cb.inputs.commodityIndex.toFixed(3)} (0=cheap, 1=expensive)${R}`);
  console.log(`  ${D}  Raw cotton/shirt : Rs.${u.rawCotton}${R}`);
  console.log(`  ${D}  + Spinning/knit  : Rs.${u.spinningKnitting}${R}`);
  console.log(`  ${D}  + Dye/finish     : Rs.${u.dyeingFinishing}${R}`);
  console.log(`  ${D}  + CMT            : Rs.${u.cuttingStitching}${R}`);
  console.log(`  ${D}  + Trims/labels   : Rs.${u.trimsAndLabels}${R}`);
  console.log(`  ${D}  + Pack/freight   : Rs.${u.packingFreight}${R}`);
  console.log(`  ${D}  + Overhead       : Rs.${u.overhead}${R}`);
  console.log(`  ${D}  = True floor     : Rs.${u.trueFloor}${R}`);
  console.log(`  ${D}  + Market uplift  : Rs.${u.marketUplift}${R}`);
  console.log(`  ${B}  = Jupiter floor  : Rs.${u.jupiterFloor}${R}`);
  console.log(`  ${B}    Jupiter target : Rs.${u.jupiterTarget}${R}`);
  console.log(`  ${B}    Tommy target   : Rs.${u.tommyTarget}${R}`);
  console.log(`  ${B}    Tommy ceiling  : Rs.${u.tommyCeiling}${R}`);
  console.log("");
}
// ================= MCP SESSION MEMORY =================
// In-memory deal state shared across all 9 MCP tools within a session.
// Each tool writes its results here. Subsequent tools read from here.
// This means the OpenClaw agent doesn't need to manually pass every parameter.

export interface DealState {
  negotiationId: string;
  status: "NEGOTIATING" | "AGREED" | "INVOICED" | "DD_OFFERED" | "SETTLED" | "FAILED";

  // From negotiate_price
  agreedPrice?: number;
  quantity: number;
  rounds: { round: number; role: string; action: string; price: number }[];

  // From compute_dd_rate
  safeDDRate?: number;
  marginPrice?: number;

  // From generate_dd_offer
  invoiceId?: string;
  invoiceTotal?: number;
  invoiceDate?: string;
  dueDate?: string;

  // From calculate_early_payment_discount
  settlementDate?: string;
  discountedAmount?: number;
  savingAmount?: number;
  appliedRate?: number;
  daysEarly?: number;

  // From submit_dd_to_actus
  actusStatus?: "SUCCESS" | "FAILED" | "PENDING";
  actusContractId?: string;
  actusEvents?: any[];

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ── Market data (separate from deals — applies globally to the session) ──────

export interface MarketState {
  adjustedMarginPrice: number;     // commodity-adjusted margin (e.g. ₹367)
  adjustedSafetyFactor: number;    // SOFR-adjusted (e.g. 0.53)
  sofrRate: number;                // e.g. 0.0455
  cottonPricePerLb: number;        // e.g. 0.78
  effectiveBorrowingRate: number;  // e.g. 0.0509
  fetchedAt: string;               // ISO timestamp
}

class MCPSessionMemory {
  private deals = new Map<string, DealState>();
  private currentDealId: string | null = null;
  private _marketData: MarketState | null = null;

  // ── Market data ─────────────────────────────────────────────────────────

  setMarketData(data: MarketState): void {
    this._marketData = data;
  }

  getMarketData(): MarketState | null {
    return this._marketData;
  }

  // ── Deal management ─────────────────────────────────────────────────────

  createDeal(negotiationId?: string, quantity: number = 2000): DealState {
    const id = negotiationId ?? `NEG-${Date.now()}`;
    const deal: DealState = {
      negotiationId: id,
      status: "NEGOTIATING",
      quantity,
      rounds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.deals.set(id, deal);
    this.currentDealId = id;
    return deal;
  }

  getCurrentDeal(): DealState | null {
    if (this.currentDealId) return this.deals.get(this.currentDealId) ?? null;
    const all = Array.from(this.deals.values());
    return all.length > 0 ? all[all.length - 1] : null;
  }

  getDeal(negotiationId: string): DealState | null {
    return this.deals.get(negotiationId) ?? null;
  }

  updateCurrentDeal(updates: Partial<DealState>): DealState | null {
    const deal = this.getCurrentDeal();
    if (!deal) return null;
    Object.assign(deal, updates, { updatedAt: new Date().toISOString() });
    return deal;
  }

  addRound(round: number, role: string, action: string, price: number): DealState | null {
    const deal = this.getCurrentDeal();
    if (!deal) return null;
    deal.rounds.push({ round, role, action, price });
    if (action === "ACCEPT") {
      deal.agreedPrice = price;
      deal.status = "AGREED";
    }
    deal.updatedAt = new Date().toISOString();
    return deal;
  }

  getAllDeals(): DealState[] {
    return Array.from(this.deals.values());
  }

  getPriceHistory(): { negotiationId: string; agreedPrice: number; rounds: number }[] {
    return this.getAllDeals()
      .filter(d => d.agreedPrice !== undefined)
      .map(d => ({
        negotiationId: d.negotiationId,
        agreedPrice: d.agreedPrice!,
        rounds: d.rounds.length,
      }));
  }
}

export const sessionMemory = new MCPSessionMemory();

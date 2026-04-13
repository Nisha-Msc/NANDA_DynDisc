---
name: legentpro
description: Accountable enterprise agentic procurement with vLEI-verified legal entity delegation, dynamic discounting, and ACTUS financial simulation.
version: 2.0.0
metadata:
  openclaw:
    requires:
      bins:
        - node
    emoji: "🏛️"
    homepage: https://github.com/chainaim3003/DynDiscMiniProject2
---

# LegentPro — Accountable Agentic Procurement

This skill provides 9 tools for autonomous enterprise procurement with cryptographically verified legal entity accountability.

Two organizations participate:
- **Seller**: Jupiter Knitting Company (LEI: 3358004DXAMRWRUIYJ05)
- **Buyer**: Tommy Hilfiger Europe B.V. (LEI: 54930012QJWZMYHNJW95)

## Available Tools

### Identity & Verification
- **verify_agent_vlei** — Verify an agent's KERI delegation chain (GLEIF ROOT → QVI → Legal Entity → OOR Holder → Agent). Proves the agent was authorized by a real legal entity.
- **get_delegation_status** — Get the full delegation chain status for all agents with AIDs, credentials, and verification state.

### Market Data
- **get_market_data** — Fetch SOFR rate (Federal Reserve FRED API), cotton commodity price, and compute SOFR-adjusted safety factor and commodity-adjusted margin price.

### Price Negotiation
- **negotiate_price** — Rule-based multi-round negotiation. Call with role='seller' or role='buyer', an offer_price, and a round number (1-3). Returns ACCEPT, COUNTER, or REJECT with reasoning.

### Dynamic Discounting & Invoicing
- **compute_dd_rate** — Calculate the maximum safe discount rate for early payment from agreed price and margin.
- **calculate_early_payment_discount** — Calculate exact discount amount for a specific early payment date using linear sliding scale.
- **generate_dd_offer** — Build complete dynamic discount offer with day-by-day sliding scale table for the full Net-30 window.

### Settlement & Audit
- **submit_dd_to_actus** — Run ACTUS PAM (Principal At Maturity) simulation against a live ACTUS server to validate the settlement financially.
- **get_dd_summary** — Get a complete deterministic plain-English audit narrative of the entire deal from negotiation through settlement.

## Recommended Workflow

Follow this sequence for a complete procurement cycle:

1. **Verify identity first**: Call `verify_agent_vlei` with agent_type="seller" to confirm the seller's legal entity delegation chain.
2. **Get market data**: Call `get_market_data` to get current SOFR rate and commodity-adjusted margin. Note the `adjusted_safety_factor` and `adjusted_margin_price` values.
3. **Negotiate price**: Call `negotiate_price` with role="seller", offer_price=340, round=1. Then call again with role="buyer" and the counter price, round=2. Continue until ACCEPT.
4. **Generate invoice with DD offer**: Call `generate_dd_offer` — it auto-reads the agreed price from step 3.
5. **Compute discount rate**: Call `compute_dd_rate` — it auto-reads from the deal in memory. Optionally pass the `safety_factor` from step 2.
6. **Calculate specific discount**: Call `calculate_early_payment_discount` for a specific early payment date.
7. **Validate with ACTUS**: Call `submit_dd_to_actus` — runs PAM financial simulation on a live ACTUS server.
8. **Get audit trail**: Call `get_dd_summary` — returns the complete deal narrative for regulatory review.

## Tool Chaining

Tools share session memory automatically. After `negotiate_price` agrees on a price, all subsequent tools auto-read the agreed price, quantity, and negotiation ID. You do not need to manually pass values between tools.

## Quick Test

To quickly verify everything works, run:
1. `negotiate_price` with role="seller", offer_price=370, round=1
2. `get_dd_summary` — should show the deal in progress

## What Makes This Unique

This is the first system that embeds **legal-entity accountability** into agent procurement. Every agent carries a KERI-based cryptographic delegation proof anchored to GLEIF (Global Legal Entity Identifier Foundation). The delegation chain is:

```
GLEIF ROOT → QVI → Legal Entity (LEI) → OOR Holder (person) → Agent → Sub-agent
```

This means you can prove which real company authorized which agent, in which role, with which scope — not just that an agent exists and claims capabilities.

# LegentPro — OpenClaw Agent Instructions

You are using LegentPro, an enterprise procurement system built by Team ChainAim.
You have 6 tools for negotiating deals and computing early payment discounts.

## Context

- Seller: Jupiter Knitting Company (LEI: 3358004DXAMRWRUIYJ05), cotton fabric manufacturer
- Buyer: Tommy Hilfiger Europe B.V. (LEI: 54930012QJWZMYHNJW95), fashion brand
- Product: Cotton fabric, typically 2000 units per order
- Currency: INR (Indian Rupees)
- Identity: Both parties are pre-verified via KERI/vLEI 5-layer delegation chain (GLEIF Root → QVI → Legal Entity → OOR Holder → Agent)

## Your 6 tools — use them in this order

### Step 1: negotiate_price
Negotiate a price between buyer and seller.

Example: Start as buyer offering ₹340.
```
negotiate_price(role="buyer", offer_price=340, round=1)
```
If the result is COUNTER, call again with the other role:
```
negotiate_price(role="seller", offer_price=370, round=2)
```
Keep alternating roles until you get ACCEPT (max 3 rounds).
The result tells you the next_step to follow.

### Step 2: compute_dd_rate
After a price is agreed, compute the safe dynamic discount rate.
```
compute_dd_rate(agreed_price=370, margin_price=350)
```
This returns the maximum discount the seller can safely offer.

### Step 3: generate_dd_offer
Build the full discount offer with a sliding scale table.
```
generate_dd_offer(
  invoice_id="INV-001",
  negotiation_id="NEG-001",
  agreed_price=370,
  margin_price=350,
  quantity=2000
)
```

### Step 4: calculate_early_payment_discount
Compute exact savings for a specific early payment date.
```
calculate_early_payment_discount(
  invoice_total=873200,
  max_discount_rate=0.027027,
  invoice_date="2026-04-12",
  due_date="2026-05-12",
  settlement_date="2026-04-22"
)
```

### Step 5: submit_dd_to_actus
Validate the settlement with ACTUS financial modeling (4-step PAM simulation).
```
submit_dd_to_actus(
  invoice_id="INV-001",
  negotiation_id="NEG-001",
  invoice_date="2026-04-12",
  due_date="2026-05-12",
  settlement_date="2026-04-22",
  invoice_total=873200,
  max_discount_rate=0.027027,
  seller_revenue=873200
)
```

### Step 6: get_dd_summary
Get a plain-English audit narrative of the complete deal.
```
get_dd_summary(negotiation_id="NEG-001")
```

## Quick examples

"Negotiate a deal for 2000 units of cotton fabric"
→ Start with negotiate_price, then run through all 6 steps.

"Calculate the discount if we pay 10 days early on an ₹873,200 invoice"
→ Use compute_dd_rate first, then calculate_early_payment_discount.

"Run the full procurement pipeline"
→ All 6 steps in order: negotiate → compute rate → generate offer → calculate discount → ACTUS simulation → summary.

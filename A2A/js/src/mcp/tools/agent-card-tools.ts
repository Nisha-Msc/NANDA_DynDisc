// ================= AGENT CARD TOOLS — MCP TOOLS 12 & 13 =================
// (numbered 15 conceptually but registered as Tools 12 and 13 in server-sse.ts —
//  ordering matters for tool registration; "Tool 15" was a planning name only)
//
// HTTP-GET passthroughs to the live A2A agents on AWS to expose their agent
// cards (LEI, KERI delegation chain, OOBI URLs, verification path) to MCP
// clients like OpenClaw.
//
// AWS endpoints:
//   - Buyer  (Tommy Hilfiger):  http://54.84.215.140:9090/.well-known/agent-card.json
//   - Seller (Jupiter Knitting): http://54.84.215.140:8080/.well-known/agent-card.json
//
// Override via BUYER_AGENT_URL / SELLER_AGENT_URL env vars.

const BUYER_AGENT_URL  = process.env.BUYER_AGENT_URL  ?? "http://54.84.215.140:9090";
const SELLER_AGENT_URL = process.env.SELLER_AGENT_URL ?? "http://54.84.215.140:8080";
const FETCH_TIMEOUT_MS = 8000;

export interface AgentCardResult {
  source:       "Tommy Hilfiger Buyer Agent (AWS)" | "Jupiter Knitting Seller Agent (AWS)";
  endpoint:     string;
  fetched_at:   string;
  http_status:  number;
  card?:        any;
  highlights?:  {
    legal_entity_name:    string;
    lei:                  string;
    official_role:        string;
    delegation_status:    string;
    verification_path:    string[];
    agent_aid:            string;
    legal_entity_aid:     string;
    qvi_aid:              string;
    gleif_endpoint:       string;
  };
  error?:       string;
}

function nowISO(): string {
  return new Date().toISOString();
}

async function fetchAgentCard(
  url: string,
  source: AgentCardResult["source"],
): Promise<AgentCardResult> {
  const endpoint = `${url}/.well-known/agent-card.json`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal:  controller.signal,
    });
    clearTimeout(tid);

    let card: any = null;
    try { card = await resp.json(); } catch { card = null; }

    if (!resp.ok || !card) {
      return {
        source,
        endpoint,
        fetched_at:  nowISO(),
        http_status: resp.status,
        error:       `Agent card unreachable: HTTP ${resp.status}`,
      };
    }

    // Extract the high-value parts so judges can see them at a glance.
    const ext  = card.extensions ?? {};
    const ident = ext.gleifIdentity ?? {};
    const meta  = ext.vLEImetadata  ?? {};
    const keri  = ext.keriIdentifiers ?? {};
    const gleif = ext.gleifVerification ?? {};

    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: resp.status,
      card,
      highlights: {
        legal_entity_name:  ident.legalEntityName ?? "—",
        lei:                ident.lei             ?? "—",
        official_role:      ident.officialRole    ?? "—",
        delegation_status:  meta.status           ?? "—",
        verification_path:  meta.verificationPath ?? [],
        agent_aid:          keri.agentAID         ?? "—",
        legal_entity_aid:   keri.legalEntityAID   ?? "—",
        qvi_aid:            keri.qviAID           ?? "—",
        gleif_endpoint:     gleif.gleifVerificationEndpoint ?? "—",
      },
    };
  } catch (err: any) {
    clearTimeout(tid);
    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: 0,
      error: err?.name === "AbortError"
        ? `Agent card request timed out after ${FETCH_TIMEOUT_MS}ms`
        : (err?.message ?? String(err)),
    };
  }
}

export async function handleGetBuyerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(BUYER_AGENT_URL, "Tommy Hilfiger Buyer Agent (AWS)");
}

export async function handleGetSellerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(SELLER_AGENT_URL, "Jupiter Knitting Seller Agent (AWS)");
}

// ================= AGENT CARD TOOLS — MCP TOOLS 12 & 13 =================
// HTTP-GET passthroughs to the live A2A agents on AWS to expose their agent cards.
//
// IPv4 fix v2: Use undici directly with family:4 to avoid Node fetch's IPv6
// preference + keep-alive complications that caused 30s hangs from Railway.

import { Agent, request as undiciRequest } from "undici";

const BUYER_AGENT_URL  = process.env.BUYER_AGENT_URL  ?? "http://54.84.215.140:9090";
const SELLER_AGENT_URL = process.env.SELLER_AGENT_URL ?? "http://54.84.215.140:8080";
const FETCH_TIMEOUT_MS = 30000;

const ipv4Dispatcher = new Agent({
  connect:             { family: 4 },
  pipelining:          0,
  keepAliveTimeout:    1,
  keepAliveMaxTimeout: 1,
});

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

  try {
    const { statusCode, body } = await undiciRequest(endpoint, {
      method:         "GET",
      headers:        { Accept: "application/json", Connection: "close" },
      dispatcher:     ipv4Dispatcher,
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout:    FETCH_TIMEOUT_MS,
    });

    const text = await body.text();

    if (statusCode < 200 || statusCode >= 300) {
      return {
        source,
        endpoint,
        fetched_at:  nowISO(),
        http_status: statusCode,
        error:       `Agent card unreachable: HTTP ${statusCode}`,
      };
    }

    let card: any = null;
    try { card = JSON.parse(text); } catch { card = null; }

    if (!card) {
      return {
        source,
        endpoint,
        fetched_at:  nowISO(),
        http_status: statusCode,
        error:       `Agent card body was not valid JSON`,
      };
    }

    const ext   = card.extensions ?? {};
    const ident = ext.gleifIdentity ?? {};
    const meta  = ext.vLEImetadata  ?? {};
    const keri  = ext.keriIdentifiers ?? {};
    const gleif = ext.gleifVerification ?? {};

    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: statusCode,
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
    const msg = err?.message ?? String(err);
    const isTimeout = msg.toLowerCase().includes("timeout")
      || err?.code === "UND_ERR_HEADERS_TIMEOUT"
      || err?.code === "UND_ERR_BODY_TIMEOUT";
    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: 0,
      error: isTimeout
        ? `Agent card request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Agent card request failed: ${msg}`,
    };
  }
}

export async function handleGetBuyerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(BUYER_AGENT_URL, "Tommy Hilfiger Buyer Agent (AWS)");
}

export async function handleGetSellerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(SELLER_AGENT_URL, "Jupiter Knitting Seller Agent (AWS)");
}
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
//
// IPv4 fix: Node 18+ fetch tries IPv6 first by default. On Railway's container,
// outbound IPv6 connections to AWS hosts can hang or fail silently before
// falling back to IPv4. We use Node's built-in http module with family:4 to
// force IPv4 and avoid the failure mode that produces http_status: 0.

import * as http from "node:http";
import { URL } from "node:url";

const BUYER_AGENT_URL  = process.env.BUYER_AGENT_URL  ?? "http://54.84.215.140:9090";
const SELLER_AGENT_URL = process.env.SELLER_AGENT_URL ?? "http://54.84.215.140:8080";
const FETCH_TIMEOUT_MS = 30000;

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

// IPv4-forced HTTP GET. Returns { status, body } or throws on network error / timeout.
function httpGetIPv4(rawUrl: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl);
    const options: http.RequestOptions = {
      hostname: u.hostname,
      port:     u.port || "80",
      path:     u.pathname + u.search,
      method:   "GET",
      family:   4,                                 // force IPv4 — fixes Railway -> AWS hang
      headers:  { Accept: "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data",  (chunk) => { data += chunk; });
      res.on("end",   () => resolve({ status: res.statusCode ?? 0, body: data }));
      res.on("error", reject);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.end();
  });
}

async function fetchAgentCard(
  url: string,
  source: AgentCardResult["source"],
): Promise<AgentCardResult> {
  const endpoint = `${url}/.well-known/agent-card.json`;

  try {
    const { status, body } = await httpGetIPv4(endpoint, FETCH_TIMEOUT_MS);

    if (status < 200 || status >= 300) {
      return {
        source,
        endpoint,
        fetched_at:  nowISO(),
        http_status: status,
        error:       `Agent card unreachable: HTTP ${status}`,
      };
    }

    let card: any = null;
    try { card = JSON.parse(body); } catch { card = null; }

    if (!card) {
      return {
        source,
        endpoint,
        fetched_at:  nowISO(),
        http_status: status,
        error:       `Agent card body was not valid JSON`,
      };
    }

    // Extract the high-value parts so judges can see them at a glance.
    const ext   = card.extensions ?? {};
    const ident = ext.gleifIdentity ?? {};
    const meta  = ext.vLEImetadata  ?? {};
    const keri  = ext.keriIdentifiers ?? {};
    const gleif = ext.gleifVerification ?? {};

    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: status,
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
    const isTimeout = (err?.message ?? "").includes("timed out");
    return {
      source,
      endpoint,
      fetched_at:  nowISO(),
      http_status: 0,
      error: isTimeout
        ? `Agent card request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Agent card request failed: ${err?.message ?? String(err)}`,
    };
  }
}

export async function handleGetBuyerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(BUYER_AGENT_URL, "Tommy Hilfiger Buyer Agent (AWS)");
}

export async function handleGetSellerAgentCard(): Promise<AgentCardResult> {
  return fetchAgentCard(SELLER_AGENT_URL, "Jupiter Knitting Seller Agent (AWS)");
}
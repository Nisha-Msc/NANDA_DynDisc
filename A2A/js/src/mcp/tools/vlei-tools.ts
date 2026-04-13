// ================= vLEI VERIFICATION TOOLS =================
// MCP wrappers around the vLEI REST API server (port 4000).
// These expose your KERI delegation verification to OpenClaw/MCP clients.

const VLEI_API_URL = process.env.VLEI_API_URL ?? "http://localhost:4000";

export interface VerifyAgentInput {
  agent_type: "seller" | "buyer";
  verification_type?: "DEEP" | "DEEP-EXT";
}

export interface DelegationStatusResult {
  success: boolean;
  agents: Record<string, any>;
  delegationChain: string[];
  timestamp: string;
  error?: string;
}

// ── Tool 7: verify_agent_vlei ─────────────────────────────────────────────────

export async function handleVerifyAgent(input: VerifyAgentInput): Promise<any> {
  const { agent_type, verification_type } = input;
  const vtype = verification_type ?? "DEEP";

  // Map: when buyer calls, it verifies seller, and vice versa
  const caller = agent_type === "buyer" ? "buyer" : "seller";
  const target = agent_type === "buyer" ? "seller" : "buyer";

  let endpoint: string;
  if (vtype === "DEEP-EXT") {
    endpoint = `${VLEI_API_URL}/api/${caller}/verify/ext/${target}`;
  } else {
    endpoint = `${VLEI_API_URL}/api/${caller}/verify/${target}`;
  }

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 60000); // 60s timeout — verification can be slow

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(tid);

    const result = await resp.json();

    return {
      verified: result.success ?? false,
      agent_type,
      verification_type: vtype,
      caller,
      target,
      details: result,
      timestamp: new Date().toISOString(),
      explanation: result.success
        ? `✓ ${agent_type} agent's vLEI delegation chain is cryptographically verified via ${vtype}. ` +
          `The agent was authorized by a real legal entity through GLEIF ROOT → QVI → Legal Entity → OOR Holder → Agent.`
        : `✗ Verification failed for ${agent_type} agent. ${result.error ?? "Check that vLEI infrastructure is running."}`,
    };
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    const isConnRefused = err?.cause?.code === "ECONNREFUSED";

    return {
      verified: false,
      agent_type,
      verification_type: vtype,
      error: isConnRefused
        ? `vLEI API server not reachable at ${VLEI_API_URL}. Start it with: cd legentvLEI/api-server && node server.js`
        : isTimeout
        ? `Verification timed out after 60s. The KERI verification may need Docker containers running.`
        : (err?.message ?? String(err)),
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Tool 8: get_delegation_status ─────────────────────────────────────────────

export async function handleGetDelegationStatus(): Promise<DelegationStatusResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(`${VLEI_API_URL}/api/status`, {
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!resp.ok) {
      return {
        success: false,
        agents: {},
        delegationChain: [],
        timestamp: new Date().toISOString(),
        error: `API returned HTTP ${resp.status}`,
      };
    }

    const data = await resp.json();

    // Build human-readable delegation chain
    const chain = [
      "L1: GLEIF ROOT (root of trust)",
      "L2: QVI (Qualified vLEI Issuer)",
      `L3: Legal Entities — Jupiter Knitting (LEI: 3358004DXAMRWRUIYJ05), Tommy Hilfiger (LEI: 54930012QJWZMYHNJW95)`,
      "L4: OOR Holders — Chief Sales Officer, Chief Procurement Officer",
      "L5: Delegated Agents — jupiterSellerAgent, tommyBuyerAgent",
      "L5+: Sub-delegated — JupiterTreasuryAgent (scoped: cashflow/DD)",
    ];

    return {
      success: true,
      agents: data,
      delegationChain: chain,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const isConnRefused = err?.cause?.code === "ECONNREFUSED";

    return {
      success: false,
      agents: {},
      delegationChain: [],
      timestamp: new Date().toISOString(),
      error: isConnRefused
        ? `vLEI API server not reachable at ${VLEI_API_URL}. Start it with: cd legentvLEI/api-server && node server.js`
        : (err?.message ?? String(err)),
    };
  }
}

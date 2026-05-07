// ================= GLEIF LOOKUP â€” MCP TOOL (Tool 10) =================
// Wraps the public GLEIF Global LEI Index for the LegentPro MCP server.
// Returns GLEIF API response AS-IS (no field reshaping).

import { z } from "zod";
import {
  lookupByLEI,
  searchByName,
  type GleifLookupResult,
} from "../../shared/gleif-client.js";

export const LookupGleifEntitySchema = z.object({
  legal_name: z.string().min(1).describe(
    "Legal entity name (REQUIRED). E.g. Tommy Hilfiger Europe or Jupiter Knitting Company."
  ),
  lei: z.string().length(20).optional().describe(
    "20-character LEI (OPTIONAL). If provided, performs direct lookup."
  ),
  country: z.string().length(2).optional().describe(
    "ISO 3166-1 alpha-2 country code (OPTIONAL). E.g. NL, IN."
  ),
});

export type LookupGleifEntityInput = z.infer<typeof LookupGleifEntitySchema>;

export async function handleLookupGleifEntity(raw: unknown): Promise<{
  query:        { legal_name: string; lei?: string; country?: string };
  method:       "DIRECT_LEI_LOOKUP" | "NAME_SEARCH";
  result:       GleifLookupResult;
}> {
  const input = LookupGleifEntitySchema.parse(raw);

  if (input.lei) {
    const result = await lookupByLEI(input.lei);
    return {
      query: {
        legal_name: input.legal_name,
        lei:        input.lei,
        ...(input.country ? { country: input.country.toUpperCase() } : {}),
      },
      method: "DIRECT_LEI_LOOKUP",
      result,
    };
  }

  const result = await searchByName(input.legal_name, input.country);
  return {
    query: {
      legal_name: input.legal_name,
      ...(input.country ? { country: input.country.toUpperCase() } : {}),
    },
    method: "NAME_SEARCH",
    result,
  };
}
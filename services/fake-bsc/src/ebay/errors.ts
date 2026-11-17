/**
 * eBay's error body (CONTRACT.md, "Fake eBay"): `{errors: [ErrorDetailV3]}`,
 * as every eBay REST API answers a refusal. NB reads `errors[].errorId`, and
 * logs `message`, `longMessage`, `parameters` and `inputRefIds`. The OpenAPI
 * contracts type this body inconsistently (the Inventory contract names the
 * bare Error object), so it is built here from eBay's error-handling guide.
 * Messages are fixed text: never an echo of the request.
 */

export interface EbayErrorDetail {
  errorId: number;
  domain: string;
  category: "REQUEST" | "BUSINESS" | "APPLICATION";
  message: string;
  longMessage?: string;
  parameters?: Array<{ name: string; value: string }>;
}

/** The ids the fake answers, with the text eBay uses for them where known. */
const KNOWN: Record<number, { domain: string; category: EbayErrorDetail["category"]; message: string }> = {
  1001: { domain: "OAuth", category: "REQUEST", message: "Invalid access token" },
  2004: { domain: "ACCESS", category: "REQUEST", message: "Invalid request" },
  20400: { domain: "API_ACCOUNT", category: "REQUEST", message: "Invalid request. A policy with this name already exists." },
  20403: { domain: "API_ACCOUNT", category: "REQUEST", message: "Invalid programType. The seller is not opted in to business policies." },
  20409: { domain: "API_ACCOUNT", category: "REQUEST", message: "The seller is already opted in to this program." },
  25001: { domain: "API_INVENTORY", category: "APPLICATION", message: "A system error has occurred." },
  25002: { domain: "API_INVENTORY", category: "REQUEST", message: "A user error has occurred." },
  25007: { domain: "API_INVENTORY", category: "REQUEST", message: "Please add at least one valid shipping service option to your listing." },
  25702: { domain: "API_INVENTORY", category: "REQUEST", message: "SKU could not be found." },
  25709: { domain: "API_INVENTORY", category: "REQUEST", message: "Invalid value for a field in the request." },
  25710: { domain: "API_INVENTORY", category: "REQUEST", message: "We didn't find the resource/entity you are requesting." },
  25713: { domain: "API_INVENTORY", category: "REQUEST", message: "This Offer is not available." },
  25717: { domain: "API_INVENTORY", category: "REQUEST", message: "imageUrls cannot be null or empty." },
  25803: { domain: "API_INVENTORY", category: "REQUEST", message: "merchantLocationKey already exists." },
  25804: { domain: "API_INVENTORY", category: "REQUEST", message: "Location not found." },
  190011: { domain: "API_MEDIA", category: "REQUEST", message: "The image was not found." },
  190202: { domain: "API_MEDIA", category: "REQUEST", message: "The 'image' part of the request is missing or invalid." },
  195000: { domain: "API_NOTIFICATION", category: "REQUEST", message: "The public key was not found." },
};

export function ebayErrorDetail(errorId: number, longMessage?: string): EbayErrorDetail {
  const k = KNOWN[errorId] ?? { domain: "API_FAKE", category: "REQUEST" as const, message: "A fault injected by the fake eBay." };
  return { errorId, domain: k.domain, category: k.category, message: k.message, ...(longMessage ? { longMessage } : {}) };
}

export function ebayErrorBody(errorIds: readonly number[], longMessage?: string): { errors: EbayErrorDetail[] } {
  return { errors: errorIds.map((id) => ebayErrorDetail(id, longMessage)) };
}

/** The 401 eBay answers a missing, expired or foreign access token. */
export const UNAUTHORIZED_BODY = {
  errors: [
    {
      errorId: 1001,
      domain: "OAuth",
      category: "REQUEST",
      message: "Invalid access token",
      longMessage: "Invalid access token. Check the value of the Authorization HTTP request header.",
    },
  ],
};

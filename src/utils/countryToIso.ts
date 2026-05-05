/**
 * Maps common full country names (as they may be stored in the DB)
 * to their ISO 3166-1 alpha-2 codes accepted by Stripe.
 *
 * Add more entries as needed.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  "afghanistan": "AF", "albania": "AL", "algeria": "DZ", "argentina": "AR",
  "australia": "AU", "austria": "AT", "bangladesh": "BD", "belgium": "BE",
  "brazil": "BR", "canada": "CA", "chile": "CL", "china": "CN",
  "colombia": "CO", "croatia": "HR", "czech republic": "CZ", "denmark": "DK",
  "egypt": "EG", "ethiopia": "ET", "finland": "FI", "france": "FR",
  "germany": "DE", "ghana": "GH", "greece": "GR", "hong kong": "HK",
  "hungary": "HU", "india": "IN", "indonesia": "ID", "ireland": "IE",
  "israel": "IL", "italy": "IT", "japan": "JP", "kenya": "KE",
  "malaysia": "MY", "mexico": "MX", "netherlands": "NL", "new zealand": "NZ",
  "nigeria": "NG", "norway": "NO", "pakistan": "PK", "peru": "PE",
  "philippines": "PH", "poland": "PL", "portugal": "PT", "romania": "RO",
  "russia": "RU", "saudi arabia": "SA", "singapore": "SG", "south africa": "ZA",
  "south korea": "KR", "spain": "ES", "sri lanka": "LK", "sweden": "SE",
  "switzerland": "CH", "taiwan": "TW", "tanzania": "TZ", "thailand": "TH",
  "turkey": "TR", "ukraine": "UA", "united arab emirates": "AE",
  "united kingdom": "GB", "united states": "US", "usa": "US", "uk": "GB",
  "vietnam": "VN",
};

/**
 * Given either a full country name ("India") or an ISO code ("IN"),
 * returns the 2-letter ISO code Stripe expects.
 * Falls back to "US" if unrecognised.
 */
export function toStripeCountryCode(country: string | null | undefined): string {
  if (!country) return "US";

  const trimmed = country.trim();

  // Already a valid 2-letter code — return uppercased
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const iso = COUNTRY_NAME_TO_ISO[trimmed.toLowerCase()];
  if (iso) return iso;

  // Last resort — return uppercased as-is and let Stripe surface the error
  console.warn(`[toStripeCountryCode] Unrecognised country: "${trimmed}", defaulting to "US"`);
  return "US";
}
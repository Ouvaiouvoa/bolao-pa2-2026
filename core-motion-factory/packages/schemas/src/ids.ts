/** Prefixes used by every persisted entity. Keeps ids self-describing in logs and URLs. */
export const ID_PREFIXES = {
  organization: "org",
  user: "usr",
  session: "ses",
  brand: "brand",
  brandAsset: "basset",
  project: "prj",
  brief: "brf",
  upload: "upl",
  asset: "ast",
  transcript: "trn",
  artifact: "art",
  editPlan: "epl",
  render: "rnd",
  agentRun: "run",
  comment: "cmt",
  approvalRequest: "areq",
  approval: "apv",
  trace: "trc",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish base32, lowercase

export function randomToken(length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomToken(16)}`;
}

export function isIdOf(kind: IdKind, value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${ID_PREFIXES[kind]}_`);
}

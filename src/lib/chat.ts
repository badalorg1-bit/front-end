// Chat client — talks to the `chat` Supabase Edge Function only.
// The Gemini key never reaches the browser; this module sends the public anon key only.

import type { ListingType, RentalUnit } from "@/lib/types";

export type ChatProduct = {
  id: string;
  title: string;
  category: string;
  city: string;
  listing_type: ListingType;
  rental_price: number | null;
  rental_unit: RentalUnit | null;
  sale_price: number | null;
  image_url: string | null;
};

export type ChatTier = 1 | 2 | 3 | "info";

export type ChatResponse = {
  reply: string;
  tier: ChatTier;
  products: ChatProduct[];
};

export type ChatHistoryEntry = { role: "user" | "model"; text: string };

export class ChatError extends Error {
  /** 0 = client-side failure (network/timeout/not configured); otherwise HTTP status from the function. */
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `chat_error_${status}`);
    this.name = "ChatError";
    this.status = status;
  }
}

const HISTORY_KEY = "badal.chat.history.v1";
const MAX_HISTORY = 10;
const MAX_MESSAGE = 500;
const MAX_PRODUCTS = 8;
const REQUEST_TIMEOUT_MS = 45_000;

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

function sanitizeHistory(raw: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (e.role !== "user" && e.role !== "model") continue;
    if (typeof e.text !== "string") continue;
    const text = e.text.trim();
    if (!text || text.length > MAX_MESSAGE) continue;
    out.push({ role: e.role, text });
  }
  return out.slice(-MAX_HISTORY);
}

export function loadChatHistory(): ChatHistoryEntry[] {
  try {
    return sanitizeHistory(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function pushChatHistory(entry: ChatHistoryEntry): ChatHistoryEntry[] {
  const next = sanitizeHistory([...loadChatHistory(), entry]);
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode / quota) — caller keeps in-memory state
  }
  return next;
}

export function clearChatHistory(): void {
  try {
    sessionStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

function isProduct(p: unknown): p is ChatProduct {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.title === "string";
}

export async function postChat(
  message: string,
  history: ChatHistoryEntry[],
): Promise<ChatResponse> {
  const msg = message.trim();
  if (!msg || msg.length > MAX_MESSAGE) throw new ChatError(0, "invalid_message");
  if (!supabaseUrl || !anonKey) throw new ChatError(0, "not_configured");

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ message: msg, history: sanitizeHistory(history) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ChatError(0, "network");
  }

  if (!res.ok) throw new ChatError(res.status);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ChatError(0, "bad_json");
  }
  if (!data || typeof data !== "object") throw new ChatError(0, "bad_body");
  const { reply, tier, products } = data as Record<string, unknown>;
  if (typeof reply !== "string") throw new ChatError(0, "bad_body");

  const chatTier: ChatTier = tier === 1 || tier === 2 || tier === 3 ? tier : "info";
  const list = Array.isArray(products) ? products.filter(isProduct).slice(0, MAX_PRODUCTS) : [];
  return { reply, tier: chatTier, products: list };
}

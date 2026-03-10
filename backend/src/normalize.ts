export type DealBucket =
  | "ACTIVE_PIPELINE"
  | "WON"
  | "LOST"
  | "ON_HOLD"
  | "DISQUALIFIED"
  | "UNKNOWN";

export function normText(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;

  const k = s.toLowerCase();
  // remove junk header-like values that appear in messy exports
  if (["na", "n/a", "null", "none", "-", "deal status", "deal stage"].includes(k)) return null;

  return s.replace(/\s+/g, " ");
}

export function normKey(x: unknown): string | null {
  const t = normText(x);
  return t ? t.toLowerCase() : null;
}

export function safeJson(x: unknown): any | null {
  if (!x) return null;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

export function parseDate(cellText: unknown, cellValue: unknown, prefer: "from" | "to" = "from"): Date | null {
  const raw = safeJson(cellValue);

  // Date column: {"date":"YYYY-MM-DD"}
  const rawDate: string | undefined = raw?.date;
  if (rawDate && typeof rawDate === "string") {
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? null : d;
  }

  // Timeline column: {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}
  const rawFrom: string | undefined = raw?.from;
  const rawTo: string | undefined = raw?.to;

  const chosen =
    (prefer === "to" ? rawTo : rawFrom) ??
    rawTo ??
    rawFrom;

  if (chosen && typeof chosen === "string") {
    const d = new Date(chosen);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: parse text (least reliable)
  const s0 = normText(cellText);
  if (!s0) return null;
  const s = s0.trim();

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [_, yy, mm, dd] = m;
    const d = new Date(Number(yy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [_, dd, mm, yy] = m;
    const d = new Date(Number(yy), Number(mm) - 1, Number(dd));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function quarterKey(d: Date | null): string | null {
  if (!d) return null;
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function currentQuarterKey(): string {
  return quarterKey(new Date())!;
}

export function parseMoney(x: unknown): number | null {
  const s = normText(x);
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "-.") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** High/Medium/Low or percent or decimal */
export function parseProbability(x: unknown): number | null {
  const s = normText(x);
  if (!s) return null;
  const k = s.toLowerCase();

  if (k === "high") return 0.75;
  if (k === "medium") return 0.5;
  if (k === "low") return 0.25;

  if (k.endsWith("%")) {
    const n = Number(k.replace("%", ""));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : null;
  }

  const n = Number(k);
  if (!Number.isFinite(n)) return null;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

export function extractCode(x: unknown): string | null {
  const s = normText(x);
  if (!s) return null;
  const m = s.match(/^([A-Z])\s*\./);
  return m ? m[1] : null;
}

/**
 * Stage can conflict with status in your data.
 * If stage clearly implies outcome (won/lost/on-hold/not-relevant), it overrides status.
 */
export function bucketFromDealStage(stage: unknown): DealBucket {
  const s = (normText(stage) ?? "").toLowerCase();
  const code = extractCode(stage);

  if (s.includes("project lost")) return "LOST";
  if (s.includes("not relevant")) return "DISQUALIFIED";
  if (s.includes("on hold")) return "ON_HOLD";
  if (s.includes("invoice")) return "WON";
  if (s.includes("work order received") || s.includes("wo received") || s.includes("po received")) return "WON";
  if (s.includes("project won")) return "WON";

  if (!code) return "UNKNOWN";

  if (["G", "H", "J"].includes(code)) return "WON";
  if (code === "L") return "LOST";
  if (code === "M") return "ON_HOLD";
  if (["N", "O"].includes(code)) return "DISQUALIFIED";

  if (["A","B","C","D","E","F","I"].includes(code)) return "ACTIVE_PIPELINE";

  return "UNKNOWN";
}

export function bucketFromDealStatus(status: unknown): DealBucket {
  const k = normKey(status);
  if (!k) return "UNKNOWN";
  if (k === "open") return "ACTIVE_PIPELINE";
  if (k === "won") return "WON";
  if (k === "dead") return "LOST";
  if (k === "on hold") return "ON_HOLD";
  return "UNKNOWN";
}

export function deriveDealBucket(status: unknown, stage: unknown): DealBucket {
  const bStage = bucketFromDealStage(stage);
  if (["WON","LOST","ON_HOLD","DISQUALIFIED"].includes(bStage)) return bStage;

  const bStatus = bucketFromDealStatus(status);
  if (bStatus !== "UNKNOWN") return bStatus;

  if (bStage === "ACTIVE_PIPELINE") return "ACTIVE_PIPELINE";
  return "UNKNOWN";
}
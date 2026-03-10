import { MondayClient } from "./monday.js";
import type { Deal, WorkOrder } from "./types.js";
import {
  normText, normKey, parseMoney, parseProbability,
  parseDate, quarterKey, currentQuarterKey, deriveDealBucket
} from "./normalize.js";
import { formatINR } from "./format.js";

/** Exact column titles from your boards */
const DEALS_COLS = {
  deal_name: "Deal Name",
  owner_code: "Owner code",
  client_code: "Client Code",
  deal_status: "Deal Status",
  close_actual: "Close Date (A)",
  closure_probability: "Closure Probability",
  amount: "Masked Deal value",
  close_tentative: "Tentative Close Date",
  deal_stage: "Deal Stage",
  sector: "Sector/service",
  created_date: "Created Date"
} as const;

const WORK_COLS = {
  deal_name: "Deal name masked",
  customer: "Customer Name Code",
  execution_status: "Execution Status",
  data_delivery_date: "Data Delivery Date",
  probable_start: "Probable Start Date",
  probable_end: "Probable End Date",
  sector: "Sector",
  amount_excl_gst: "Amount in Rupees (Excl of GST) (Masked)",
  billed_excl_gst: "Billed Value in Rupees (Excl of GST.) (Masked)",
  collected_incl_gst: "Collected Amount in Rupees (Incl of GST.) (Masked)",
  receivable: "Amount Receivable (Masked)",
  invoice_status: "Invoice Status",
  collection_status: "Collection status",
  collection_date: "Collection Date",
  billing_status: "Billing Status"
} as const;

/** Convert monday items into a row with BOTH text and raw value per column title */
function itemsToRows(
  items: any[],
  colIdToTitle: Record<string,string>
): Array<Record<string, { text: any; value: any }>> {
  return items.map(it => {
    const row: Record<string, { text: any; value: any }> = {};
    row["_name"] = { text: it.name, value: null };

    for (const cv of it.column_values ?? []) {
      const title = colIdToTitle[cv.id] ?? cv.id;
      row[title] = { text: cv.text ?? null, value: cv.value ?? null };
    }
    return row;
  });
}

export async function loadDeals(client: MondayClient, boardId: number): Promise<Deal[]> {
  const cols = await client.getBoardColumns(boardId);
  const colIdToTitle = Object.fromEntries(cols.map(c => [c.id, c.title]));
  const items = await client.getAllItems(boardId);
  const rows = itemsToRows(items, colIdToTitle);

    return rows.map(r => {
    const status = normText(r[DEALS_COLS.deal_status]?.text);
    const stage  = normText(r[DEALS_COLS.deal_stage]?.text);

    const closeActualCell = r[DEALS_COLS.close_actual];
    const closeTentCell   = r[DEALS_COLS.close_tentative];
    const createdCell     = r[DEALS_COLS.created_date];

    // For timeline columns, prefer "to" as the "end/close" date
    const close =
        parseDate(closeActualCell?.text, closeActualCell?.value, "to") ??
        parseDate(closeTentCell?.text, closeTentCell?.value, "to");

    const sector = normText(r[DEALS_COLS.sector]?.text);

    return {
        deal_name: normText(r[DEALS_COLS.deal_name]?.text) ?? normText(r["_name"]?.text),
        owner_code: normText(r[DEALS_COLS.owner_code]?.text),
        client_code: normText(r[DEALS_COLS.client_code]?.text),

        sector,
        sector_key: normKey(sector),

        deal_status: status,
        deal_stage: stage,
        bucket: deriveDealBucket(status, stage),

        amount: parseMoney(r[DEALS_COLS.amount]?.text),
        close_date: close,
        close_qtr: quarterKey(close),

        created_date: parseDate(createdCell?.text, createdCell?.value, "from"),
        closure_probability: parseProbability(r[DEALS_COLS.closure_probability]?.text)
    };
    });
}

export async function loadWorkOrders(client: MondayClient, boardId: number): Promise<WorkOrder[]> {
  const cols = await client.getBoardColumns(boardId);
  const colIdToTitle = Object.fromEntries(cols.map(c => [c.id, c.title]));
  const items = await client.getAllItems(boardId);
  const rows = itemsToRows(items, colIdToTitle);

  return rows.map(r => {
    const sector = normText(r[WORK_COLS.sector]?.text);
    return {
      deal_name: normText(r[WORK_COLS.deal_name]?.text) ?? normText(r["_name"]?.text),
      customer: normText(r[WORK_COLS.customer]?.text),

      sector,
      sector_key: normKey(sector),

      execution_status: normText(r[WORK_COLS.execution_status]?.text),

      probable_start: parseDate(r[WORK_COLS.probable_start]?.text, r[WORK_COLS.probable_start]?.value),
      probable_end: parseDate(r[WORK_COLS.probable_end]?.text, r[WORK_COLS.probable_end]?.value),
      data_delivery_date: parseDate(r[WORK_COLS.data_delivery_date]?.text, r[WORK_COLS.data_delivery_date]?.value),

      amount_excl_gst: parseMoney(r[WORK_COLS.amount_excl_gst]?.text),
      billed_excl_gst: parseMoney(r[WORK_COLS.billed_excl_gst]?.text),
      collected_incl_gst: parseMoney(r[WORK_COLS.collected_incl_gst]?.text),
      receivable: parseMoney(r[WORK_COLS.receivable]?.text),

      invoice_status: normText(r[WORK_COLS.invoice_status]?.text),
      billing_status: normText(r[WORK_COLS.billing_status]?.text),
      collection_status: normText(r[WORK_COLS.collection_status]?.text),
      collection_date: parseDate(r[WORK_COLS.collection_date]?.text, r[WORK_COLS.collection_date]?.value)
    };
  });
}

export function dealsDataQuality(deals: Deal[]) {
  const missRate = (xs: any[]) => xs.length ? xs.filter(v => v == null).length / xs.length : 1;

  return {
    rows: deals.length,
    missing_rates: {
      sector: missRate(deals.map(d => d.sector)),
      amount: missRate(deals.map(d => d.amount)),
      close_date: missRate(deals.map(d => d.close_date)),
      probability: missRate(deals.map(d => d.closure_probability)),
      stage: missRate(deals.map(d => d.deal_stage))
    }
  };
}

export function pipelineKpis(
  deals: Deal[],
  sector: string | null,
  quarter: string | null,
  includeOnHold: boolean | null
) {
  const q = quarter ?? currentQuarterKey();
  const sectorKey = sector ? sector.trim().toLowerCase() : null;
  const include = includeOnHold ?? false;

  // Sector-scoped (used for data-quality stats like missing close date)
  const sectorScoped = deals.filter(d => !sectorKey || d.sector_key === sectorKey);

  // Quarter-scoped (the actual view for "this quarter")
  const scoped = sectorScoped.filter(d => d.close_qtr === q);

  const sumAmount = (xs: Deal[]) => xs.reduce((s, d) => s + (d.amount ?? 0), 0);

  // Outcomes in this quarter scope (context)
  const lostDeals = scoped.filter(d => d.bucket === "LOST");
  const wonDeals = scoped.filter(d => d.bucket === "WON");
  const onHoldDeals = scoped.filter(d => d.bucket === "ON_HOLD");
  const disqDeals = scoped.filter(d => d.bucket === "DISQUALIFIED");

  const lost_value = sumAmount(lostDeals);
  const won_value = sumAmount(wonDeals);
  const on_hold_value_scoped = sumAmount(onHoldDeals);
  const disqualified_value = sumAmount(disqDeals);

  // Pipeline definition
  const active = scoped.filter(d => d.bucket === "ACTIVE_PIPELINE");

  const active_value = sumAmount(active);
  const on_hold_value = on_hold_value_scoped;

  // Weighted forecast for ACTIVE only (missing probability treated as 0)
  const weighted_active_value = active.reduce(
    (s, d) => s + (d.amount ?? 0) * (d.closure_probability ?? 0),
    0
  );

  const weighted_to_active_pct =
    active_value > 0 ? Math.round((weighted_active_value / active_value) * 100) : 0;

    const weighted_gap_pct = active_value > 0 ? Math.max(0, 100 - weighted_to_active_pct) : 0;

  // "pipeline_value" depends on include_on_hold flag
  const pipeline_value = include ? active_value + on_hold_value : active_value;
  const addressable_value = active_value + on_hold_value;

  // Stage breakdown (ACTIVE only)
  const stage_breakdown_amount: Record<string, number> = {};
  for (const d of active) {
    const k = d.deal_stage ?? "Unknown";
    stage_breakdown_amount[k] = (stage_breakdown_amount[k] ?? 0) + (d.amount ?? 0);
  }

  const stage_breakdown_sorted = Object.entries(stage_breakdown_amount)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, amount]) => {
      const share_pct = active_value > 0 ? Math.round((amount / active_value) * 100) : 0;
      return {
        stage,
        amount,
        amount_inr: formatINR(amount),
        share_pct,
        share_pct_str: `${share_pct}%`
      };
    });

  // Deal concentration (ACTIVE only)
  const activeSorted = [...active].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  const top1_value = activeSorted[0]?.amount ?? 0;
  const top3_value = activeSorted.slice(0, 3).reduce((s, d) => s + (d.amount ?? 0), 0);
  const top1_pct = active_value > 0 ? Math.round((top1_value / active_value) * 100) : 0;
  const top3_pct = active_value > 0 ? Math.round((top3_value / active_value) * 100) : 0;

  // Bucket breakdown (within quarter scope)
  const bucket_breakdown: Record<string, { count: number; value: number; value_inr: string }> = {};
  for (const d of scoped) {
    const b = d.bucket ?? "UNKNOWN";
    if (!bucket_breakdown[b]) bucket_breakdown[b] = { count: 0, value: 0, value_inr: "₹0" };
    bucket_breakdown[b].count += 1;
    bucket_breakdown[b].value += (d.amount ?? 0);
  }
  for (const b of Object.keys(bucket_breakdown)) {
    bucket_breakdown[b].value_inr = formatINR(bucket_breakdown[b].value);
  }

  // Top deals (ACTIVE only)
  const top_deals = [...activeSorted]
    .slice(0, 5)
    .map(d => ({
      deal_name: d.deal_name ?? "",
      client_code: d.client_code ?? "",
      owner_code: d.owner_code ?? "",
      stage: d.deal_stage ?? "Unknown",
      amount: d.amount ?? 0,
      amount_inr: formatINR(d.amount ?? 0),
      close_date: d.close_date ? d.close_date.toISOString().slice(0, 10) : ""
    }));

  // Data quality
  const active_missing_probability_count = active.filter(d => d.closure_probability == null).length;
  const missing_close_date_count = sectorScoped.filter(d => !d.close_qtr).length;

  return {
    filters: { sector, quarter: q, include_on_hold: include },

    counts: {
      active: active.length,
      on_hold: onHoldDeals.length,
      scoped_total: scoped.length
    },

    amounts: {
      active_value,
      weighted_active_value,
      on_hold_value,
      pipeline_value,
      addressable_value
    },

    ratios: {
      weighted_to_active_pct,
      weighted_gap_pct
    },

    formatted: {
      active_value_inr: formatINR(active_value),
      weighted_active_value_inr: formatINR(weighted_active_value),
      on_hold_value_inr: formatINR(on_hold_value),
      pipeline_value_inr: formatINR(pipeline_value),
      addressable_value_inr: formatINR(addressable_value),
      weighted_to_active_pct: `${weighted_to_active_pct}%`,
      weighted_gap_pct: `${weighted_gap_pct}%`
    },

    bucket_breakdown,
    stage_breakdown_sorted,
    top_deals,

    concentration: {
      top1_value,
      top1_value_inr: formatINR(top1_value),
      top1_pct,
      top1_pct_str: `${top1_pct}%`,
      top3_value,
      top3_value_inr: formatINR(top3_value),
      top3_pct,
      top3_pct_str: `${top3_pct}%`
    },

    outcomes_in_scope: {
      lost_count: lostDeals.length,
      lost_value,
      lost_value_inr: formatINR(lost_value),

      won_count: wonDeals.length,
      won_value,
      won_value_inr: formatINR(won_value),

      on_hold_count: onHoldDeals.length,
      on_hold_value: on_hold_value_scoped,
      on_hold_value_inr: formatINR(on_hold_value_scoped),

      disqualified_count: disqDeals.length,
      disqualified_value,
      disqualified_value_inr: formatINR(disqualified_value)
    },

    data_quality: {
      active_missing_probability_count,
      missing_close_date_count
    },

    assumptions: {
      pipeline_definition:
        "Pipeline includes ACTIVE_PIPELINE only; ON_HOLD excluded by default and reported separately.",
      weighted_forecast_rule:
        "Weighted forecast = sum(amount * probability). Missing probability treated as 0."
    }
  };
}

export function workOrderKpis(work: WorkOrder[], sector: string | null) {
  const sectorKey = sector ? sector.trim().toLowerCase() : null;
  const scoped = work.filter(w => !sectorKey || w.sector_key === sectorKey);

  const statusCounts: Record<string, number> = {};
  for (const w of scoped) {
    const k = w.execution_status ?? "Unknown";
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }

  const totals = {
    amount_excl_gst: scoped.reduce((s,w)=> s + (w.amount_excl_gst ?? 0), 0),
    billed_excl_gst: scoped.reduce((s,w)=> s + (w.billed_excl_gst ?? 0), 0),
    collected_incl_gst: scoped.reduce((s,w)=> s + (w.collected_incl_gst ?? 0), 0),
    receivable: scoped.reduce((s,w)=> s + (w.receivable ?? 0), 0)
  };

  return {
    filters: { sector },
    work_orders: scoped.length,
    execution_status_counts: statusCounts,
    totals
  };
}
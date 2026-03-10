import type { Deal, WorkOrder } from "./types.js";
import { currentQuarterKey } from "./normalize.js";
import { pipelineKpis, workOrderKpis } from "./analytics.js";

export function leadershipUpdate(deals: Deal[], work: WorkOrder[], sector?: string | null) {
  const q = currentQuarterKey();
  const pipe = pipelineKpis(deals, sector ?? null, q, false);
  const wo = workOrderKpis(work, sector ?? null);

  const risks: string[] = [];
  if (pipe.amounts.on_hold_value > 0) risks.push("Meaningful value is parked in On Hold deals.");
  if (pipe.counts.active > 0 && pipe.amounts.weighted_active_value / Math.max(1, pipe.amounts.active_value) < 0.4) {
    risks.push("Low weighted forecast vs total active pipeline (probability is low/unknown on many deals).");
  }
  if (wo.totals.receivable > 0) risks.push("Receivables outstanding (cash collection risk).");

  return {
    quarter: q,
    pipeline: pipe,
    work_orders: wo,
    exec_highlights: [
      `Active pipeline (excl. on-hold): ₹${Math.round(pipe.amounts.active_value).toLocaleString("en-IN")}`,
      `On-hold value (excluded): ₹${Math.round(pipe.amounts.on_hold_value).toLocaleString("en-IN")}`,
      `Weighted forecast (active): ₹${Math.round(pipe.amounts.weighted_active_value).toLocaleString("en-IN")}`,
      `Receivables (WO): ₹${Math.round(wo.totals.receivable).toLocaleString("en-IN")}`
    ],
    risks
  };
}
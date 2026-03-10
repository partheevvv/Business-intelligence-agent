export function buildPipelineDirectAnswer(toolResult: any) {
  const quarter = toolResult?.filters?.quarter ?? "current quarter";
  const sector = toolResult?.filters?.sector ? String(toolResult.filters.sector) : "all sectors";

  const activeCount = toolResult?.counts?.active ?? 0;
  const onHoldCount = toolResult?.counts?.on_hold ?? 0;

  const activeINR = toolResult?.formatted?.active_value_inr ?? "₹0";
  const onHoldINR = toolResult?.formatted?.on_hold_value_inr ?? "₹0";

  const weightedINR = toolResult?.formatted?.weighted_active_value_inr ?? "₹0";
  const weightedPct = toolResult?.formatted?.weighted_to_active_pct ?? "0%";
  const weightedGapPct = toolResult?.formatted?.weighted_gap_pct; // optional

  const sentence1 =
    `For ${sector} in ${quarter}, we have ${activeCount} active deals worth ${activeINR} and ${onHoldCount} on-hold deals worth ${onHoldINR}.`;

  // keep wording unambiguous and consistent with your definitions
  const sentence2 = weightedGapPct
    ? `Weighted forecast (active) is ${weightedINR} (${weightedPct} of active; ${weightedGapPct} below active).`
    : `Weighted forecast (active) is ${weightedINR} (${weightedPct} of active).`;

  return `${sentence1}\n${sentence2}`;
}
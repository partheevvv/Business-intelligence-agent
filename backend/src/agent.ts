import OpenAI from "openai";
import { z } from "zod";
import { MondayClient } from "./monday.js";
import {
  loadDeals,
  loadWorkOrders,
  pipelineKpis,
  workOrderKpis,
  dealsDataQuality
} from "./analytics.js";
import { leadershipUpdate } from "./leadership.js";
import { buildPipelineDirectAnswer } from "./narration.js";

function getLLM() {
  const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is missing but LLM_PROVIDER=groq");
    const baseURL = process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1";
    const model = process.env.LLM_MODEL ?? "llama-3.1-8b-instant";
    return { client: new OpenAI({ apiKey, baseURL }), model };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing and LLM_PROVIDER is not 'groq'");
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  return { client: new OpenAI({ apiKey }), model };
}

const SYSTEM = `
You are a founder-facing Business Intelligence agent for Skylark Drones.
You cannot invent numbers. All metrics must come from computed tool results.

Default business rules:
- "this quarter" means current quarter.
- Pipeline excludes On Hold by default, but report On Hold separately.
- If user asks "including on hold", include it.
- Ask a clarifying question when sector/timeframe is required but missing.
`.trim();

/**
 * Router output schema: model must output ONLY JSON matching this schema.
 */
const RouteSchema = z.object({
  action: z.enum([
    "get_pipeline_kpis",
    "get_work_order_kpis",
    "get_deals_data_quality",
    "get_leadership_update",
    "clarify"
  ]),
  args: z
    .object({
      sector: z.string().optional(),
      quarter: z.string().optional(),
      include_on_hold: z.boolean().optional(),
      question: z.string().optional()
    })
    .default({})
});

function extractJsonOnly(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function hasPipelineFormat(answer: string) {
  return (
    answer.includes("## Direct answer") &&
    answer.includes("## Key insights") &&
    answer.includes("## Top deals") &&
    answer.includes("## Data quality / caveats") &&
    answer.includes("₹")
  );
}

function hasGenericFormat(answer: string) {
  return (
    answer.includes("## Direct answer") &&
    answer.includes("## Key insights") &&
    answer.includes("## Data quality / caveats")
  );
}

export async function runAgent(opts: {
  message: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  mondayToken: string;
  dealsBoardId: number;
  workBoardId: number;
}) {
  const { client: llm, model } = getLLM();
  const monday = new MondayClient(opts.mondayToken);

  // ---------- 1) ROUTE ----------
  const routerPrompt = `
Decide what to do for the user's question.

Return ONLY a JSON object with:
- action: one of ["get_pipeline_kpis","get_work_order_kpis","get_deals_data_quality","get_leadership_update","clarify"]
- args: object
  - sector (string) optional
  - quarter (string like "2026-Q1") optional
  - include_on_hold (boolean) optional (true only if user asks to include On Hold)
  - question (string) only if action="clarify" (ask exactly one clarifying question)

Rules:
- If user asks about "pipeline", use action="get_pipeline_kpis".
- If user asks about work orders, billing, receivables, collections, use action="get_work_order_kpis".
- If user asks for "leadership update", use action="get_leadership_update".
- If user asks pipeline "this quarter", omit quarter (backend will default current quarter).
- If the user mentions a sector (e.g. Mining/Powerline), pass sector exactly as they wrote it.
- If sector is required but missing, action="clarify".
`.trim();

  const routeResp = await llm.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      ...opts.history,
      { role: "user", content: opts.message },
      { role: "user", content: routerPrompt }
    ],
    temperature: 0
  });

  const routeText = routeResp.choices[0]?.message?.content ?? "";
  const jsonStr = extractJsonOnly(routeText);
  if (!jsonStr) {
    return "I couldn't parse the request reliably. Which sector and timeframe should I use?";
  }

  let route: z.infer<typeof RouteSchema>;
  try {
    route = RouteSchema.parse(JSON.parse(jsonStr));
  } catch {
    return "I couldn't interpret that reliably. Which sector and timeframe should I use?";
  }

  if (route.action === "clarify") {
    return route.args.question ?? "Which sector and timeframe should I use?";
  }

  // ---------- 2) EXECUTE TOOL (server-side) ----------
  let toolResult: any;

  // Cache data per request
  let dealsCache: any[] | null = null;
  let workCache: any[] | null = null;

  if (route.action === "get_pipeline_kpis") {
    dealsCache ??= await loadDeals(monday, opts.dealsBoardId);
    toolResult = pipelineKpis(
      dealsCache,
      route.args.sector ?? null,
      route.args.quarter ?? null,
      route.args.include_on_hold ?? null
    );
  } else if (route.action === "get_work_order_kpis") {
    workCache ??= await loadWorkOrders(monday, opts.workBoardId);
    toolResult = workOrderKpis(workCache, route.args.sector ?? null);
  } else if (route.action === "get_deals_data_quality") {
    dealsCache ??= await loadDeals(monday, opts.dealsBoardId);
    toolResult = dealsDataQuality(dealsCache);
  } else if (route.action === "get_leadership_update") {
    dealsCache ??= await loadDeals(monday, opts.dealsBoardId);
    workCache ??= await loadWorkOrders(monday, opts.workBoardId);
    toolResult = leadershipUpdate(dealsCache, workCache, route.args.sector ?? null);
  } else {
    // Should never happen due to schema
    return "Unsupported action.";
  }

  // ---------- 3) BUILD DIRECT ANSWER (deterministic for pipeline) ----------
  const directAnswer =
    route.action === "get_pipeline_kpis" ? buildPipelineDirectAnswer(toolResult) : "";

  // ---------- 4) NARRATE ----------
const narratePrompt =
    route.action === "get_pipeline_kpis"
      ? `
You are writing a founder-ready business update in Markdown.

ABSOLUTE RULES:
- Use ONLY the JSON below. Do NOT introduce any concepts not present in the JSON.
- Do NOT invent or infer numbers. Do NOT do arithmetic.
- Do NOT reformat currency or percentages.
  - INR amounts must use ONLY: formatted.*_inr, stage_breakdown_sorted[].amount_inr, top_deals[].amount_inr,
    concentration.*_value_inr, outcomes_in_scope.*_value_inr, bucket_breakdown.*.value_inr.
  - Percentages must use ONLY: formatted.weighted_to_active_pct, formatted.weighted_gap_pct,
    stage_breakdown_sorted[].share_pct_str, concentration.top1_pct_str, concentration.top3_pct_str.
- Do NOT rename or abbreviate stages; use stage_breakdown_sorted[].stage exactly.
- Do NOT add/remove/rename deals; Top deals must come ONLY from top_deals[].
- Do NOT use tables anywhere.
- Do NOT use speculative language like "at risk", "likely", "may", "expected". Only describe what the JSON states.

IMPORTANT:
- The "## Direct answer" section is PROVIDED and MUST be copied verbatim (no edits).
- You must write the remaining sections only, grounded in JSON.

OUTPUT FORMAT (exact headings, in this exact order):
## Direct answer
(copy verbatim)

## Key insights
- 3 to 5 bullets

## Top deals
- Up to 5 bullets: Deal Name (Client Code) — Stage — Amount — Close Date

## Data quality / caveats
- 2 to 6 bullets

Key insights requirements:
- Include one bullet about stage mix using the top 3 items from stage_breakdown_sorted with share_pct_str.
- Include one bullet about concentration using concentration.top3_pct_str and concentration.top3_value_inr.
- If outcomes_in_scope.lost_count > 0, include one bullet EXACTLY like:
  "Closed-lost in this quarter scope: {outcomes_in_scope.lost_value_inr} across {outcomes_in_scope.lost_count} deals."
- If mentioning top1, use concentration.top1_pct_str and concentration.top1_value_inr (do not compute).

- If you mention top 3 or top 1 concentration, you MUST use the concentration.*_value_inr and concentration.*_pct_str fields exactly (no other rupee/percent fields).

Data quality / caveats requirements:
- If data_quality.active_missing_probability_count > 0, include EXACTLY:
  "Weighted forecast is conservative because probability is missing for X active deals; missing probabilities are treated as 0."
- If data_quality.missing_close_date_count > 0, include:
  "Some deals are excluded from quarter views due to missing close dates (X deals)."
- Always include:
  - assumptions.pipeline_definition
  - assumptions.weighted_forecast_rule

DIRECT ANSWER (copy exactly):
${directAnswer}

JSON:
${JSON.stringify(toolResult)}
`.trim()
      : `
Write a founder-ready business update in Markdown using ONLY the JSON below.
Do not invent numbers.

OUTPUT FORMAT (exact headings):
## Direct answer
(1 short paragraph)

## Key insights
- 2 to 5 bullets

## Data quality / caveats
- 1 to 5 bullets

JSON:
${JSON.stringify(toolResult)}
`.trim();

  // First attempt
  const initial = await llm.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: narratePrompt }
    ],
    temperature: 0.1
  });

  let finalText = initial.choices[0]?.message?.content ?? "";

  // ---------- 5) VALIDATE + REPAIR (1 retry) ----------
  const ok =
    route.action === "get_pipeline_kpis"
      ? hasPipelineFormat(finalText)
      : hasGenericFormat(finalText);

  if (!ok) {
    const repairPrompt = `
Your previous answer did not follow the required format/rules.
Rewrite it to comply EXACTLY with the rules and headings. Do not add new numbers.
JSON:
${JSON.stringify(toolResult)}
`.trim();

    const repaired = await llm.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: narratePrompt },
        { role: "user", content: repairPrompt }
      ],
      temperature: 0.1
    });

    finalText = repaired.choices[0]?.message?.content ?? finalText;
  }

  return finalText;
}
import "dotenv/config";
import express from "express";
import cors from "cors";
import { runAgent } from "./agent.js";
import { MondayClient } from "./monday.js";
import { loadDeals, pipelineKpis } from "./analytics.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body as {
      message: string;
      history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    };

    const answer = await runAgent({
    message,
    history: history ?? [],
    mondayToken: process.env.MONDAY_TOKEN!,
    dealsBoardId: Number(process.env.MONDAY_DEALS_BOARD_ID),
    workBoardId: Number(process.env.MONDAY_WORK_ORDERS_BOARD_ID)
});

    res.json({ answer });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Unknown error" });
  }
});

app.get("/debug/pipeline", async (req, res) => {
  const sector = typeof req.query.sector === "string" ? req.query.sector : null;
  const quarter = typeof req.query.quarter === "string" ? req.query.quarter : null;

  const monday = new MondayClient(process.env.MONDAY_TOKEN!);
  const deals = await loadDeals(monday, Number(process.env.MONDAY_DEALS_BOARD_ID));

  const kpis = pipelineKpis(deals, sector, quarter, false);
  res.json({ sector, quarter, kpis, sample: deals.slice(0, 3) });
});

app.get("/debug/deals-columns", async (_req, res) => {
  const monday = new MondayClient(process.env.MONDAY_TOKEN!);
  const boardId = Number(process.env.MONDAY_DEALS_BOARD_ID);
  const cols = await monday.getBoardColumns(boardId);
  res.json(cols);
});

app.get("/debug/work-columns", async (_req, res) => {
  const monday = new MondayClient(process.env.MONDAY_TOKEN!);
  const boardId = Number(process.env.MONDAY_WORK_ORDERS_BOARD_ID);
  const cols = await monday.getBoardColumns(boardId);
  res.json(cols);
});

app.get("/", (_req, res) => {
  res.type("html").send(`
    <h2>Skylark Monday BI Agent (Backend)</h2>
    <p>Use <code>POST /chat</code> with JSON: <code>{ "message": "...", "history": [] }</code></p>
    <pre>
curl -X POST ${"https://YOUR_URL"}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"message":"How is our pipeline looking for Mining this quarter?","history":[]}'
    </pre>
    <p>Health: <a href="/health">/health</a></p>
  `);
});

const port = Number(process.env.PORT ?? 8000);
app.listen(port, () => console.log(`API running on :${port}`));
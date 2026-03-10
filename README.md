```md
# Skylark Drones — Monday.com Business Intelligence Agent

A founder-facing Business Intelligence (BI) agent that answers high-level business questions by reading **live data from monday.com boards** (Deals + Work Orders), cleaning messy real-world fields (missing values, inconsistent dates, timeline columns), computing KPIs, and returning an executive-style narrative with caveats.

This project is designed to be:
- **Read-only** against monday.com (GraphQL API)
- **Resilient** to messy data (nulls, timeline dates, inconsistent statuses/stages)
- **Founder-friendly** (direct answers + insights + data-quality caveats)

---

## Features

### Monday.com Integration (Read-only)
- Reads from two boards in monday.com:
  - **Deals** (pipeline)
  - **Work Orders** (delivery + billing/collections)
- Uses monday.com GraphQL API with pagination (`items_page` cursor)

### Data Resilience
- Normalizes messy text values (`N/A`, blanks → null)
- Parses:
  - Money fields from strings / formatted numbers
  - Dates from monday **Date** columns and **Timeline** columns (`{date}` and `{from,to}`)
- Deals classification:
  - Uses **Deal Status** (`Open`, `Won`, `Dead`, `On Hold`) as primary outcome
  - Uses **Deal Stage** to override status when stage clearly indicates an outcome (e.g. `Invoice sent`, `Project Won`, `Project Lost`, `Not relevant`)

### BI / KPIs
- Pipeline KPIs by sector + quarter:
  - Active pipeline value, On-hold value (excluded by default)
  - Weighted forecast based on closure probability
  - Stage mix, top deals, concentration metrics (top 1 / top 3 share)
  - Closed-lost context in the quarter scope
  - Data-quality notes (missing close dates, missing probabilities)
- Work order KPIs by sector:
  - Execution status counts
  - Totals: billed/collected/receivable (where available)

### Conversational Agent
- Converts founder questions into KPI tool calls and writes a narrative:
  - **Direct answer** is deterministic for pipeline (server-generated)
  - LLM generates insights and caveats using computed JSON only
- Routing is robust:
  - LLM JSON router + deterministic fallback if parsing fails

---

## Data / monday.com Setup

### 1) Create Boards
Create two boards in monday.com:
1. **Deals**
2. **Work Orders**

### 2) Import CSVs
Import provided CSVs:
- `Deal_funnel_Data.csv` → Deals board
- `Work_Order_Tracker_Data.csv` → Work Orders board

### 3) Column Types (Recommended)
The importer may set date columns to **Timeline**. This system supports both Date and Timeline, so it will still work. However, for human clarity you may prefer Date columns for single dates.

**Deals (expected titles):**
- `Deal Name`
- `Owner code`
- `Client Code`
- `Deal Status`
- `Close Date (A)` *(Timeline supported)*
- `Tentative Close Date` *(Timeline supported)*
- `Closure Probability` (High/Medium/Low etc.)
- `Masked Deal value`
- `Deal Stage`
- `Sector/service`
- `Created Date` *(Timeline supported)*

**Work Orders (expected titles):**
- `Deal name masked`
- `Customer Name Code`
- `Execution Status`
- `Probable Start Date` *(Timeline supported)*
- `Probable End Date` *(Timeline supported)*
- `Data Delivery Date`
- Billing/collection/receivable amount columns

> Note: If your monday column titles differ, update the mappings in `backend/src/analytics.ts` (`DEALS_COLS`, `WORK_COLS`).

### 4) Get Board IDs
Board ID is in the URL:
`https://...monday.com/boards/<BOARD_ID>/`

Set:
- `MONDAY_DEALS_BOARD_ID`
- `MONDAY_WORK_ORDERS_BOARD_ID`

### 5) Generate monday API Token
Profile → Developer → API token

---

## Running Locally

### 1) Backend Setup
```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
```env
PORT=8000
MONDAY_TOKEN=...
MONDAY_DEALS_BOARD_ID=...
MONDAY_WORK_ORDERS_BOARD_ID=...

# LLM
LLM_PROVIDER=groq
GROQ_API_KEY=...
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-8b-instant
```

Run:
```bash
npm run dev
```

### 2) Test Health
```bash
curl http://localhost:8000/health
```

### 3) Test Pipeline KPI (bypasses LLM)
```bash
curl "http://localhost:8000/debug/pipeline?sector=Mining&quarter=2026-Q1"
```

### 4) Chat
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How is our pipeline looking for Mining this quarter?","history":[]}'
```

---

## Hosted Demo (Backend)

After deployment (e.g., Render), you will have a base URL like:
`https://<your-service>.onrender.com`

### Health
`GET /health`

### Chat
`POST /chat`

Body:
```json
{
  "message": "How is our pipeline looking for Mining this quarter?",
  "history": []
}
```

Example:
```bash
curl -X POST https://<your-service>.onrender.com/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How is our pipeline looking for Mining this quarter?","history":[]}'
```

---

## Example Founder Questions

### Pipeline
- “How is our pipeline looking for **Mining** this quarter?”
- “Same, **including on hold**.”
- “Top deals closing this quarter in **Powerline**?”
- “Where is most value concentrated in the funnel for Mining this quarter?”

### Ops / Finance (Work Orders)
- “Work order KPIs for Mining”
- “How much receivable do we have for Powerline?”
- “Execution status breakdown for work orders in Mining”

### Leadership updates
- “Give me a leadership update for Mining.”
- “Leadership update for this quarter.”

---

## Design Notes (High-level)

### Why tool/KPI-first (instead of letting the LLM read raw rows)
- Faster and cheaper
- More accurate and auditable
- Avoids hallucinations
- Lets the system return meaningful results even when LLM fails (fallback routing + computed KPIs)

### Data Quality Caveats
The agent reports missingness and classification caveats, e.g.:
- Deals excluded from quarter view due to missing close dates
- Weighted forecast conservative if probability missing
- Deal Stage overrides Deal Status when Stage clearly indicates outcomes (invoice sent, won/lost, etc.)

---

## Project Structure (Backend)
- `src/monday.ts` — monday GraphQL client + pagination
- `src/normalize.ts` — normalization & parsing (money/date/timeline, status bucketing)
- `src/analytics.ts` — board → canonical records + KPI computation
- `src/narration.ts` — deterministic pipeline direct answer builder
- `src/agent.ts` — router + tool execution + LLM narration + validation retry
- `src/index.ts` — Express server

---

## Security
- Never commit `.env` (API tokens/keys)
- Use `.env.example` for placeholders only
- In hosted environments (Render), set secrets as environment variables

---

## Deployment (Render - recommended)
- Root directory: `backend`
- Build: `npm ci && npm run build`
- Start: `npm run start`
- Set env vars:
  - `MONDAY_TOKEN`, board IDs
  - `LLM_PROVIDER`, `GROQ_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`
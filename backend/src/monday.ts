const MONDAY_API_URL = "https://api.monday.com/v2";

export type MondayColumn = { id: string; title: string; type: string };

export type MondayItem = {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  column_values: Array<{
    id: string;
    text?: string;
    value?: string; // JSON string, often includes { date: "YYYY-MM-DD" }
    type?: string;
  }>;
};

export class MondayClient {
  constructor(private token: string) {}

  async graphql<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!res.ok) throw new Error(`Monday API HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(`Monday GraphQL error: ${JSON.stringify(json.errors)}`);
    return json.data as T;
  }

  async getBoardColumns(boardId: number): Promise<MondayColumn[]> {
    const q = `
      query ($board_id: [ID!]) {
        boards(ids: $board_id) {
          columns { id title type }
        }
      }
    `;
    const data = await this.graphql<{ boards: Array<{ columns: MondayColumn[] }> }>(q, {
      board_id: [boardId]
    });
    return data.boards[0].columns;
  }

  async getAllItems(boardId: number, limit = 500): Promise<MondayItem[]> {
    const q = `
      query ($board_id: [ID!], $limit: Int!, $cursor: String) {
        boards(ids: $board_id) {
          items_page(limit: $limit, cursor: $cursor) {
            cursor
            items {
              id
              name
              created_at
              updated_at
              column_values { id text value type }
            }
          }
        }
      }
    `;

    let cursor: string | null = null;
    const items: MondayItem[] = [];

    type ItemsPage = { cursor: string | null; items: MondayItem[] };
    type ItemsPageResponse = { boards: Array<{ items_page: ItemsPage }> };

    while (true) {
        const data: ItemsPageResponse = await this.graphql<ItemsPageResponse>(q, {
            board_id: [boardId],
            limit,
            cursor
        });

        const page: ItemsPage = data.boards[0].items_page;

        items.push(...page.items);
        cursor = page.cursor;
        if (!cursor) break;
    }
    return items;
  }
}
import { createAction } from '@inboxfm-connect/pieces-framework';
import { mondayAuth } from '../auth';
import { makeClient, mondayCommon } from '../common';
import { parseMondayColumnValue } from '../common/helper';

export const getBoardItemValuesAction = createAction({
  auth: mondayAuth,
  name: 'monday_get_board_values',
  displayName: 'Get Board Values',
  description:
    "Gets a list of board's items. Follows monday.com cursor pagination (500 items per page) and returns up to 2000 items.",
  audience: 'both',
  aiMetadata: { description: 'Retrieves items on a monday.com board with their column values, optionally narrowed to specific column ids. Follows monday.com cursor pagination (500 per page) and returns up to 2000 items. Use to read or list the rows of a board. Read-only and idempotent.', idempotent: true },
  props: {
    workspace_id: mondayCommon.workspace_id(true),
    board_id: mondayCommon.board_id(true),
    column_ids: mondayCommon.columnIds(false),
  },
  async run(context) {
    const { board_id, column_ids } = context.propsValue;

    const client = makeClient(context.auth);
    const res = await client.getBoardItemValues({
      boardId: board_id as string,
      columnIds: column_ids as string[],
    });

    // monday.com's items_page returns a single page (500 items here) plus a
    // cursor when more items exist. Walk next_items_page so items beyond the
    // first page are not silently dropped (bounded walk).
    const PER_PAGE = 500;
    const MAX_PAGES = 4; // bounded walk: at most 2000 items per run
    let cursor: string | null | undefined =
      res.data.boards[0].items_page.cursor;
    const items = [...res.data.boards[0].items_page.items];

    for (let page = 2; cursor && page <= MAX_PAGES; page++) {
      const nextRes = await client.getNextBoardItemValues({
        limit: PER_PAGE,
        cursor: cursor as string,
        columnIds: column_ids as string[],
      });

      items.push(...nextRes.data.next_items_page.items);
      cursor = nextRes.data.next_items_page.cursor;

      if (nextRes.data.next_items_page.items.length < PER_PAGE) {
        break; // last page reached
      }
    }

    const result = [];
    for (const item of items) {
      const transformedValues: Record<string, any> = {
        id: item.id,
        name: item.name,
      };
      for (const column of item.column_values) {
        transformedValues[column.id] = parseMondayColumnValue(column);
      }
      result.push(transformedValues);
    }

    return result;
  },
});

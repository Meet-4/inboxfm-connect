import dayjs from 'dayjs';

// Some RSS feeds use the id field, some use the guid field, and some use neither.
export function getId(item: { id: string; guid: string }) {
    if (item === undefined) {
      return undefined;
    }
    if (item.guid) {
      return item.guid;
    }
    if (item.id) {
      return item.id;
    }
    return JSON.stringify(item);
  }

// LAST_ITEM dedupe slices the item list at the stored cursor and expects the
// full list ordered newest-to-oldest. Individual feeds vary (some list items
// oldest-first) and merged multi-feed lists are simply concatenated, so items
// must be sorted globally by publish date before the polling helper sees them.
export function sortRssItemsByNewestFirst(items: any[]): any[] {
  return [...items].sort((a, b) => {
    const aDate = (a.pubdate ?? a.pubDate) as string | undefined;
    const bDate = (b.pubdate ?? b.pubDate) as string | undefined;
    if (aDate && bDate) {
      const aUnix = dayjs(aDate).unix();
      const bUnix = dayjs(bDate).unix();
      if (aUnix !== bUnix) {
        return bUnix - aUnix;
      }
    }
    return 0;
  });
}
  
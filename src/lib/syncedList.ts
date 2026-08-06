type SyncedListItem = {
  id?: string;
  name?: string;
  playerName?: string;
};

const getSyncedListKey = (item: SyncedListItem): string =>
  item.id || item.name?.trim().toLowerCase() || item.playerName?.trim().toLowerCase() || '';

export function mergeSyncedList<T extends SyncedListItem>(latest: T[], synced: T[]): T[] {
  const syncedEntries = synced
    .map((item): [string, T] => [getSyncedListKey(item), item])
    .filter(([key]) => key);
  const syncedByKey = new Map<string, T>(syncedEntries);
  const latestKeys = new Set<string>();
  const merged = latest.map((item): T => {
    const key = getSyncedListKey(item);
    if (key) latestKeys.add(key);
    const syncedItem = key ? syncedByKey.get(key) : undefined;
    return syncedItem ?? item;
  });

  return [
    ...merged,
    ...synced.filter((item) => {
      const key = getSyncedListKey(item);
      return key && !latestKeys.has(key);
    })
  ];
}

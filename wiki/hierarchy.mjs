// Repair only navigation, never persisted parent relationships.
export function navigationParents(folders) {
  const parents = new Map(folders.map((f) => [f.id, f.parent_id ?? null]));
  for (const [id, parent] of parents)
    if (parent !== null && !parents.has(parent)) parents.set(id, null);
  for (const id of parents.keys()) {
    const seen = new Set();
    let cursor = id;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        parents.set(cursor, null);
        break;
      }
      seen.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
  }
  return parents;
}

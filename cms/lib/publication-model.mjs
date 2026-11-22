export function publishableSnapshot(snapshot, live) {
  const publicSnapshot = structuredClone(snapshot);
  const previousDraftIds = new Set(live.registry.quarters.filter(entry => entry.status === "draft").map(entry => entry.id));
  publicSnapshot.registry.quarters = publicSnapshot.registry.quarters.filter(entry => {
    if (entry.status !== "draft") return true;
    if (previousDraftIds.has(entry.id)) {
      publicSnapshot.quarters[entry.id] = live.quarters[entry.id];
      return true;
    }
    delete publicSnapshot.quarters[entry.id];
    return false;
  });
  const visibleYears = new Set(publicSnapshot.registry.quarters.filter(entry => entry.status !== "draft").map(entry => publicSnapshot.quarters[entry.id].year));
  if (Array.isArray(publicSnapshot.years)) {
    publicSnapshot.years = publicSnapshot.years.filter(year => live.years.includes(year) || visibleYears.has(year));
  }
  return publicSnapshot;
}

export function editorialResourcePath(url) {
  if (typeof url !== "string" || !/^\/recursos\/\d{4}-q[1-4]\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/i.test(url)) {
    throw new Error("El archivo no tiene una ruta editorial válida.");
  }
  return "public" + url;
}

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function keyed(value) {
  if (!Array.isArray(value)) return false;
  const ids = value.map(item => item?.id);
  return ids.every(id => typeof id === "string" && id.length) && new Set(ids).size === ids.length;
}

function mergeValue(base, editor, latest, path, conflicts) {
  if (equal(base, editor)) return latest;
  if (equal(editor, latest) || equal(base, latest)) return editor;
  if (isRecord(base) && isRecord(editor) && isRecord(latest)) {
    const keys = new Set([...Object.keys(latest), ...Object.keys(editor), ...Object.keys(base)]);
    return Object.fromEntries([...keys].flatMap(key => {
      const next = mergeValue(
        Object.hasOwn(base, key) ? base[key] : undefined,
        Object.hasOwn(editor, key) ? editor[key] : undefined,
        Object.hasOwn(latest, key) ? latest[key] : undefined,
        path + "/" + key, conflicts,
      );
      return next === undefined ? [] : [[key, next]];
    }));
  }
  if ([base, editor, latest].every(keyed)) {
    const [before, edited, live] = [base, editor, latest].map(list => new Map(list.map(item => [item.id, item])));
    const oldKeys = [...before.keys()].filter(id => edited.has(id) && live.has(id));
    const sharedOrder = items => [...items.keys()].filter(id => before.has(id) && edited.has(id) && live.has(id));
    const editorOrder = sharedOrder(edited);
    const liveOrder = sharedOrder(live);
    const editorMoved = !equal(editorOrder, oldKeys);
    if (editorMoved && !equal(liveOrder, oldKeys) && !equal(editorOrder, liveOrder)) conflicts.push(path);
    const order = editorMoved ? [edited, live] : [live, edited];
    const ids = new Set(order.flatMap(items => [...items.keys()]));
    return [...ids].flatMap(id => {
      const next = mergeValue(before.get(id), edited.get(id), live.get(id), path + "/" + id, conflicts);
      return next === undefined ? [] : [next];
    });
  }
  conflicts.push(path);
  return latest;
}

export function mergeEditorialSnapshot(base, edited, latest) {
  const conflicts = [];
  const result = mergeValue(base, edited, latest, "", conflicts);
  if (conflicts.length) {
    const error = new Error("El sitio también cambió en estas secciones. Tus cambios siguen guardados.");
    error.details = conflicts.slice(0, 8).map(path => path.replace(/^\//, "").replaceAll("/", " · "));
    throw error;
  }
  return result;
}

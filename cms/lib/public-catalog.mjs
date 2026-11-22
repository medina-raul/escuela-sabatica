export function publicCatalog(snapshot) {
  const visible = structuredClone(snapshot);
  visible.registry.quarters = visible.registry.quarters.filter(entry => {
    if (entry.status !== "draft") return true;
    delete visible.quarters[entry.id];
    return false;
  });
  visible.years = [...new Set(Object.values(visible.quarters).map(quarter => quarter.year))].sort((a, b) => a - b);
  if (visible.registry.years) visible.registry.years = visible.years;
  return visible;
}

const runtimeSlots = new Map();

function getOrCreateRuntimeSlot(key, factory) {
  const safeKey = String(key || '').trim();
  if (!safeKey || typeof factory !== 'function') return null;
  if (runtimeSlots.has(safeKey)) return runtimeSlots.get(safeKey);
  const value = factory();
  runtimeSlots.set(safeKey, value);
  return value;
}

function clearRuntimeSlot(key) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return false;
  return runtimeSlots.delete(safeKey);
}

module.exports = {
  getOrCreateRuntimeSlot,
  clearRuntimeSlot,
};

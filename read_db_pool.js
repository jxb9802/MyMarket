const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MAX_READ_DBS = Math.max(1, Number(process.env.BSV_MARKET_READ_DB_POOL_MAX || 3));
const slots = [];

function getDbFilePath() {
  const dataDir = path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
  const dbDir = path.resolve(process.env.BSV_MARKET_DB_DIR || dataDir);
  return path.join(dbDir, 'market.db');
}

function createSlot() {
  const db = new DatabaseSync(getDbFilePath(), {
    readOnly: true,
  });
  const slot = {
    db,
    inUse: false,
    lastUsedAt: Date.now(),
  };
  slots.push(slot);
  return slot;
}

function chooseSlot() {
  const freeSlot = slots.find((slot) => !slot.inUse);
  if (freeSlot) return freeSlot;
  if (slots.length < MAX_READ_DBS) return createSlot();
  return null;
}

function wrapLease(slot) {
  let released = false;
  slot.inUse = true;
  slot.lastUsedAt = Date.now();
  return new Proxy(slot.db, {
    get(target, prop, receiver) {
      if (prop === 'close') {
        return () => {
          if (released) return;
          released = true;
          slot.inUse = false;
          slot.lastUsedAt = Date.now();
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') return value.bind(target);
      return value;
    },
  });
}

function openReadDb() {
  const slot = chooseSlot();
  if (!slot) {
    throw new Error(`read_db_pool exhausted: max ${MAX_READ_DBS} leased connections`);
  }
  return wrapLease(slot);
}

function withReadDb(fn) {
  const db = openReadDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function getPoolStats() {
  return {
    max: MAX_READ_DBS,
    size: slots.length,
    inUse: slots.filter((slot) => slot.inUse).length,
  };
}

module.exports = {
  openReadDb,
  withReadDb,
  getPoolStats,
};

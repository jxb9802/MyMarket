function normalizeHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function chooseTrustedP2PHeight(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const minVotes = Math.max(1, Number(options.minVotes || 1));
  const buckets = new Map();

  sourceRows.forEach((row) => {
    if (!row || row.ok !== true) return;
    const height = normalizeHeight(row.startHeight);
    if (height <= 0) return;
    const key = String(height);
    if (!buckets.has(key)) {
      buckets.set(key, {
        height,
        votes: 0,
        nodes: [],
      });
    }
    const bucket = buckets.get(key);
    bucket.votes += 1;
    bucket.nodes.push(String(row.node || ''));
  });

  const ranked = Array.from(buckets.values()).sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.height - a.height;
  });
  const quorumBuckets = ranked.filter((x) => Number(x.votes || 0) >= minVotes);
  const winner = quorumBuckets
    .slice()
    .sort((a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      return b.votes - a.votes;
    })[0] || null;

  if (!winner || winner.votes < minVotes) {
    return {
      ok: false,
      trustedHeight: 0,
      trustedNodes: [],
      votes: 0,
      ranked,
    };
  }

  return {
    ok: true,
    trustedHeight: winner.height,
    trustedNodes: winner.nodes.slice(),
    votes: winner.votes,
    ranked,
  };
}

module.exports = {
  chooseTrustedP2PHeight,
  normalizeHeight,
};

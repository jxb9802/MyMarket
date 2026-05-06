const crypto = require('crypto');

function canonicalize(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return 'null';
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function stripSignatureFields(payload = {}) {
  const copy = payload && typeof payload === 'object' ? { ...payload } : {};
  delete copy.es;
  // _sourceV is local schema-migration metadata added during persistence/replay.
  // It is not part of the signed chain protocol payload.
  delete copy._sourceV;
  return copy;
}

function eventHash(payload = {}) {
  return sha256Hex(canonicalize(stripSignatureFields(payload)));
}

function scriptHashHex(scriptHex = '') {
  const safeHex = String(scriptHex || '').trim().toLowerCase();
  if (!safeHex) return '';
  return sha256Hex(Buffer.from(safeHex, 'hex'));
}

function templateId(kind, placeTxid, extra = '') {
  const pt = String(placeTxid || '').trim();
  const suffix = String(extra || '').trim();
  switch (kind) {
    case 'completed':
      return `bsvmkt:v3:settle:completed:${pt}`;
    case 'refunded':
      return `bsvmkt:v3:settle:refunded:${pt}`;
    case 'cancel':
      return `bsvmkt:v3:settle:cancel:${pt}`;
    case 'dispute':
      return `bsvmkt:v3:settle:dispute:${suffix || 'resolved'}:${pt}`;
    case 'preaccept_seller_cancel':
      return `bsvmkt:v3:cancel:preaccept:seller:${pt}`;
    default:
      throw new Error(`Unsupported template kind: ${kind}`);
  }
}

function signPayload(payload, privateKey, bsv = null) {
  if (!privateKey) {
    throw new Error('A bsv private key is required to sign protocol payload');
  }
  if (typeof privateKey.sign === 'function') {
    const hashBuf = Buffer.from(eventHash(payload), 'hex');
    return privateKey.sign(hashBuf).toString();
  }
  if (!bsv?.crypto?.ECDSA?.sign) throw new Error('A bsv instance is required to sign protocol payload');
  const hashBuf = Buffer.from(eventHash(payload), 'hex');
  return bsv.crypto.ECDSA.sign(hashBuf, privateKey).toString();
}

function verifyPayload(payload, bsv) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const pubKeyHex = String(safe.ap || '').trim();
  const sigHex = String(safe.es || '').trim();
  if (!/^[0-9a-f]{66}$/i.test(pubKeyHex) || !sigHex) return false;
  try {
    const hashBuf = Buffer.from(eventHash(safe), 'hex');
    const sig = bsv.crypto.Signature.fromString(sigHex);
    const pub = new bsv.PublicKey(pubKeyHex);
    return bsv.crypto.ECDSA.verify(hashBuf, sig, pub) === true;
  } catch (_) {
    return false;
  }
}

function requireInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0) {
    throw new Error(`Invalid ${name}`);
  }
  return n;
}

function validatePlacePayload(payload = {}, {
  expectedBuyerScriptHash = '',
  expectedJointScriptHash = '',
  minSellerDepositSats = 1000,
  sellerDepositRateBps = 500,
} = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (Number(p.v || 0) !== 3) throw new Error('Unsupported order protocol version');
  const ps = requireInt(p.ps, 'price sats');
  const bd = requireInt(p.bd, 'buyer deposit sats');
  const sd = requireInt(p.sd, 'seller deposit sats');
  const bs = requireInt(p.bs, 'buyer lock sats');
  if (bs !== ps + bd) throw new Error('Invalid buyer lock amount');
  if (bd !== Math.floor(ps * 0.2)) throw new Error('Invalid buyer deposit amount');
  if (sd !== Math.max(Number(minSellerDepositSats || 1000), Math.floor((ps * Math.max(0, Number(sellerDepositRateBps || 0))) / 10000))) {
    throw new Error('Invalid seller deposit amount');
  }
  if (expectedBuyerScriptHash && String(p.bh || '').trim() !== String(expectedBuyerScriptHash || '').trim()) {
    throw new Error('Buyer lock script hash mismatch');
  }
  if (expectedJointScriptHash && String(p.jh || '').trim() !== String(expectedJointScriptHash || '').trim()) {
    throw new Error('Joint script hash mismatch');
  }
  return true;
}

function attachActorSignature(payload, { role, pubKey, privateKey, bsv = null }) {
  const next = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    ap: String(pubKey || '').trim(),
    ar: String(role || '').trim(),
  };
  next.es = signPayload(next, privateKey, bsv);
  return next;
}

module.exports = {
  canonicalize,
  sha256Hex,
  scriptHashHex,
  eventHash,
  templateId,
  signPayload,
  verifyPayload,
  validatePlacePayload,
  attachActorSignature,
};

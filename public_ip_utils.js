'use strict';

function normalizeString(value) {
  return String(value || '').trim();
}

function parseIpv4(value) {
  const raw = normalizeString(value);
  const match = raw.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!match) return null;
  const parts = raw.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((sum, part) => ((sum << 8) >>> 0) + part, 0) >>> 0;
}

function ipv4InCidr(ipInt, cidr) {
  const [baseRaw, bitsRaw] = String(cidr || '').split('/');
  const base = parseIpv4(baseRaw);
  const bits = Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

const NON_GLOBAL_IPV4_CIDRS = Object.freeze([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
]);

function isGlobalPublicIpv4(value) {
  const ipInt = parseIpv4(value);
  if (ipInt === null) return false;
  return !NON_GLOBAL_IPV4_CIDRS.some((cidr) => ipv4InCidr(ipInt, cidr));
}

function collectLocalIpv4Candidates(osModule) {
  const os = osModule || require('os');
  const out = [];
  try {
    const interfaces = os.networkInterfaces() || {};
    for (const [name, rows] of Object.entries(interfaces)) {
      for (const row of Array.isArray(rows) ? rows : []) {
        const family = String(row?.family || '').toLowerCase();
        const address = normalizeString(row?.address);
        if (family !== 'ipv4' || !address || row?.internal === true) continue;
        out.push({
          interfaceName: name,
          address,
          global: isGlobalPublicIpv4(address),
        });
      }
    }
  } catch (_) {}
  return out;
}

async function fetchObservedIpv4(url, timeoutMs = 2500) {
  const safeUrl = normalizeString(url);
  if (!safeUrl || typeof fetch !== 'function') return '';
  try {
    const res = await fetch(safeUrl, {
      signal: AbortSignal.timeout(Math.max(500, Number(timeoutMs || 2500))),
      headers: { accept: 'text/plain, application/json;q=0.8' },
    });
    if (!res.ok) return '';
    const text = await res.text();
    const match = String(text || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    const ip = match ? match[0] : '';
    return isGlobalPublicIpv4(ip) ? ip : '';
  } catch (_) {
    return '';
  }
}

async function detectObservedPublicIpv4(options = {}) {
  const services = Array.isArray(options.services) && options.services.length
    ? options.services
    : [
        'https://api.ipify.org',
        'https://ifconfig.me/ip',
        'https://icanhazip.com',
      ];
  for (const service of services) {
    const ip = await fetchObservedIpv4(service, options.timeoutMs);
    if (ip) return ip;
  }
  return '';
}

module.exports = {
  NON_GLOBAL_IPV4_CIDRS,
  parseIpv4,
  isGlobalPublicIpv4,
  collectLocalIpv4Candidates,
  detectObservedPublicIpv4,
};

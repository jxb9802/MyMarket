const { DEFAULT_PUBLIC_STUN_SERVERS } = require('./chat_stun_service');

function normalizeString(value) {
  return String(value || '').trim();
}

function createChatStunRegistry() {
  let stunAnnouncements = [];

  function setAnnouncements(rows = []) {
    stunAnnouncements = Array.isArray(rows)
      ? rows.map((row) => ({ ...row }))
      : [];
    return listAnnouncements();
  }

  function listAnnouncements() {
    return stunAnnouncements.map((row) => ({ ...row }));
  }

  function buildIceServers() {
    const chainServers = stunAnnouncements
      .map((row) => normalizeString(row.url || row.urls || row.endpoint))
      .filter(Boolean)
      .map((url) => ({ urls: url }));
    if (chainServers.length > 0) return chainServers;
    return DEFAULT_PUBLIC_STUN_SERVERS.map((url) => ({ urls: url }));
  }

  return {
    setAnnouncements,
    listAnnouncements,
    buildIceServers,
  };
}

module.exports = {
  createChatStunRegistry,
};

function buildManagedServices() {
  return [
    { name: 'trade_service', port: Number(process.env.TRADE_PORT || 8092), enabled: true },
    { name: 'chat_service', port: Number(process.env.CHAT_PORT || 8093), enabled: true },
    { name: 'wallet_service', port: Number(process.env.WALLET_PORT || 8094), enabled: true },
  ];
}

function createRuntimeSupervisor() {
  return {
    startedAt: new Date().toISOString(),
    services: buildManagedServices(),
  };
}

module.exports = {
  createRuntimeSupervisor,
};

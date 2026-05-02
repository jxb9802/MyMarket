'use strict';

const path = require('path');
const fs = require('fs');
const { buildDeleteObject } = require('./drive_manifest_protocol');
const messageQueue = require('./lib/message_queue');

function registerDriveRoutes(app, deps = {}) {
  const {
    walletAuthRequired,
    fail,
    wallet,
    getSessionPassword,
    driveRuntime,
    driveStore,
    driveFsService,
    driveUploadService,
    driveDownloadService,
    driveSyncService,
    driveTrashRuntime,
    driveChainService,
    buildAnchorWireText,
    withSchemaMeta,
    appendMarketDebug,
  } = deps;

  const ANCHOR_DATA_OUTPUT_SAT = Math.max(1000, Number(process.env.BSV_MARKET_ANCHOR_DATA_OUTPUT_SAT || 1000));

  function currentWalletId() {
    return String(wallet.getReceiveAddress() || '').trim();
  }

  function ensureWalletId(res) {
    const walletId = currentWalletId();
    if (!walletId) {
      fail(res, 'wallet is unavailable', 400);
      return '';
    }
    return walletId;
  }

  function emit(topic, payload) {
    return messageQueue.publish(topic, payload, { mode: messageQueue.MODE_TRANSIENT, source: 'drive' });
  }

  function isNoSpendableUtxoError(error) {
    return /No local SPV UTXOs found|missing \d+ spendable input/i.test(String(error?.message || error || ''));
  }

  async function retryAfterLocalWalletIndexRebuild(actionName, fn) {
    try {
      return await fn();
    } catch (error) {
      if (!isNoSpendableUtxoError(error)) {
        throw error;
      }
      appendMarketDebug?.('drive_wallet_index_rebuild_skipped', {
        action: String(actionName || ''),
        reason: 'local_tx_context_rebuild_can_overstate_spendable_balance',
        message: String(error?.message || error || 'No local SPV UTXOs found'),
      });
      throw error;
    }
  }

  function estimateAnchorFeeSat(payloadBytes) {
    const feeRate = Math.max(0.25, Number(wallet.DEFAULT_FEE_RATE || 1));
    const sizeBytes = 220 + Math.max(0, Number(payloadBytes || 0));
    return Math.max(1, Math.ceil(sizeBytes * feeRate));
  }

  function walletSpendableSnapshot() {
    const balance = typeof wallet.getCachedBalanceAndHistory === 'function'
      ? wallet.getCachedBalanceAndHistory()
      : {};
    const confirmedSat = Math.max(0, Number(balance?.confirmed || 0));
    const selfChangePendingSat = Math.max(0, Number(balance?.selfChangePending || 0));
    const availableSat = Math.max(confirmedSat + selfChangePendingSat, Number(balance?.available || 0));
    return {
      confirmedSat,
      selfChangePendingSat,
      availableSat,
      totalSat: Math.max(0, Number(balance?.total || confirmedSat + selfChangePendingSat || 0)),
    };
  }

  function buildDeletePreview(ownerWalletId, targetType, targetId) {
    const marker = buildDeleteObject({ ownerWalletId, targetType, targetId });
    const payload = {
      walletId: String(marker.ownerWalletId || '').trim(),
      ownerWalletId: String(marker.ownerWalletId || '').trim(),
      delete: marker,
    };
    const payloadForChain = typeof withSchemaMeta === 'function'
      ? withSchemaMeta('drive_delete_put', payload, marker.updatedAt)
      : payload;
    const compact = typeof buildAnchorWireText === 'function'
      ? buildAnchorWireText('drive_delete_put', payloadForChain)
      : `BSV_MARKET|drive_delete_put|${JSON.stringify(payloadForChain)}`;
    const payloadBytes = Buffer.byteLength(compact, 'utf8');
    const estimatedFeeSat = estimateAnchorFeeSat(payloadBytes);
    const estimatedCostSat = estimatedFeeSat + ANCHOR_DATA_OUTPUT_SAT;
    const balance = walletSpendableSnapshot();
    const shortfallSat = Math.max(0, estimatedCostSat - Math.max(0, Number(balance.availableSat || 0)));
    return {
      marker,
      targetType,
      targetId,
      payloadBytes,
      estimatedFeeSat,
      estimatedDataOutputSat: ANCHOR_DATA_OUTPUT_SAT,
      estimatedCostSat,
      estimatedFeeBsv: estimatedFeeSat / 100000000,
      estimatedCostBsv: estimatedCostSat / 100000000,
      walletConfirmedSat: balance.confirmedSat,
      walletSelfChangePendingSat: balance.selfChangePendingSat,
      walletSpendableSat: balance.availableSat,
      walletTotalSat: balance.totalSat,
      canAfford: shortfallSat <= 0,
      insufficientBalance: shortfallSat > 0,
      shortfallSat,
      balancePolicy: 'confirmed_plus_local_self_change',
    };
  }

  function currentRootLocalDir(ownerWalletId) {
    const settings = driveStore.loadOwnerSettings(ownerWalletId);
    return String(settings?.rootLocalDir || '').trim();
  }

  function fileDownloaded(ownerWalletId, fileEntry, rootLocalDir) {
    const safeRoot = String(rootLocalDir || '').trim();
    if (!safeRoot || !fileEntry?.fileId) return false;
    const relativePath = driveRuntime.buildFileRelativePath(ownerWalletId, fileEntry.fileId);
    if (!relativePath) return false;
    const outputPath = path.resolve(safeRoot, `.${relativePath}`);
    return fs.existsSync(outputPath);
  }

  function dirDownloaded(ownerWalletId, dirEntry, rootLocalDir) {
    const safeRoot = String(rootLocalDir || '').trim();
    if (!safeRoot || !dirEntry?.dirId) return false;
    const relativePath = driveRuntime.pathForDir(ownerWalletId, dirEntry.dirId);
    const outputPath = path.resolve(safeRoot, `.${relativePath}`);
    return fs.existsSync(outputPath);
  }

  function buildTreeNodes(ownerWalletId) {
    const owner = driveRuntime.loadOwner(ownerWalletId);
    const rootDirId = owner.rootDirId;
    const nodes = driveRuntime.loadedTree(ownerWalletId).map((entry) => ({
      dirId: entry.dirId,
      parentDirId: entry.parentDirId || '',
      name: entry.dirId === rootDirId ? '/' : String(entry.name || '').trim(),
      path: driveRuntime.pathForDir(ownerWalletId, entry.dirId),
    }));
    if (!nodes.some((entry) => entry.dirId === rootDirId)) {
      nodes.unshift({
        dirId: rootDirId,
        parentDirId: '',
        name: '/',
        path: '/',
      });
    }
    return nodes;
  }

  function ensureOwnerLoaded(ownerWalletId, password = '') {
    driveSyncService.ensureOwnerIndex(ownerWalletId, { password });
    driveRuntime.refreshOwnerSettings(ownerWalletId);
  }

  function readOwnerLoaded(ownerWalletId) {
    driveRuntime.loadOwner(ownerWalletId);
    driveRuntime.refreshOwnerSettings(ownerWalletId);
  }

  app.get('/api/drive/root-dir', walletAuthRequired, async (_req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      readOwnerLoaded(ownerWalletId);
      return res.json({
        success: true,
        rootLocalDir: currentRootLocalDir(ownerWalletId),
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'root dir load failed'));
    }
  });

  app.post('/api/drive/root-dir', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const rawRootLocalDir = String(req.body?.rootLocalDir || '').trim();
      if (!rawRootLocalDir) return fail(res, 'rootLocalDir is required');
      const rootLocalDir = path.resolve(rawRootLocalDir);
      fs.mkdirSync(rootLocalDir, { recursive: true });
      const saved = driveStore.saveOwnerSettings(ownerWalletId, { rootLocalDir });
      driveRuntime.refreshOwnerSettings(ownerWalletId);
      return res.json({
        success: true,
        rootLocalDir: String(saved?.rootLocalDir || ''),
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'root dir save failed'));
    }
  });

  app.get('/api/drive/server-dirs', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      readOwnerLoaded(ownerWalletId);
      const listing = listServerDirs(req.query?.path || currentRootLocalDir(ownerWalletId) || '');
      return res.json({
        success: true,
        ...listing,
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'server dir list failed'));
    }
  });

  app.post('/api/drive/mkdir', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const password = getSessionPassword(req);
      const dirPath = String(req.body?.path || '').trim();
      if (!dirPath) return fail(res, 'path is required');
      const dirId = await retryAfterLocalWalletIndexRebuild('drive_mkdir', () => (
        driveUploadService.ensureDirPathExists({ ownerWalletId, dirPath, password })
      ));
      return res.json({ success: true, dirId, path: driveRuntime.normalizePath(dirPath) });
    } catch (error) {
      return fail(res, String(error?.message || error || 'mkdir failed'));
    }
  });

  app.post('/api/drive/dir/:dirId/rename', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const password = getSessionPassword(req);
      const dirId = String(req.params?.dirId || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!dirId) return fail(res, 'dirId is required');
      if (!name) return fail(res, 'name is required');
      const result = await retryAfterLocalWalletIndexRebuild('drive_rename_dir', () => (
        driveUploadService.renameDir({ ownerWalletId, dirId, name, password })
      ));
      return res.json({
        success: true,
        dir: result.dir || null,
        oldPath: String(result.oldPath || ''),
        newPath: String(result.newPath || ''),
      });
    } catch (error) {
      if (isNoSpendableUtxoError(error)) {
        return res.status(400).json({
          success: false,
          code: 'NO_SPENDABLE_UTXO',
          error: String(error?.message || error || 'No local SPV UTXOs found'),
          wallet: walletSpendableSnapshot(),
        });
      }
      return fail(res, String(error?.message || error || 'rename dir failed'));
    }
  });

  app.post('/api/drive/upload/start', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const dirPath = String(req.body?.path || '').trim();
      const fileName = String(req.body?.fileName || '').trim();
      if (!fileName) return fail(res, 'fileName is required');
      const task = driveUploadService.createUploadTask({
        ownerWalletId,
        dirPath,
        fileName,
        totalBytes: Number(req.body?.totalBytes || 0),
      });
      return res.json({ success: true, task });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload start failed'));
    }
  });

  app.post('/api/drive/upload/:taskId/chunk', walletAuthRequired, async (req, res) => {
    try {
      ensureOwnerLoaded(currentWalletId(), getSessionPassword(req));
      const chunkBase64 = String(req.body?.chunkBase64 || '').trim();
      if (!chunkBase64) return fail(res, 'chunkBase64 is required');
      const task = driveUploadService.appendUploadChunk(req.params.taskId, Buffer.from(chunkBase64, 'base64'));
      return res.json({ success: true, task });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload chunk failed'));
    }
  });

  app.post('/api/drive/upload/:taskId/finish', walletAuthRequired, async (req, res) => {
    try {
      ensureOwnerLoaded(currentWalletId(), getSessionPassword(req));
      const password = getSessionPassword(req);
      const result = await driveUploadService.finishUploadTask(req.params.taskId, { password });
      return res.json({ success: true, ...result });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload finish failed'));
    }
  });

  app.post('/api/drive/upload/:taskId/preview', walletAuthRequired, async (req, res) => {
    try {
      ensureOwnerLoaded(currentWalletId(), getSessionPassword(req));
      const password = getSessionPassword(req);
      const task = await driveUploadService.previewUploadTask(req.params.taskId, { password });
      return res.json({ success: true, preview: task?.preview || null, task });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload preview failed'));
    }
  });

  app.post('/api/drive/upload/:taskId/cancel', walletAuthRequired, async (req, res) => {
    try {
      ensureOwnerLoaded(currentWalletId(), getSessionPassword(req));
      const cancelled = driveUploadService.cancelUploadTask(req.params.taskId);
      return res.json({ success: true, cancelled });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload cancel failed'));
    }
  });

  app.post('/api/drive/file/:fileId/anchor', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const password = getSessionPassword(req);
      const result = await driveUploadService.anchorLocalFile(req.params.fileId, { ownerWalletId, password });
      return res.json({ success: true, ...result });
    } catch (error) {
      return fail(res, String(error?.message || error || 'file anchor failed'));
    }
  });

  app.get('/api/drive/tree', walletAuthRequired, async (req, res) => {
    const startedAt = Date.now();
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      const ensureStartedAt = Date.now();
      readOwnerLoaded(ownerWalletId);
      const ensureMs = Date.now() - ensureStartedAt;
      const dirPath = String(req.query?.path || '/').trim();
      const lookupStartedAt = Date.now();
      const dirId = driveRuntime.findDirByPath(ownerWalletId, dirPath) || driveRuntime.loadOwner(ownerWalletId).rootDirId;
      const lookupMs = Date.now() - lookupStartedAt;
      const listStartedAt = Date.now();
      const listing = driveRuntime.listDir(ownerWalletId, dirId, { preloadChildDirs: true });
      const listMs = Date.now() - listStartedAt;
      const rootLocalDir = currentRootLocalDir(ownerWalletId);
      const treeStartedAt = Date.now();
      const tree = buildTreeNodes(ownerWalletId);
      const treeMs = Date.now() - treeStartedAt;
      const dirsStartedAt = Date.now();
      const dirs = listing.dirs.map((entry) => ({
        ...entry,
        path: driveRuntime.pathForDir(ownerWalletId, entry.dirId),
        downloaded: dirDownloaded(ownerWalletId, entry, rootLocalDir),
      }));
      const dirsMs = Date.now() - dirsStartedAt;
      const filesStartedAt = Date.now();
      const files = listing.files.map((entry) => ({
        ...entry,
        relativePath: driveRuntime.buildFileRelativePath(ownerWalletId, entry.fileId),
        downloaded: fileDownloaded(ownerWalletId, entry, rootLocalDir),
      }));
      const filesMs = Date.now() - filesStartedAt;
      const uploadsStartedAt = Date.now();
      const uploads = typeof driveUploadService.listUploadTasksForDir === 'function'
        ? driveUploadService.listUploadTasksForDir(ownerWalletId, driveRuntime.normalizePath(dirPath))
        : [];
      const uploadsMs = Date.now() - uploadsStartedAt;
      const totalMs = Date.now() - startedAt;
      if (typeof appendMarketDebug === 'function' && totalMs >= 100) {
        appendMarketDebug('drive_tree_perf', {
          path: driveRuntime.normalizePath(dirPath),
          totalMs,
          ensureMs,
          lookupMs,
          listMs,
          treeMs,
          dirsMs,
          filesMs,
          uploadsMs,
          treeCount: tree.length,
          dirCount: dirs.length,
          fileCount: files.length,
          uploadCount: uploads.length,
        });
      }
      return res.json({
        success: true,
        path: driveRuntime.normalizePath(dirPath),
        dirId,
        rootLocalDir,
        tree,
        dirs,
        files,
        uploads,
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'tree failed'));
    }
  });
  function listServerRoots() {
    if (process.platform === 'win32') {
      const roots = [];
      for (let code = 67; code <= 90; code += 1) {
        const root = `${String.fromCharCode(code)}:\\`;
        try {
          if (fs.existsSync(root) && fs.statSync(root).isDirectory()) roots.push(root);
        } catch (_) {}
      }
      return roots.length ? roots : ['C:\\'];
    }
    return ['/'];
  }

  function normalizeServerDir(inputPath) {
    const raw = String(inputPath || '').trim();
    if (!raw) return listServerRoots()[0];
    return path.resolve(raw);
  }

  function listServerDirs(targetPath) {
    const safePath = normalizeServerDir(targetPath);
    const stat = fs.statSync(safePath);
    if (!stat.isDirectory()) throw new Error('path is not a directory');
    const names = fs.readdirSync(safePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(safePath, entry.name),
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const parentPath = path.dirname(safePath);
    const canGoUp = process.platform === 'win32'
      ? parentPath && parentPath !== safePath
      : safePath !== '/';
    return {
      currentPath: safePath,
      parentPath: canGoUp ? parentPath : '',
      roots: listServerRoots(),
      dirs: names,
    };
  }


  app.get('/api/drive/tasks', walletAuthRequired, async (_req, res) => {
    const ownerWalletId = currentWalletId();
    if (ownerWalletId) readOwnerLoaded(ownerWalletId);
    return res.json({
      success: true,
      tasks: typeof driveUploadService.listUploadTasks === 'function'
        ? driveUploadService.listUploadTasks(ownerWalletId)
        : driveStore.loadTasks(),
    });
  });

  app.get('/api/drive/upload/tasks', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      readOwnerLoaded(ownerWalletId);
      return res.json({
        success: true,
        tasks: typeof driveUploadService.listUploadTasks === 'function'
          ? driveUploadService.listUploadTasks(ownerWalletId)
          : [],
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload tasks failed'));
    }
  });

  app.post('/api/drive/upload/:taskId/resume', walletAuthRequired, async (req, res) => {
    try {
      ensureOwnerLoaded(currentWalletId(), getSessionPassword(req));
      const password = getSessionPassword(req);
      const result = await driveUploadService.resumeUploadTask(req.params.taskId, { password });
      return res.json({ success: true, ...result });
    } catch (error) {
      return fail(res, String(error?.message || error || 'upload resume failed'));
    }
  });

  app.post('/api/drive/download/server', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const password = getSessionPassword(req);
      const fileId = String(req.body?.fileId || '').trim();
      const dirId = String(req.body?.dirId || '').trim();
      const configuredRoot = currentRootLocalDir(ownerWalletId);
      const requestedTargetDir = String(req.body?.targetDir || '').trim();
      const targetDir = path.resolve(requestedTargetDir || configuredRoot || path.join(driveFsService.rootDir, 'downloads'));
      if (!requestedTargetDir && !configuredRoot) return fail(res, 'root local directory is not configured');
      if (fileId) {
        const result = driveDownloadService.downloadFileToServer({ ownerWalletId, fileId, targetDir, password });
        return res.json({ success: true, ...result });
      }
      if (dirId) {
        const result = driveDownloadService.downloadDirectoryToServer({ ownerWalletId, dirId, targetDir, password });
        return res.json({ success: true, ...result });
      }
      return fail(res, 'fileId or dirId is required');
    } catch (error) {
      return fail(res, String(error?.message || error || 'server download failed'));
    }
  });

  app.get('/api/drive/download/browser', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      readOwnerLoaded(ownerWalletId);
      const password = getSessionPassword(req);
      const fileId = String(req.query?.fileId || '').trim();
      if (!fileId) return fail(res, 'fileId is required');
      const result = driveDownloadService.downloadFileForBrowser({ ownerWalletId, fileId, password });
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
      return res.end(result.buffer);
    } catch (error) {
      return fail(res, String(error?.message || error || 'browser download failed'));
    }
  });

  app.post('/api/drive/delete/preview', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const targetType = String(req.body?.targetType || '').trim();
      const targetId = String(req.body?.targetId || '').trim();
      if (!targetType || !targetId) return fail(res, 'targetType and targetId are required');
      const preview = buildDeletePreview(ownerWalletId, targetType, targetId);
      return res.json({ success: true, preview });
    } catch (error) {
      return fail(res, String(error?.message || error || 'delete preview failed'));
    }
  });

  app.post('/api/drive/delete', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      ensureOwnerLoaded(ownerWalletId, getSessionPassword(req));
      const targetType = String(req.body?.targetType || '').trim();
      const targetId = String(req.body?.targetId || '').trim();
      if (!targetType || !targetId) return fail(res, 'targetType and targetId are required');
      const password = getSessionPassword(req);
      const marker = buildDeleteObject({ ownerWalletId, targetType, targetId });
      await retryAfterLocalWalletIndexRebuild('drive_delete', () => driveChainService.anchorDeleteObject(marker, {
        password,
        updatedAt: marker.updatedAt,
        includeUnconfirmed: true,
        trackOutputs: true,
      }));
      if (targetType === 'dir') driveStore.markDirDeleted(ownerWalletId, targetId, true);
      if (targetType === 'file') driveStore.markFileDeleted(ownerWalletId, targetId, true);
      driveTrashRuntime.applyDeleteMarker(marker);
      const rootLocalDir = currentRootLocalDir(ownerWalletId);
      if (rootLocalDir) {
        if (targetType === 'dir') {
          const dirPath = driveRuntime.pathForDir(ownerWalletId, targetId);
          if (dirPath) driveFsService.removePath(path.resolve(rootLocalDir, `.${dirPath}`));
        }
        if (targetType === 'file') {
          const filePath = driveRuntime.buildFileRelativePath(ownerWalletId, targetId);
          if (filePath) driveFsService.removePath(path.resolve(rootLocalDir, `.${filePath}`));
        }
      }
      emit('drive.entry.deleted', { ownerWalletId, targetType, targetId });
      if (targetType === 'dir') emit('drive.dir.deleted', { ownerWalletId, targetType, targetId });
      if (targetType === 'file') emit('drive.file.deleted', { ownerWalletId, targetType, targetId });
      emit('drive.tree.updated', { ownerWalletId });
      return res.json({ success: true, marker });
    } catch (error) {
      return fail(res, String(error?.message || error || 'delete failed'));
    }
  });

  app.post('/api/drive/resync', walletAuthRequired, async (req, res) => {
    try {
      const ownerWalletId = ensureWalletId(res);
      if (!ownerWalletId) return;
      const password = getSessionPassword(req);
      const snapshot = driveSyncService.rebuildOwnerIndex(ownerWalletId, { password });
      return res.json({
        success: true,
        dirCount: Object.keys(snapshot.dirs || {}).length,
        fileCount: Object.keys(snapshot.files || {}).length,
        deleteCount: Object.keys(snapshot.deletes || {}).length,
      });
    } catch (error) {
      return fail(res, String(error?.message || error || 'resync failed'));
    }
  });
}

module.exports = {
  registerDriveRoutes,
};

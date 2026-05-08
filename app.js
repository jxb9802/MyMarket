const E2E_UI_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search || "").get("e2e") === "1";
  } catch (_) {
    return false;
  }
})();

const PRODUCT_IMAGE_UPLOAD_MAX_BYTES = 1 * 1024 * 1024;
const PRODUCT_IMAGE_CHAIN_MAX_CHARS = 60000;
const PRODUCT_IMAGE_THUMBNAIL_SIZE = 460;
const PRODUCT_IMAGE_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DONATION_ADDRESS = "13uvtJAitXkLMffuEjLDZckAyoVMu2QsiX";

const state = {
  activeRole: "buyer",
  view: "home",
  profile: { name: "" },
  steward: { regionPriority: "local", pollSec: 15, replayWindow: 120, catalogSyncEnabled: true },
  runtime: {
    lagPolicy: null,
    wallet: null,
  },
  chatConfig: {
    enabled: true,
    displayName: "",
    listenPort: 8787,
    publicHost: "",
    publicPort: 8787,
    allowOnchainInvite: true,
    autoPublishEndpoint: true,
  },
  wallet: {
    exists: false,
    loggedIn: false,
    confirmedSat: 0,
    confirmedBsv: null,
    unconfirmedSat: 0,
    unconfirmedBsv: null,
    availableSat: 0,
    availableBsv: null,
    selfChangePendingSat: 0,
    selfChangePendingBsv: null,
    unconfirmedIncomingSat: 0,
    unconfirmedIncomingBsv: null,
    totalSat: 0,
    totalBsv: null,
    updatedAt: null,
    historyItems: [],
    broadcastMonitor: [],
  },
  walletWatch: { lastTotalSat: null, pollTick: 0, lastNotifiedBalanceUpdatedAt: "" },
  walletShadow: { buyer: 0, seller: 0 },
  sync: { mode: "OUT_OF_SYNC", localHeight: 0, highestBlock: 0, lag: 0, retries: 0, pendingUploads: 0, pendingDetails: [], recoverableDetails: [] },
  merchants: [],
  users: [],
  categories: [],
  products: [],
  orders: [],
  currentMerchantId: "m-local",
  buyerBrowseMode: "category",
  selectedCategoryId: "",
  selectedMerchantId: "",
  selectedBuyerMerchantCategoryId: "ALL",
  selectedSellerProductId: "",
  editingCategoryId: "",
  editingProductId: "",
  orderFilter: "OPEN",
  orderHistoryPage: 1,
  chat: {
    mode: "global",
    surfaceMode: "full",
    threadContext: null,
    activeWalletId: "",
    activeOrderId: null,
    messagePage: 1,
    messagePageSize: 30,
    lastFetchedMessageCount: 0,
    loadingOlderMessages: false,
    nextMessageSequence: 1,
    nextPairListOrder: 1,
    pairs: {},
    threadCache: {},
    selfWalletId: "",
    threads: [],
    friends: [],
    people: [],
    recent: [],
    selfState: { online: true, storageLimitBytes: 104857600 },
    searchQuery: "",
    searchResults: [],
    unreadTotal: 0,
    buttonHasUnread: false,
    buttonUnreadLatched: false,
    lastNotifyAt: 0,
    directThreads: 0,
    needsProfilePublish: false,
    legacyProfileReanchorQueued: false,
    migrationNotice: "",
    pendingLocalMessages: [],
    pendingAttachments: [],
    connectStates: {},
    threadBackendReady: {},
    threadLoading: {},
    statusPollTimer: null,
    activeSwitchSeq: 0,
    statusRefreshSeq: 0,
    visibleStatusRefreshInFlight: false,
    lastPaintSignature: "",
    lastUnreadRefreshAt: 0,
    lastSnapshotUiRefreshAt: 0,
    messageMetaVisible: {
      self: {
        who: false,
        transport: true,
        time: true,
        status: false,
      },
      peer: {
        who: false,
        transport: true,
        time: true,
        status: false,
      },
    },
  },
  drive: {
    currentPath: "/",
    currentDirId: "",
    rootLocalDir: "",
    tree: [],
    dirs: [],
    files: [],
    uploads: [],
    loading: false,
    viewMode: "list",
    expandedDirIds: ["/"],
    pickerPath: "",
    pickerParentPath: "",
    pickerRoots: [],
    pickerDirs: [],
    uploadConfirmResolver: null,
    pendingUploadPreview: null,
    browserDownloadResolver: null,
    pendingBrowserDownloadFile: null,
    deleteConfirmResolver: null,
    pendingDeleteEntry: null,
    pendingDeletes: {},
    mkdirParentPath: "",
    treeContextDirId: "",
    pendingRenameDir: null,
    pendingDirs: {},
    suppressTreeRefreshUntil: 0,
    localTreeUpdateSkips: {},
    uploadProgress: {},
    uploadPollTimer: null,
  },
  spvModalView: "connected",
  search: { keyword: "", primaryCategory: "ALL" },
  walletReceiveAddress: "",
  auth: { mode: "password", createReady: false },
  switchWallet: { currentPassword: "" },
  ui: {
    pendingMutations: 0,
    lastCatalogSig: "",
    nextServerStateToken: 0,
    appliedServerStateToken: 0,
    minSyncSessionEpoch: 0,
    syncResetDisplay: {
      epoch: 0,
      bootstrapHeight: 0,
      holdUntilMs: 0,
    },
    lastChatMigrationNotice: "",
    profileFormSignature: "",
    profileLatestSignature: "",
    profileConflictPending: false,
    conflictResolver: null,
    orderDetail: { orderId: "", role: "buyer" },
    orderNotifications: { buyer: false, seller: false, signatures: {}, baselineReady: false },
    orderChatUnread: {},
    orderPurchaseConfirmResolver: null,
    sellerAcceptConfirmResolver: null,
    shipmentInfoResolver: null,
    categoryEditor: {
      id: "",
      baseSignature: "",
      latestSignature: "",
      conflictPending: false,
      latestMissing: false,
    },
    productEditor: {
      id: "",
      baseSignature: "",
      latestSignature: "",
      conflictPending: false,
      latestMissing: false,
    },
    chatFeeResolver: null,
    chatEnterSubmitLockUntil: 0,
    walletSyncCleanModeUntil: 0,
    walletSendPreflightStatus: "blocked_need_sync",
    walletSendPreflightOk: false,
    walletSendPreflightReason: "",
    walletSendPreflightAt: "",
    walletSyncInFlight: false,
    walletUiLoaded: false,
    walletViewActive: false,
    txProgress: {
      active: false,
      closable: true,
      timer: null,
      kind: "",
      startedAt: "",
      commandId: "",
    },
    resyncFlow: {
      active: false,
      bootstrapHeight: 0,
      commandId: "",
      commandType: "",
      resetEpoch: 0,
      resetCompleted: false,
      startDisabled: false,
      resetAcknowledged: false,
      baselineObserved: false,
      nonce: 0,
      pollTimer: null,
      startedAt: "",
      completedAt: "",
      peakPercent: 0,
      error: "",
    },
    domains: {
      sync: true,
      wallet: true,
      walletLedger: false,
      profile: true,
      catalog: false,
      order: false,
      chat: false,
    },
    domainLoadsInFlight: {},
  },
  timers: { walletPoll: null, catalogPoll: null },
  events: {
    ws: null,
    connected: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    lastSeq: 0,
    handlers: new Map(),
  },
  jobState: null,
  commandQueue: null,
  debug: { lastApi: "-", lastError: "", at: "" },
};

const CHAT_ATTACHMENT_PREFIX = "__chat_attachment_payload_v1__:";

function parseChatAttachmentPayload(raw = "") {
  const text = String(raw || "");
  if (!text.startsWith(CHAT_ATTACHMENT_PREFIX)) {
    return { text, attachments: [], isPayload: false };
  }
  try {
    const parsed = JSON.parse(text.slice(CHAT_ATTACHMENT_PREFIX.length));
    return {
      text: String(parsed?.text || ""),
      attachments: Array.isArray(parsed?.attachments) ? parsed.attachments : [],
      isPayload: true,
    };
  } catch (_) {
    return { text, attachments: [], isPayload: false };
  }
}

function encodeChatAttachmentPayload(text = "", attachments = []) {
  const list = Array.isArray(attachments) ? attachments.filter((item) => item && typeof item === "object") : [];
  if (!list.length) return String(text || "");
  return `${CHAT_ATTACHMENT_PREFIX}${JSON.stringify({ text: String(text || ""), attachments: list })}`;
}

function chatMessagePreviewText(raw = "") {
  const parsed = parseChatAttachmentPayload(raw);
  if (!parsed.isPayload) return String(raw || "");
  const labels = (parsed.attachments || []).map((item) => {
    const name = String(item?.fileName || "attachment").trim();
    return `${item?.isImage ? tr("chat_attachment_image_label", "[Image]") : tr("chat_attachment_file_label", "[Attachment]")} ${name}`.trim();
  });
  return [parsed.text, labels.join(" ")].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

let chatNotifyAudioContext = null;
let buyerSearchDebounceTimer = null;
const WALLET_OP_TIMEOUT_MS = 30000;
const ORDER_CHAIN_OP_TIMEOUT_MS = 120000;
const DRIVE_CHAIN_OP_TIMEOUT_MS = 20 * 60 * 1000;
const PUSH_CHAIN_OP_TIMEOUT_MS = 20 * 60 * 1000;
const PUSH_CHAIN_STATUS_TIMEOUT_MS = 60000;
const BUYER_ALL_MERCHANTS = "__ALL__";
const WALLET_SEND_PREFLIGHT_STORAGE_KEY = "bsv_market.wallet_send_preflight.v2";
const ORDER_NOTIFICATION_SIGNATURE_STORAGE_KEY = "bsv_market.order_notification_signatures.v1";
const LOCAL_ORDER_NOTIFICATION_SUPPRESS_MS = 120000;
const localOrderNotificationSuppressions = {
  byId: new Map(),
  createIntents: [],
};
const CORE_BOOTSTRAP_DOMAINS = ["sync", "wallet", "profile"];
const DEFAULT_CATEGORY_OPTIONS_FALLBACK = [
  "女装",
  "男装",
  "内衣/家居服",
  "女鞋",
  "男鞋",
  "箱包皮具",
  "服饰配件",
  "美妆护肤",
  "珠宝饰品",
  "手表眼镜",
  "手机数码",
  "电脑办公",
  "家用电器",
  "家居日用",
  "家装家纺",
  "家具",
  "母婴用品",
  "童装童鞋",
  "玩具乐器",
  "食品生鲜",
  "酒水饮料",
  "保健食品",
  "运动户外",
  "汽车用品",
  "图书文娱",
  "宠物用品",
  "鲜花园艺",
  "农资绿植",
];

const DEFAULT_CATEGORY_I18N_KEYS = new Map(DEFAULT_CATEGORY_OPTIONS_FALLBACK.map((name, index) => [name, `default_category_${index + 1}`]));

function defaultCategoryDisplayName(name = "") {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const key = DEFAULT_CATEGORY_I18N_KEYS.get(raw);
  return key ? tr(key, raw) : raw;
}

const els = {
  homeView: document.getElementById("homeView"),
  profileView: document.getElementById("profileView"),
  walletCard: document.getElementById("walletCard"),
  btnHomeWalletSend: document.getElementById("btnHomeWalletSend"),
  btnHomeWalletReceive: document.getElementById("btnHomeWalletReceive"),
  myBalance: document.getElementById("myBalance"),
  myRoleTip: document.getElementById("myRoleTip"),
  lockedBalance: document.getElementById("lockedBalance"),
  syncStatus: document.getElementById("syncStatus"),
  syncTip: document.getElementById("syncTip"),
  syncGate: document.getElementById("syncGate"),
  syncGateTip: document.getElementById("syncGateTip"),
  syncProgressBar: document.getElementById("syncProgressBar"),
  syncProgressText: document.getElementById("syncProgressText"),
  syncCard: document.getElementById("syncCard"),
  btnShowConnectedNodes: document.getElementById("btnShowConnectedNodes"),
  btnShowCandidateNodes: document.getElementById("btnShowCandidateNodes"),
  btnSyncNow: document.getElementById("btnSyncNow"),
  btnPushChain: document.getElementById("btnPushChain"),
  orderTip: document.getElementById("orderTip"),
  merchantList: document.getElementById("merchantList"),
  productList: document.getElementById("productList"),
  buyerMerchantCategoryList: document.getElementById("buyerMerchantCategoryList"),
  buyerMerchantProductList: document.getElementById("buyerMerchantProductList"),
  sellerProductList: document.getElementById("sellerProductList"),
  categoryList: document.getElementById("categoryList"),
  buyerPrimaryCategoryList: document.getElementById("buyerPrimaryCategoryList"),
  orderListBuyer: document.getElementById("orderListBuyer"),
  orderListSeller: document.getElementById("orderListSeller"),
  btnOrderHistory: document.getElementById("btnOrderHistory"),
  orderHistoryModal: document.getElementById("orderHistoryModal"),
  btnCloseOrderHistory: document.getElementById("btnCloseOrderHistory"),
  orderHistoryList: document.getElementById("orderHistoryList"),
  btnOrderHistoryPrev: document.getElementById("btnOrderHistoryPrev"),
  btnOrderHistoryNext: document.getElementById("btnOrderHistoryNext"),
  orderHistoryPageInfo: document.getElementById("orderHistoryPageInfo"),
  orderDetailModal: document.getElementById("orderDetailModal"),
  btnCloseOrderDetail: document.getElementById("btnCloseOrderDetail"),
  orderDetailTitle: document.getElementById("orderDetailTitle"),
  orderDetailBody: document.getElementById("orderDetailBody"),
  orderDetailActions: document.getElementById("orderDetailActions"),
  orderPurchaseConfirmModal: document.getElementById("orderPurchaseConfirmModal"),
  btnCloseOrderPurchaseConfirm: document.getElementById("btnCloseOrderPurchaseConfirm"),
  btnCancelOrderPurchaseConfirm: document.getElementById("btnCancelOrderPurchaseConfirm"),
  btnConfirmOrderPurchaseConfirm: document.getElementById("btnConfirmOrderPurchaseConfirm"),
  orderPurchaseConfirmMessage: document.getElementById("orderPurchaseConfirmMessage"),
  orderPurchaseConfirmProductName: document.getElementById("orderPurchaseConfirmProductName"),
  orderPurchaseConfirmMerchant: document.getElementById("orderPurchaseConfirmMerchant"),
  orderPurchaseConfirmQuantity: document.getElementById("orderPurchaseConfirmQuantity"),
  orderPurchaseConfirmPrice: document.getElementById("orderPurchaseConfirmPrice"),
  orderPurchaseConfirmDeposit: document.getElementById("orderPurchaseConfirmDeposit"),
  orderPurchaseConfirmTotal: document.getElementById("orderPurchaseConfirmTotal"),
  orderPurchaseConfirmFee: document.getElementById("orderPurchaseConfirmFee"),
  orderPurchaseConfirmSpendTotal: document.getElementById("orderPurchaseConfirmSpendTotal"),
  sellerAcceptConfirmModal: document.getElementById("sellerAcceptConfirmModal"),
  btnCloseSellerAcceptConfirm: document.getElementById("btnCloseSellerAcceptConfirm"),
  btnCancelSellerAcceptConfirm: document.getElementById("btnCancelSellerAcceptConfirm"),
  btnConfirmSellerAcceptConfirm: document.getElementById("btnConfirmSellerAcceptConfirm"),
  sellerAcceptConfirmMessage: document.getElementById("sellerAcceptConfirmMessage"),
  sellerAcceptConfirmProductName: document.getElementById("sellerAcceptConfirmProductName"),
  sellerAcceptConfirmMerchant: document.getElementById("sellerAcceptConfirmMerchant"),
  sellerAcceptConfirmQuantity: document.getElementById("sellerAcceptConfirmQuantity"),
    sellerAcceptConfirmPrice: document.getElementById("sellerAcceptConfirmPrice"),
  sellerAcceptConfirmBuyerLocked: document.getElementById("sellerAcceptConfirmBuyerLocked"),
  sellerAcceptConfirmSellerDeposit: document.getElementById("sellerAcceptConfirmSellerDeposit"),
  shipmentInfoModal: document.getElementById("shipmentInfoModal"),
  btnCloseShipmentInfo: document.getElementById("btnCloseShipmentInfo"),
  btnCancelShipmentInfo: document.getElementById("btnCancelShipmentInfo"),
  btnConfirmShipmentInfo: document.getElementById("btnConfirmShipmentInfo"),
  shipmentInfoMessage: document.getElementById("shipmentInfoMessage"),
  shipmentInfoInput: document.getElementById("shipmentInfoInput"),
  productDetailModal: document.getElementById("productDetailModal"),
  btnCloseProductDetail: document.getElementById("btnCloseProductDetail"),
  productDetailTitle: document.getElementById("productDetailTitle"),
  productDetailImage: document.getElementById("productDetailImage"),
  productDetailPrice: document.getElementById("productDetailPrice"),
  productDetailMerchant: document.getElementById("productDetailMerchant"),
  productDetailCategory: document.getElementById("productDetailCategory"),
  productDetailStock: document.getElementById("productDetailStock"),
  productDetailQuantity: document.getElementById("productDetailQuantity"),
  productDetailDescription: document.getElementById("productDetailDescription"),
  btnProductDetailBuy: document.getElementById("btnProductDetailBuy"),
  regionPriority: document.getElementById("regionPriority"),
  pollSec: document.getElementById("pollSec"),
  replayWindow: document.getElementById("replayWindow"),
  catalogSyncEnabled: document.getElementById("catalogSyncEnabled"),
  stewardText: document.getElementById("stewardText"),
  profileName: document.getElementById("profileName"),
  keyword: document.getElementById("keyword"),
  categoryName: document.getElementById("categoryName"),
  defaultCategoryOptions: document.getElementById("defaultCategoryOptions"),
  buyerPanel: document.getElementById("buyerPanel"),
  buyerOrdersSection: document.getElementById("buyerOrdersSection"),
  sellerPanel: document.getElementById("sellerPanel"),
  sellerHint: document.getElementById("sellerHint"),
  btnChat: document.getElementById("btnChat"),
  btnDrive: document.getElementById("btnDrive"),
  btnChatBadge: document.getElementById("btnChatBadge"),
  btnProfile: document.getElementById("btnProfile"),
  langLabel: document.getElementById("langLabel"),
  langSelect: document.getElementById("langSelect"),
  btnRefreshMerchants: document.getElementById("btnRefreshMerchants"),
  btnBuyerBrowseByCategory: document.getElementById("btnBuyerBrowseByCategory"),
  btnBuyerBrowseByMerchant: document.getElementById("btnBuyerBrowseByMerchant"),
  buyerBrowseCategoryPane: document.getElementById("buyerBrowseCategoryPane"),
  buyerBrowseMerchantPane: document.getElementById("buyerBrowseMerchantPane"),
  buyerResultHeadline: document.getElementById("buyerResultHeadline"),
  buyerResultMeta: document.getElementById("buyerResultMeta"),
  buyerMerchantHeadline: document.getElementById("buyerMerchantHeadline"),
  buyerMerchantMeta: document.getElementById("buyerMerchantMeta"),
  btnSearch: document.getElementById("btnSearch"),
  btnAddCategory: document.getElementById("btnAddCategory"),
  btnAddProduct: document.getElementById("btnAddProduct"),
  categoryEditModal: document.getElementById("categoryEditModal"),
  categoryEditTitle: document.getElementById("categoryEditTitle"),
  btnCloseCategoryEdit: document.getElementById("btnCloseCategoryEdit"),
  editCategoryPreset: document.getElementById("editCategoryPreset"),
  editCategoryName: document.getElementById("editCategoryName"),
  btnSubmitCategoryEdit: document.getElementById("btnSubmitCategoryEdit"),
  productEditModal: document.getElementById("productEditModal"),
  btnCloseProductEdit: document.getElementById("btnCloseProductEdit"),
  editProductTitle: document.getElementById("editProductTitle"),
  editProductCategory: document.getElementById("editProductCategory"),
  editProductPrice: document.getElementById("editProductPrice"),
  editProductStock: document.getElementById("editProductStock"),
  editProductImageFile: document.getElementById("editProductImageFile"),
  editProductImageUrl: document.getElementById("editProductImageUrl"),
  editProductImagePreview: document.getElementById("editProductImagePreview"),
  editProductDescription: document.getElementById("editProductDescription"),
  btnSubmitProductEdit: document.getElementById("btnSubmitProductEdit"),
  btnSaveProfile: document.getElementById("btnSaveProfile"),
  btnRecoverSync: document.getElementById("btnRecoverSync"),
  btnRebuildData: document.getElementById("btnRebuildData"),
  btnApplySteward: document.getElementById("btnApplySteward"),
  btnLogout: document.getElementById("btnLogout"),
  walletAvailableBalanceView: document.getElementById("walletAvailableBalanceView"),
  walletPendingBalanceView: document.getElementById("walletPendingBalanceView"),
  walletPendingIncomingBalanceView: document.getElementById("walletPendingIncomingBalanceView"),
  walletBalanceView: document.getElementById("walletBalanceView"),
  walletReceiveView: document.getElementById("walletReceiveView"),
  btnCopyReceive: document.getElementById("btnCopyReceive"),
  walletReceiveQr: document.getElementById("walletReceiveQr"),
  walletHistoryList: document.getElementById("walletHistoryList"),
  btnWalletSwitch: document.getElementById("btnWalletSwitch"),
  btnWalletSync: document.getElementById("btnWalletSync"),
  btnWalletReceive: document.getElementById("btnWalletReceive"),
  btnWalletSend: document.getElementById("btnWalletSend"),
  btnWalletDonate: document.getElementById("btnWalletDonate"),
  btnShowMnemonic: document.getElementById("btnShowMnemonic"),
  walletReceiveTitle: document.getElementById("walletReceiveTitle"),
  advancedSummary: document.getElementById("advancedSummary"),
  sendModal: document.getElementById("sendModal"),
  sendModalTitle: document.getElementById("sendModalTitle"),
  btnCloseSend: document.getElementById("btnCloseSend"),
  sendModalTo: document.getElementById("sendModalTo"),
  sendModalAmount: document.getElementById("sendModalAmount"),
  sendModalNote: document.getElementById("sendModalNote"),
  sendModalAvailableBalance: document.getElementById("sendModalAvailableBalance"),
  btnSendAll: document.getElementById("btnSendAll"),
  btnSendConfirm: document.getElementById("btnSendConfirm"),
  receiveModal: document.getElementById("receiveModal"),
  btnCloseReceiveModal: document.getElementById("btnCloseReceiveModal"),
  receiveModalQr: document.getElementById("receiveModalQr"),
  receiveModalAddress: document.getElementById("receiveModalAddress"),
  btnCopyReceiveModal: document.getElementById("btnCopyReceiveModal"),
  chatFeeModal: document.getElementById("chatFeeModal"),
  chatFeeMessage: document.getElementById("chatFeeMessage"),
  btnCloseChatFee: document.getElementById("btnCloseChatFee"),
  btnCancelChatFee: document.getElementById("btnCancelChatFee"),
  btnConfirmChatFee: document.getElementById("btnConfirmChatFee"),
  addProductModal: document.getElementById("addProductModal"),
  btnCloseAddProduct: document.getElementById("btnCloseAddProduct"),
  addProductTitle: document.getElementById("addProductTitle"),
  addProductCategory: document.getElementById("addProductCategory"),
  addProductPrice: document.getElementById("addProductPrice"),
  addProductStock: document.getElementById("addProductStock"),
  addProductImageFile: document.getElementById("addProductImageFile"),
  addProductImageUrl: document.getElementById("addProductImageUrl"),
  addProductImagePreview: document.getElementById("addProductImagePreview"),
  addProductDescription: document.getElementById("addProductDescription"),
  btnSubmitAddProduct: document.getElementById("btnSubmitAddProduct"),
  mnemonicModal: document.getElementById("mnemonicModal"),
  btnCloseMnemonic: document.getElementById("btnCloseMnemonic"),
  mnemonicPassword: document.getElementById("mnemonicPassword"),
  btnMnemonicConfirm: document.getElementById("btnMnemonicConfirm"),
  mnemonicOutput: document.getElementById("mnemonicOutput"),
  switchWalletModal: document.getElementById("switchWalletModal"),
  switchStep1: document.getElementById("switchStep1"),
  switchStep2: document.getElementById("switchStep2"),
  btnCloseSwitchWallet: document.getElementById("btnCloseSwitchWallet"),
  switchWalletPassword: document.getElementById("switchWalletPassword"),
  switchWalletNewPassword: document.getElementById("switchWalletNewPassword"),
  btnSwitchStep1Next: document.getElementById("btnSwitchStep1Next"),
  switchWalletMnemonic: document.getElementById("switchWalletMnemonic"),
  switchWalletProgress: document.getElementById("switchWalletProgress"),
  btnConfirmSwitchWallet: document.getElementById("btnConfirmSwitchWallet"),
  spvNodesModal: document.getElementById("spvNodesModal"),
  btnCloseSpvNodes: document.getElementById("btnCloseSpvNodes"),
  spvNodesSummary: document.getElementById("spvNodesSummary"),
  spvNodesList: document.getElementById("spvNodesList"),
  tabSpvConnected: document.getElementById("tabSpvConnected"),
  tabSpvCandidates: document.getElementById("tabSpvCandidates"),
  pendingModal: document.getElementById("pendingModal"),
  btnClosePending: document.getElementById("btnClosePending"),
  pendingSummary: document.getElementById("pendingSummary"),
  pendingFeeSummary: document.getElementById("pendingFeeSummary"),
  pendingList: document.getElementById("pendingList"),
  recoverableSummary: document.getElementById("recoverableSummary"),
  recoverableList: document.getElementById("recoverableList"),
  pendingPassword: document.getElementById("pendingPassword"),
  btnConfirmPushInModal: document.getElementById("btnConfirmPushInModal"),
  txProgressModal: document.getElementById("txProgressModal"),
  btnCloseTxProgress: document.getElementById("btnCloseTxProgress"),
  txProgressTitle: document.getElementById("txProgressTitle"),
  txProgressSummary: document.getElementById("txProgressSummary"),
  txProgressStepList: document.getElementById("txProgressStepList"),
  txProgressElapsed: document.getElementById("txProgressElapsed"),
  resyncModal: document.getElementById("resyncModal"),
  btnCloseResync: document.getElementById("btnCloseResync"),
  resyncConfirmPanel: document.getElementById("resyncConfirmPanel"),
  resyncBootstrapHeight: document.getElementById("resyncBootstrapHeight"),
  resyncModalHint: document.getElementById("resyncModalHint"),
  resyncProgressPanel: document.getElementById("resyncProgressPanel"),
  resyncProgressTitle: document.getElementById("resyncProgressTitle"),
  resyncProgressSummary: document.getElementById("resyncProgressSummary"),
  resyncProgressBar: document.getElementById("resyncProgressBar"),
  resyncProgressText: document.getElementById("resyncProgressText"),
  resyncStepList: document.getElementById("resyncStepList"),
  resyncElapsed: document.getElementById("resyncElapsed"),
  btnConfirmResync: document.getElementById("btnConfirmResync"),
  conflictModal: document.getElementById("conflictModal"),
  conflictModalTitle: document.getElementById("conflictModalTitle"),
  conflictModalMessage: document.getElementById("conflictModalMessage"),
  btnCloseConflictModal: document.getElementById("btnCloseConflictModal"),
  btnCancelConflictModal: document.getElementById("btnCancelConflictModal"),
  btnConfirmConflictModal: document.getElementById("btnConfirmConflictModal"),
  loginModal: document.getElementById("loginModal"),
  loginHint: document.getElementById("loginHint"),
  loadingModal: document.getElementById("loadingModal"),
  loadingHint: document.getElementById("loadingHint"),
  tabLoginPassword: document.getElementById("tabLoginPassword"),
  tabLoginCreate: document.getElementById("tabLoginCreate"),
  tabLoginImport: document.getElementById("tabLoginImport"),
  loginPasswordWrap: document.getElementById("loginPasswordWrap"),
  loginPassword: document.getElementById("loginPassword"),
  loginMnemonicWrap: document.getElementById("loginMnemonicWrap"),
  loginMnemonic: document.getElementById("loginMnemonic"),
  btnGenerateMnemonic: document.getElementById("btnGenerateMnemonic"),
  btnLoginSubmit: document.getElementById("btnLoginSubmit"),
  chatModal: document.getElementById("chatModal"),
  chatCard: document.getElementById("chatCard"),
  chatTitle: document.getElementById("chatTitle"),
  chatUserPane: document.getElementById("chatUserPane"),
  chatStatusBar: document.getElementById("chatStatusBar"),
  chatSelfStatusDot: document.getElementById("chatSelfStatusDot"),
  chatSelfStatus: document.getElementById("chatSelfStatus"),
  chatThreadStatus: document.getElementById("chatThreadStatus"),
  btnChatP2pConnect: document.getElementById("btnChatP2pConnect"),
  btnChatToggleOnline: document.getElementById("btnChatToggleOnline"),
  btnChatFriendAction: document.getElementById("btnChatFriendAction"),
  btnChatCreateGroup: document.getElementById("btnChatCreateGroup"),
  btnChatBlockAction: document.getElementById("btnChatBlockAction"),
  btnChatMenu: document.getElementById("btnChatMenu"),
  chatMenuDropdown: document.getElementById("chatMenuDropdown"),
  chatUserContextMenu: document.getElementById("chatUserContextMenu"),
  btnChatContextAddFriend: document.getElementById("btnChatContextAddFriend"),
  chatFriendConfirmModal: document.getElementById("chatFriendConfirmModal"),
  btnCloseChatFriendConfirm: document.getElementById("btnCloseChatFriendConfirm"),
  chatFriendConfirmList: document.getElementById("chatFriendConfirmList"),
  btnChatDisplayMenu: document.getElementById("btnChatDisplayMenu"),
  chatDisplayMenuDropdown: document.getElementById("chatDisplayMenuDropdown"),
  btnChatShowList: document.getElementById("btnChatShowList"),
  btnChatMaximize: document.getElementById("btnChatMaximize"),
  chatMetaSelfWho: document.getElementById("chatMetaSelfWho"),
  chatMetaSelfTransport: document.getElementById("chatMetaSelfTransport"),
  chatMetaSelfTime: document.getElementById("chatMetaSelfTime"),
  chatMetaSelfStatus: document.getElementById("chatMetaSelfStatus"),
  chatMetaPeerWho: document.getElementById("chatMetaPeerWho"),
  chatMetaPeerTransport: document.getElementById("chatMetaPeerTransport"),
  chatMetaPeerTime: document.getElementById("chatMetaPeerTime"),
  chatMetaPeerStatus: document.getElementById("chatMetaPeerStatus"),
  chatSearchInput: document.getElementById("chatSearchInput"),
  btnChatSearch: document.getElementById("btnChatSearch"),
  chatP2pSummary: document.getElementById("chatP2pSummary"),
  chatBox: document.getElementById("chatBox"),
  btnChatLoadMore: document.getElementById("btnChatLoadMore"),
  chatEmojiBar: document.getElementById("chatEmojiBar"),
  chatAttachmentPreview: document.getElementById("chatAttachmentPreview"),
  btnChatAttach: document.getElementById("btnChatAttach"),
  chatAttachmentInput: document.getElementById("chatAttachmentInput"),
  chatInput: document.getElementById("chatInput"),
  btnSendChat: document.getElementById("btnSendChat"),
  btnCloseChat: document.getElementById("btnCloseChat"),
  chatEnabled: document.getElementById("chatEnabled"),
  chatListenPort: document.getElementById("chatListenPort"),
  chatPublicHost: document.getElementById("chatPublicHost"),
  chatPublicPort: document.getElementById("chatPublicPort"),
  chatConnectMode: document.getElementById("chatConnectMode"),
  chatRelayUrl: document.getElementById("chatRelayUrl"),
  chatAllowOnchainInvite: document.getElementById("chatAllowOnchainInvite"),
  chatFallbackToOnchain: document.getElementById("chatFallbackToOnchain"),
  chatAutoPublishEndpoint: document.getElementById("chatAutoPublishEndpoint"),
  chatPubKey: document.getElementById("chatPubKey"),
  chatConfigStatus: document.getElementById("chatConfigStatus"),
  driveModal: document.getElementById("driveModal"),
  driveTitle: document.getElementById("driveTitle"),
  btnCloseDrive: document.getElementById("btnCloseDrive"),
  driveRootDirInput: document.getElementById("driveRootDirInput"),
  btnPickDriveRootDir: document.getElementById("btnPickDriveRootDir"),
  btnDriveViewList: document.getElementById("btnDriveViewList"),
  btnDriveViewGrid: document.getElementById("btnDriveViewGrid"),
  btnDriveNewDir: document.getElementById("btnDriveNewDir"),
  btnDriveUpload: document.getElementById("btnDriveUpload"),
  driveUploadInput: document.getElementById("driveUploadInput"),
  btnDriveRefresh: document.getElementById("btnDriveRefresh"),
  driveRootDirHint: document.getElementById("driveRootDirHint"),
  driveTreePane: document.getElementById("driveTreePane"),
  driveCurrentPath: document.getElementById("driveCurrentPath"),
  driveListingPane: document.getElementById("driveListingPane"),
  driveDirPickerModal: document.getElementById("driveDirPickerModal"),
  btnCloseDriveDirPicker: document.getElementById("btnCloseDriveDirPicker"),
  btnDriveDirGoUp: document.getElementById("btnDriveDirGoUp"),
  driveDirPickerPath: document.getElementById("driveDirPickerPath"),
  btnConfirmDriveDirPicker: document.getElementById("btnConfirmDriveDirPicker"),
  driveDirRoots: document.getElementById("driveDirRoots"),
  driveDirPickerList: document.getElementById("driveDirPickerList"),
  driveMkdirModal: document.getElementById("driveMkdirModal"),
  btnCloseDriveMkdir: document.getElementById("btnCloseDriveMkdir"),
  btnCancelDriveMkdir: document.getElementById("btnCancelDriveMkdir"),
  btnConfirmDriveMkdir: document.getElementById("btnConfirmDriveMkdir"),
  driveMkdirCurrentPath: document.getElementById("driveMkdirCurrentPath"),
  driveMkdirName: document.getElementById("driveMkdirName"),
  driveRenameDirModal: document.getElementById("driveRenameDirModal"),
  btnCloseDriveRenameDir: document.getElementById("btnCloseDriveRenameDir"),
  btnCancelDriveRenameDir: document.getElementById("btnCancelDriveRenameDir"),
  btnConfirmDriveRenameDir: document.getElementById("btnConfirmDriveRenameDir"),
  driveRenameDirCurrentPath: document.getElementById("driveRenameDirCurrentPath"),
  driveRenameDirName: document.getElementById("driveRenameDirName"),
  driveUploadConfirmModal: document.getElementById("driveUploadConfirmModal"),
  btnCloseDriveUploadConfirm: document.getElementById("btnCloseDriveUploadConfirm"),
  btnCancelDriveUploadConfirm: document.getElementById("btnCancelDriveUploadConfirm"),
  btnConfirmDriveUploadConfirm: document.getElementById("btnConfirmDriveUploadConfirm"),
  driveUploadConfirmMessage: document.getElementById("driveUploadConfirmMessage"),
  driveUploadConfirmDetails: document.getElementById("driveUploadConfirmDetails"),
  driveBrowserDownloadModal: document.getElementById("driveBrowserDownloadModal"),
  btnCloseDriveBrowserDownload: document.getElementById("btnCloseDriveBrowserDownload"),
  btnCancelDriveBrowserDownload: document.getElementById("btnCancelDriveBrowserDownload"),
  btnConfirmDriveBrowserDownload: document.getElementById("btnConfirmDriveBrowserDownload"),
  driveBrowserDownloadMessage: document.getElementById("driveBrowserDownloadMessage"),
  driveBrowserDownloadName: document.getElementById("driveBrowserDownloadName"),
  driveDeleteConfirmModal: document.getElementById("driveDeleteConfirmModal"),
  btnCloseDriveDeleteConfirm: document.getElementById("btnCloseDriveDeleteConfirm"),
  btnCancelDriveDeleteConfirm: document.getElementById("btnCancelDriveDeleteConfirm"),
  btnConfirmDriveDeleteConfirm: document.getElementById("btnConfirmDriveDeleteConfirm"),
  driveDeleteConfirmMessage: document.getElementById("driveDeleteConfirmMessage"),
  driveDeleteConfirmName: document.getElementById("driveDeleteConfirmName"),
  noticeStack: document.getElementById("noticeStack"),
};

function fmt(v) {
  return `${Number(v || 0).toFixed(8)} BSV`;
}

function fmtSatAsBsv(sat) {
  const safeSat = Math.max(0, Math.trunc(Number(sat || 0)));
  return `${(safeSat / 100000000).toFixed(8)} BSV`;
}

function fmtBsvAmount(value) {
  const safe = Math.max(0, Number(value || 0));
  return `${safe.toFixed(8)} BSV`;
}

function closeOrderPurchaseConfirmModal(confirmed = false) {
  if (els.orderPurchaseConfirmModal) els.orderPurchaseConfirmModal.classList.add("hidden");
  const resolver = state.ui.orderPurchaseConfirmResolver;
  state.ui.orderPurchaseConfirmResolver = null;
  if (typeof resolver === "function") resolver(Boolean(confirmed));
}

async function openOrderPurchaseConfirmModal(product, quantity = 1) {
  const item = product && typeof product === "object" ? product : null;
  if (!item) return false;
  const qty = Math.max(1, Math.floor(Number(quantity || 1)));
  const preview = await api("/api/orders/place/preview", { method: "POST", body: { productId: String(item.id || ""), quantity: qty } });
  const priceBsv = Math.max(0, Number(preview?.priceBsv || 0));
  const depositBsv = Math.max(0, Number(preview?.depositBsv || 0));
  const totalBsv = Math.max(0, Number(preview?.lockTotalBsv || 0));
  const feeBsv = Math.max(0, Number(preview?.feeBsv || 0));
  const spendTotalBsv = totalBsv + feeBsv;
  if (els.orderPurchaseConfirmProductName) els.orderPurchaseConfirmProductName.textContent = String(item.title || "-");
  if (els.orderPurchaseConfirmMerchant) els.orderPurchaseConfirmMerchant.textContent = merchantNameById(item.merchantId) || String(item.merchantId || "-");
  if (els.orderPurchaseConfirmQuantity) els.orderPurchaseConfirmQuantity.textContent = String(qty);
  if (els.orderPurchaseConfirmPrice) els.orderPurchaseConfirmPrice.textContent = fmtBsvAmount(priceBsv);
  if (els.orderPurchaseConfirmDeposit) els.orderPurchaseConfirmDeposit.textContent = fmtBsvAmount(depositBsv);
  if (els.orderPurchaseConfirmTotal) els.orderPurchaseConfirmTotal.textContent = fmtBsvAmount(totalBsv);
  if (els.orderPurchaseConfirmFee) els.orderPurchaseConfirmFee.textContent = fmtBsvAmount(feeBsv);
  if (els.orderPurchaseConfirmSpendTotal) els.orderPurchaseConfirmSpendTotal.textContent = fmtBsvAmount(spendTotalBsv);
  if (els.orderPurchaseConfirmMessage) {
    els.orderPurchaseConfirmMessage.textContent = trf("order_purchase_confirm_message", {
      price: fmtBsvAmount(priceBsv),
      deposit: fmtBsvAmount(depositBsv),
      total: fmtBsvAmount(totalBsv),
      fee: fmtBsvAmount(feeBsv),
      spendTotal: fmtBsvAmount(spendTotalBsv),
    }, `This order will lock product amount ${fmtBsvAmount(priceBsv)} plus 20% deposit ${fmtBsvAmount(depositBsv)}. Total locked ${fmtBsvAmount(totalBsv)}, fee ${fmtBsvAmount(feeBsv)}, total spend ${fmtBsvAmount(spendTotalBsv)}. Confirm to compose and broadcast now.`);
  }
  if (els.orderPurchaseConfirmModal) els.orderPurchaseConfirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    state.ui.orderPurchaseConfirmResolver = resolve;
    window.setTimeout(() => {
      try { els.btnConfirmOrderPurchaseConfirm?.focus(); } catch (_) {}
    }, 0);
  });
}

function closeSellerAcceptConfirmModal(result = null) {
  if (els.sellerAcceptConfirmModal) els.sellerAcceptConfirmModal.classList.add("hidden");
  const resolver = state.ui.sellerAcceptConfirmResolver;
  state.ui.sellerAcceptConfirmResolver = null;
  if (typeof resolver === "function") resolver(result);
}

function orderSnapshotTitle(order) {
  const snapshot = order?.snapshot && typeof order.snapshot === "object" ? order.snapshot : {};
  return String(snapshot.title || snapshot.product_title || order?.title || "-");
}

function openSellerAcceptConfirmModal(order) {
  const safeOrder = order && typeof order === "object" ? order : null;
  if (!safeOrder) return Promise.resolve(null);
  const quantity = orderQuantity(safeOrder);
  const priceSat = Math.max(0, Number(safeOrder?.funds?.priceSats || orderAmountSats(safeOrder)));
  const buyerLockSat = Math.max(0, Number(safeOrder?.funds?.buyerLockedSats || 0));
  const sellerDepositSat = Math.max(0, Number(safeOrder?.funds?.sellerDepositSats || Math.floor(priceSat * 0.1)));
  const estimatedShipFeeSat = Math.max(0, Number(safeOrder?.chain?.sellerShipAnchorFeeSats || 0));
  const merchantId = String(safeOrder?.snapshot?.merchant_id || safeOrder?.snapshot?.merchantId || safeOrder?.chain?.sellerMerchantId || "").trim();
  if (els.sellerAcceptConfirmProductName) els.sellerAcceptConfirmProductName.textContent = orderSnapshotTitle(safeOrder);
  if (els.sellerAcceptConfirmMerchant) els.sellerAcceptConfirmMerchant.textContent = merchantNameById(merchantId) || merchantId || "-";
  if (els.sellerAcceptConfirmQuantity) els.sellerAcceptConfirmQuantity.textContent = String(quantity);
  if (els.sellerAcceptConfirmPrice) els.sellerAcceptConfirmPrice.textContent = fmtSatAsBsv(priceSat);
  if (els.sellerAcceptConfirmBuyerLocked) els.sellerAcceptConfirmBuyerLocked.textContent = fmtSatAsBsv(buyerLockSat);
  if (els.sellerAcceptConfirmSellerDeposit) els.sellerAcceptConfirmSellerDeposit.textContent = fmtSatAsBsv(sellerDepositSat);
  if (els.sellerAcceptConfirmMessage) {
    els.sellerAcceptConfirmMessage.textContent = trf("seller_accept_confirm_message", {
      deposit: fmtSatAsBsv(sellerDepositSat),
      shipFee: estimatedShipFeeSat > 0 ? fmtSatAsBsv(estimatedShipFeeSat) : tr("fee_estimate_pending", "待估算"),
    }, `Accepting this order will lock 5% seller deposit ${fmtSatAsBsv(sellerDepositSat)}. Estimated shipment on-chain fee ${estimatedShipFeeSat > 0 ? fmtSatAsBsv(estimatedShipFeeSat) : "pending"} will be paid when shipping. Confirm to compose and broadcast now.`);
  }
  if (els.sellerAcceptConfirmModal) els.sellerAcceptConfirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    state.ui.sellerAcceptConfirmResolver = resolve;
    window.setTimeout(() => {
      try { els.btnConfirmSellerAcceptConfirm?.focus(); } catch (_) {}
    }, 0);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function cssEscape(value = "") {
  const raw = String(value || "");
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(raw);
  return raw.replace(/["\\]/g, "\\$&");
}

function walletIdByUserId(userId) {
  const safe = String(userId || "").replace(/^seller-/, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return safe ? `wallet-${safe}` : "";
}

function localStatusBadge(status) {
  if (status === "new") return tr("badge_new", " [新增]");
  if (status === "modified") return tr("badge_modified", " [已修改]");
  return "";
}

function syncModeLabel(mode) {
  const m = String(mode || "").toUpperCase();
  const lagPolicyMode = String(state.runtime?.lagPolicy?.mode || "").toUpperCase();
  if (m === "OUT_OF_SYNC") {
    if (lagPolicyMode === "FULL_SYNC") return tr("wallet_status_full_sync", "全速同步");
    if (lagPolicyMode === "CATCHUP_SYNC") return tr("wallet_status_catchup_sync", "追尾同步");
    return tr("wallet_status_syncing", "同步中");
  }
  const map = {
    FULL_SYNC: tr("wallet_status_synced", "已同步"),
    WALLET_ACTIVE: tr("wallet_status_synced", "已同步"),
    SYNCING: tr("wallet_status_syncing", "同步中"),
    RECOVERING: tr("wallet_status_recovering", "恢复中"),
    ERROR: tr("wallet_status_error", "异常"),
  };
  return map[m] || (m ? m : "-");
}

function walletHeaderStatusLabel(gate) {
  if (!state.wallet.exists) return tr("wallet_state_missing", "Not created");
  if (!state.wallet.loggedIn) return tr("wallet_state_logged_out", "Signed out");
  if (gate?.ready === true) return tr("wallet_ready", "Ready");
  if (state.ui.walletSyncInFlight || syncInProgress()) return tr("wallet_status_syncing", "Syncing");
  if (gate?.status === "no_utxo" || Number(state.wallet.totalSat || 0) <= 0) return tr("wallet_balance_insufficient", "余额不足");
  return tr("wallet_not_ready_short", "Not ready");
}

function canceledOrderStatusLabel(order = null) {
  return tr("order_status_canceled", "取消");
}

function orderStatusLabel(status, order = null) {
  const s = String(status || "").toUpperCase();
  const map = {
    PLACED: tr("order_status_placed", "已下单"),
    LOCKED: tr("order_status_locked", "交易锁定"),
    SHIPPED: tr("order_status_shipped", "已发货"),
    REFUND_REQUESTED: tr("order_status_refund_requested", "申请退款中"),
    COMPLETED: tr("order_status_delivered", "已收货"),
    CANCELED: canceledOrderStatusLabel(order),
    TIMED_OUT: tr("order_status_timed_out", "已超时"),
    REFUNDED: tr("order_status_refunded", "退款完成"),
  };
  return map[s] || (s ? s : "-");
}

function safeHttpUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "";
}

function safeProductImageSrc(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(s)) return s;
  return "";
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(tr("product_image_read_failed", "Failed to read image")));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(src) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr("product_image_load_failed", "Failed to load image")));
    img.src = src;
  });
}

async function buildProductThumbnailDataUrl(file) {
  if (!file || typeof file !== "object") throw new Error(tr("product_image_missing", "请选择商品图片"));
  if (!PRODUCT_IMAGE_ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) {
    throw new Error(tr("product_image_type_error", "商品图片只支持 JPG、PNG、WebP"));
  }
  if (Number(file.size || 0) > PRODUCT_IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error(tr("product_image_file_too_large", "商品图片不能超过 1MB"));
  }
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImageElement(dataUrl);
  const size = PRODUCT_IMAGE_THUMBNAIL_SIZE;
  const sourceSize = Math.min(Math.max(1, img.width), Math.max(1, img.height));
  const sourceX = Math.max(0, Math.round((img.width - sourceSize) / 2));
  const sourceY = Math.max(0, Math.round((img.height - sourceSize) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(tr("product_image_thumbnail_failed", "Thumbnail processing failed"));
  ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  let quality = 0.82;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > PRODUCT_IMAGE_CHAIN_MAX_CHARS && quality > 0.45) {
    quality -= 0.08;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  if (out.length > PRODUCT_IMAGE_CHAIN_MAX_CHARS) {
    throw new Error(tr("product_image_compressed_too_large", "图片压缩后仍然太大，请换一张更简单的图片"));
  }
  return out;
}

function setProductImagePreview(imgEl, value) {
  if (!imgEl) return;
  const src = safeProductImageSrc(value);
  imgEl.src = src;
  imgEl.classList.toggle("hidden", !src);
}

async function handleProductImageFileSelection(fileInputEl, hiddenValueEl, previewEl) {
  const file = fileInputEl?.files?.[0] || null;
  if (!file) {
    if (hiddenValueEl) hiddenValueEl.value = "";
    setProductImagePreview(previewEl, "");
    return;
  }
  try {
    const dataUrl = await buildProductThumbnailDataUrl(file);
    if (hiddenValueEl) hiddenValueEl.value = dataUrl;
    setProductImagePreview(previewEl, dataUrl);
  } catch (err) {
    if (fileInputEl) fileInputEl.value = "";
    if (hiddenValueEl) hiddenValueEl.value = "";
    setProductImagePreview(previewEl, "");
    toast(err?.message || tr("product_image_prepare_failed", "商品图片处理失败"));
  }
}

function pendingEventLabel(eventType = "") {
  const map = {
    profile_set: tr("pending_event_profile_set", "个人信息更新"),
    category_add: tr("pending_event_category_add", "新增分类"),
    category_edit: tr("pending_event_category_edit", "修改分类"),
    category_delete: tr("pending_event_category_delete", "删除分类"),
    product_add: tr("pending_event_product_add", "新增商品"),
    product_edit: tr("pending_event_product_edit", "修改商品"),
    product_bump: tr("pending_event_product_bump", "改价改库存"),
    product_delete: tr("pending_event_product_delete", "删除商品"),
  };
  return map[eventType] || eventType || tr("pending_event_unknown", "未知事件");
}

function buyerMerchants() {
  const currentMerchantId = String(state.currentMerchantId || "");
  const merchantMeta = new Map();
  const displayMerchantName = (idRaw = "", nameRaw = "") => {
    const id = String(idRaw || "").trim();
    const name = String(nameRaw || "").trim();
    if (name && name !== id) return localizeDisplayName(name);
    if (!id) return tr("merchant_unnamed", "未命名商家");
    const shortId = id.replace(/^m-/, "").slice(0, 6) || id;
    return trf("merchant_unnamed_short", { id: shortId }, `未命名商家(${shortId})`);
  };
  (state.merchants || []).forEach((m) => {
    const id = String(m?.id || "");
    if (!id) return;
    merchantMeta.set(id, {
      id,
      name: displayMerchantName(id, m?.name),
      downloadedAt: Number(m?.downloadedAt || 0),
    });
  });
  const touchMerchant = (merchantIdRaw, tsRaw) => {
    const merchantId = String(merchantIdRaw || "");
    if (!merchantId || merchantId === currentMerchantId) return;
    const prev = merchantMeta.get(merchantId) || {
      id: merchantId,
      name: displayMerchantName(merchantId, ""),
      downloadedAt: 0,
    };
    const nextTs = Number(new Date(tsRaw || 0).getTime() || Number(tsRaw || 0) || 0);
    merchantMeta.set(merchantId, {
      id: merchantId,
      name: displayMerchantName(merchantId, prev.name),
      downloadedAt: Math.max(Number(prev.downloadedAt || 0), nextTs),
    });
  };
  (state.categories || []).forEach((c) => {
    if (c?.ownedByCurrentWallet === true) return;
    if (isDeletedCatalogRow(c)) return;
    touchMerchant(c?.merchantId, c?.localUpdatedAt);
  });
  (state.products || []).forEach((p) => {
    if (p?.ownedByCurrentWallet === true) return;
    if (String(p?.merchantId || "") === currentMerchantId) return;
    if (isDeletedCatalogRow(p)) return;
    touchMerchant(p?.merchantId, p?.localUpdatedAt);
  });
  return Array.from(merchantMeta.values())
    .filter((m) => String(m.id || "") !== currentMerchantId)
    .filter((m) => (state.products || []).some((p) => {
      if (String(p?.merchantId || "") !== String(m?.id || "")) return false;
      if (String(p?.merchantId || "") === currentMerchantId) return false;
      if (p?.ownedByCurrentWallet === true) return false;
      if (isDeletedCatalogRow(p)) return false;
      return true;
    }))
    .sort((a, b) => Number(b.downloadedAt || 0) - Number(a.downloadedAt || 0));
}

function sellerCategories() {
  return (state.categories || []).filter((c) => isOwnedCategory(c) && !isDeletedCatalogRow(c));
}

function categoryNameById(categoryId = "") {
  const wanted = String(categoryId || "").trim();
  if (!wanted) return "";
  const matchCategory = (allowDeleted = false) => (state.categories || []).find((item) => {
    if (!allowDeleted && isDeletedCatalogRow(item)) return false;
    const itemId = String(item?.id || item?.categoryId || item?.category_id || "").trim();
    const itemName = String(item?.name || item?.title || "").trim();
    return itemId === wanted || itemName === wanted;
  });
  const row = matchCategory(false) || matchCategory(true);
  return defaultCategoryDisplayName(String(row?.name || row?.title || "").trim() || wanted);
}

function normalizeCatalogCategories(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const item = row && typeof row === "object" ? row : {};
    const id = String(item.id || item.categoryId || item.category_id || "").trim();
    return {
      ...item,
      id,
      name: String(item.name || item.title || item.categoryName || item.category_name || id || "").trim(),
      merchantId: String(item.merchantId || item.merchant_id || state.currentMerchantId || "").trim(),
    };
  });
}

function normalizeCatalogProducts(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const item = row && typeof row === "object" ? row : {};
    return {
      ...item,
      id: String(item.id || item.productId || item.product_id || "").trim(),
      categoryId: String(item.categoryId || item.category_id || item.category || "").trim(),
      merchantId: String(item.merchantId || item.merchant_id || "").trim(),
      title: String(item.title || item.name || item.productName || item.product_name || "").trim(),
      imageUrl: String(item.imageUrl || item.image_url || item.image || "").trim(),
      description: String(item.description || item.desc || "").trim(),
      categoryName: String(item.categoryName || item.category_name || "").trim(),
    };
  });
}

function productCategoryId(product = null) {
  return String(product?.categoryId || product?.category_id || product?.category || "").trim();
}

function productCategoryName(product = null, fallback = "") {
  const direct = String(product?.categoryName || product?.category_name || "").trim();
  if (direct) return defaultCategoryDisplayName(direct);
  const id = productCategoryId(product);
  if (id) return categoryNameById(id) || id;
  return defaultCategoryDisplayName(String(fallback || "").trim());
}

function merchantNameById(merchantId = "") {
  const wanted = String(merchantId || "").trim();
  if (!wanted) return "";
  const row = (state.merchants || []).find((item) => String(item?.id || "").trim() === wanted);
  return localizeDisplayName(String(row?.name || "").trim()) || wanted;
}

function productById(productId = "") {
  const wanted = String(productId || "").trim();
  if (!wanted) return null;
  return (state.products || []).find((item) => String(item?.id || item?.productId || item?.product_id || "").trim() === wanted) || null;
}

function openProductDetailModal(productId = "") {
  const product = productById(productId);
  if (!product) return;
  const imageUrl = safeProductImageSrc(product.imageUrl);
  if (els.productDetailTitle) els.productDetailTitle.textContent = String(product.title || tr("product_detail_title", "Product details"));
  if (els.productDetailImage) {
    if (imageUrl) {
      els.productDetailImage.src = String(imageUrl);
      els.productDetailImage.classList.remove("hidden");
    } else {
      els.productDetailImage.removeAttribute("src");
      els.productDetailImage.classList.add("hidden");
    }
  }
  if (els.productDetailPrice) els.productDetailPrice.textContent = Number(product.price || 0).toFixed(8);
  if (els.productDetailMerchant) els.productDetailMerchant.textContent = trf("product_detail_merchant_line", { merchant: merchantNameById(product.merchantId || product.merchant_id) || String(product.merchantId || product.merchant_id || "-") }, `Merchant: ${merchantNameById(product.merchantId || product.merchant_id) || String(product.merchantId || product.merchant_id || "-")}`);
  if (els.productDetailCategory) els.productDetailCategory.textContent = trf("product_detail_category_line", { category: productCategoryName(product) || tr("uncategorized", "Uncategorized") }, `Category: ${productCategoryName(product) || tr("uncategorized", "Uncategorized")}`);
  if (els.productDetailStock) {
    const stock = Number(product.stock || 0);
    const sold = Number(product.soldCount || 0);
    els.productDetailStock.textContent = trf("product_detail_stock_line", { stock, sold }, `Stock ${stock} · Sold ${sold}`);
  }
  if (els.productDetailQuantity) {
    const stock = Math.max(0, Math.floor(Number(product.stock || 0)));
    els.productDetailQuantity.min = "1";
    if (stock > 0) els.productDetailQuantity.max = String(stock);
    else els.productDetailQuantity.removeAttribute("max");
    els.productDetailQuantity.value = "1";
    els.productDetailQuantity.disabled = product.deleted === true;
  }
  if (els.productDetailDescription) els.productDetailDescription.textContent = String(product.description || "").trim() || tr("product_detail_no_description", "No description");
  if (els.btnProductDetailBuy) {
    const stock = Math.max(0, Math.floor(Number(product.stock || 0)));
    const ownProduct = isOwnedProduct(product) || String(product?.merchantId || "") === String(state.currentMerchantId || "");
    let disabledReason = "";
    if (product.deleted === true) disabledReason = tr("product_deleted_order_disabled", "商品已删除，不能下单。");
    else if (ownProduct) disabledReason = tr("own_product_order_disabled", "不能购买自己发布的商品。");
    els.btnProductDetailBuy.dataset.productId = String(product.id || "");
    els.btnProductDetailBuy.disabled = Boolean(disabledReason);
    els.btnProductDetailBuy.title = disabledReason;
  }
  if (els.productDetailModal) els.productDetailModal.classList.remove("hidden");
}

function closeProductDetailModal() {
  if (els.productDetailModal) els.productDetailModal.classList.add("hidden");
  if (els.btnProductDetailBuy) delete els.btnProductDetailBuy.dataset.productId;
}

function buyerPrimaryCategories() {
  const defaults = getDefaultCategoryOptions();
  const present = new Set(["ALL"]);
  const rows = [{
    key: "ALL",
    name: tr("all_categories", "所有"),
  }];
  defaults.forEach((name) => {
    const key = String(name || "").trim();
    if (!key || present.has(key)) return;
    present.add(key);
    rows.push({ key, name: defaultCategoryDisplayName(key) });
  });
  return rows;
}

function matchesPrimaryCategoryKeyword(selectedCategory = "", product = null) {
  const raw = String(selectedCategory || "").trim();
  if (!raw || raw === "ALL") return true;
  const tokens = raw
    .split(/[\/\s、，,]+/)
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    String(product?.title || ""),
    String(product?.description || ""),
    String(productCategoryName(product) || ""),
    defaultCategoryDisplayName(String(product?.categoryName || product?.category_name || "")),
  ].join(" ").toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function visibleBuyerProductsBase() {
  const keyword = String(state.search.keyword || "").trim().toLowerCase();
  return (state.products || []).filter((p) => {
    if (isOwnedProduct(p)) return false;
    if (String(p?.merchantId || "") === String(state.currentMerchantId || "")) return false;
    if (isDeletedCatalogRow(p)) return false;
    if (keyword) {
      const haystack = [
        String(p?.title || ""),
        String(p?.description || ""),
        String(productCategoryName(p) || ""),
        defaultCategoryDisplayName(String(p?.categoryName || p?.category_name || "")),
      ].join(" ").toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function buyerMerchantCategories() {
  const merchantId = String(state.selectedMerchantId || "").trim();
  if (!merchantId || merchantId === BUYER_ALL_MERCHANTS) return [];
  const seen = new Set(["ALL"]);
  const rows = [{
    id: "ALL",
    name: tr("all_categories", "所有"),
  }];
  (state.categories || []).forEach((row) => {
    if (row?.ownedByCurrentWallet === true) return;
    if (String(row?.merchantId || "").trim() !== merchantId) return;
    if (isDeletedCatalogRow(row)) return;
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push({
      id,
      name: defaultCategoryDisplayName(String(row?.name || id).trim()),
    });
  });
  return rows;
}

function normalizeCategoryName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function categoryNameExists(name, excludeId = "") {
  const wanted = normalizeCategoryName(name);
  const excluded = String(excludeId || "").trim();
  if (!wanted) return false;
  return sellerCategories().some((row) => {
    if (String(row?.id || "").trim() === excluded) return false;
    return normalizeCategoryName(row?.name) === wanted;
  });
}

function getDefaultCategoryOptions() {
  return Array.isArray(globalThis.CATALOG_DEFAULT_CATEGORIES) && globalThis.CATALOG_DEFAULT_CATEGORIES.length
    ? globalThis.CATALOG_DEFAULT_CATEGORIES.slice()
    : DEFAULT_CATEGORY_OPTIONS_FALLBACK.slice();
}

function renderDefaultCategoryOptions() {
  if (!els.defaultCategoryOptions) return;
  els.defaultCategoryOptions.innerHTML = getDefaultCategoryOptions()
    .map((name) => `<option value="${escapeHtml(String(name || ""))}">${escapeHtml(defaultCategoryDisplayName(name))}</option>`)
    .join("");
}

function renderDefaultCategoryPresetSelect() {
  if (!els.editCategoryPreset) return;
  const options = [`<option value="">${escapeHtml(tr("select_default_category", "选择默认分类"))}</option>`]
    .concat(getDefaultCategoryOptions().map((name) => `<option value="${escapeHtml(String(name || ""))}">${escapeHtml(defaultCategoryDisplayName(name))}</option>`));
  els.editCategoryPreset.innerHTML = options.join("");
}

function ensureLocalCategoryPresent(category = null) {
  if (!category || typeof category !== "object") return;
  const id = String(category.id || "").trim();
  const name = String(category.name || "").trim();
  const merchantId = String(category.merchantId || state.currentMerchantId || "").trim();
  if (!id || !name || !merchantId) return;
  if (state.categories.some((row) => String(row?.id || "").trim() === id)) return;
  state.categories = state.categories.concat([{
    id,
    name,
    merchantId,
    ownedByCurrentWallet: true,
    version: Math.max(1, Number(category.version || 1)),
    deleted: false,
    localStatus: String(category.localStatus || "new"),
    localUpdatedAt: String(category.localUpdatedAt || new Date().toISOString()),
  }]);
}

function sameMerchantId(a = "", b = "") {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isDeletedCatalogRow(row) {
  const deleted = row?.deleted;
  return deleted === true || deleted === 1 || String(deleted || "").trim().toLowerCase() === "true";
}

function isOwnedCategory(c) {
  const currentMerchantId = String(state.currentMerchantId || "").trim();
  const categoryMerchantId = String(c?.merchantId || "").trim();
  return Boolean(c?.ownedByCurrentWallet === true || (currentMerchantId && categoryMerchantId && sameMerchantId(categoryMerchantId, currentMerchantId)));
}

function isOwnedProduct(p) {
  const currentMerchantId = String(state.currentMerchantId || "").trim();
  const productMerchantId = String(p?.merchantId || "").trim();
  return Boolean(p?.ownedByCurrentWallet === true || (currentMerchantId && productMerchantId && sameMerchantId(productMerchantId, currentMerchantId)));
}

function toast(msg) {
  pushNotice(msg, "warn");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatElapsedText(elapsedMs) {
  const ms = Math.max(0, Number(elapsedMs || 0));
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function closeTxProgressModal(force = false) {
  if (!els.txProgressModal) return;
  if (!force && state.ui?.txProgress?.closable === false) return;
  if (state.ui?.txProgress?.timer) {
    clearTimeout(state.ui.txProgress.timer);
    state.ui.txProgress.timer = null;
  }
  state.ui.txProgress.active = false;
  state.ui.txProgress.closable = true;
  state.ui.txProgress.kind = "";
  state.ui.txProgress.startedAt = "";
  state.ui.txProgress.commandId = "";
  els.txProgressModal.classList.add("hidden");
}

function txProgressStepBlueprint(kind) {
  if (kind === "push") {
    return [
      { key: "waiting", label: tr("tx_progress_step_waiting", "1. Submit send task") },
      { key: "compose", label: tr("tx_progress_step_compose", "2. Compose transaction") },
      { key: "sign", label: tr("tx_progress_step_sign", "3. Sign and package") },
      { key: "broadcast", label: tr("tx_progress_step_broadcast", "4. Broadcast transaction") },
    ];
  }
  return [
      { key: "waiting", label: tr("tx_progress_step_waiting", "1. Submit send task") },
    { key: "wallet_send_start", label: tr("tx_progress_step_compose", "2. Compose transaction") },
    { key: "wallet_send_signed", label: tr("tx_progress_step_sign", "3. Sign and package") },
    { key: "wallet_send_broadcasted", label: tr("tx_progress_step_broadcast", "4. Broadcast transaction") },
  ];
}

function renderTxProgressUi(view) {
  if (!els.txProgressStepList) return;
  if (els.txProgressTitle) els.txProgressTitle.textContent = String(view.title || tr("tx_progress_title", "Transaction in progress"));
  if (els.txProgressSummary) els.txProgressSummary.textContent = String(view.summary || "");
  if (els.txProgressElapsed) {
    els.txProgressElapsed.textContent = trf("tx_progress_elapsed", { elapsed: String(view.elapsedText || "0s") }, `Elapsed ${String(view.elapsedText || "0s")}`);
  }
  els.txProgressStepList.innerHTML = (view.steps || []).map((step) => {
    const status = String(step.status || "pending");
    const statusIcon = status === "done" ? "✓" : (status === "error" ? "!" : (status === "active" ? "…" : "·"));
    const statusLabel = status === "done"
      ? tr("status_done", "Done")
      : (status === "error" ? tr("status_error", "Failed") : (status === "active" ? tr("status_active", "In progress") : tr("status_pending", "Pending")));
    const cls = ["resync-step"];
    if (status === "active") cls.push("active");
    if (status === "done") cls.push("done");
    if (status === "error") cls.push("error");
    return `<div class="${cls.join(" ")}"><div class="resync-step-head"><div class="resync-step-title"><span class="resync-step-icon">${escapeHtml(statusIcon)}</span><strong>${escapeHtml(step.label || "")}</strong></div><span class="resync-step-status">${escapeHtml(statusLabel)}</span></div><p class="resync-step-detail">${escapeHtml(step.detail || "")}</p></div>`;
  }).join("");
  if (els.btnCloseTxProgress) els.btnCloseTxProgress.disabled = state.ui?.txProgress?.closable === false;
}

function openTxProgressModal(kind, title) {
  if (!els.txProgressModal) return;
  if (state.ui?.txProgress?.timer) {
    clearTimeout(state.ui.txProgress.timer);
    state.ui.txProgress.timer = null;
  }
  state.ui.txProgress.active = true;
  state.ui.txProgress.closable = false;
  state.ui.txProgress.kind = String(kind || "");
  state.ui.txProgress.startedAt = new Date().toISOString();
  const steps = txProgressStepBlueprint(kind).map((step, index) => ({
    ...step,
    status: index === 0 ? "active" : "pending",
    detail: index === 0 ? tr("tx_progress_waiting_worker", "Submitting to the background send queue...") : "",
  }));
  renderTxProgressUi({
    title: String(title || tr("tx_progress_title", "Transaction in progress")),
    summary: tr("tx_progress_summary_waiting", "Waiting for task startup..."),
    elapsedText: "0s",
    steps,
  });
  els.txProgressModal.classList.remove("hidden");
}

function finalizeTxProgressSuccess(summary) {
  state.ui.txProgress.closable = true;
  renderTxProgressUi({
    title: els.txProgressTitle?.textContent || tr("tx_progress_title", "Transaction in progress"),
    summary: summary || tr("tx_progress_success", "Completed successfully"),
    elapsedText: formatElapsedText(Date.now() - Date.parse(String(state.ui?.txProgress?.startedAt || new Date().toISOString()))),
    steps: txProgressStepBlueprint(state.ui?.txProgress?.kind || "").map((step) => ({
      ...step,
      status: "done",
      detail: tr("tx_progress_step_done_detail", "Completed"),
    })),
  });
  state.ui.txProgress.timer = setTimeout(() => closeTxProgressModal(true), 900);
}

function commandProgressView(kind, payload) {
  const command = payload?.command || null;
  const job = payload?.job || null;
  const commandStatus = String(command?.status || "pending");
  const jobStatus = String(job?.status || "");
  const status = jobStatus === "running" ? "running" : commandStatus;
  const stage = String(job?.stage || command?.payload?.stage || "");
  const errorText = String(command?.error || job?.lastError || "");
  const startedAt = String(job?.startedAt || command?.claimedAt || command?.createdAt || state.ui?.txProgress?.startedAt || "");
  const stageUpdatedAt = String(job?.updatedAt || command?.updatedAt || "");
  const steps = txProgressStepBlueprint(kind).map((step) => ({ ...step, status: "pending", detail: "" }));
  const stageMap = {
    starting: 0,
    wallet_send_start: 1,
    wallet_send_composed: 2,
    wallet_send_signed: 3,
    wallet_send_broadcasting: 3,
    wallet_send_broadcasted: 3,
  };
  let activeIndex = stageMap[stage];
  if (!Number.isFinite(activeIndex)) activeIndex = 0;
  steps.forEach((step, index) => {
    if (status === "done") {
      step.status = "done";
      step.detail = tr("tx_progress_step_done_detail", "Completed");
    } else if (status === "failed" || status === "interrupted") {
      step.status = index < activeIndex ? "done" : (index === activeIndex ? "error" : "pending");
      if (index === activeIndex) step.detail = errorText || tr("tx_progress_failed", "Failed");
    } else if (status === "claimed" || status === "pending" || status === "running") {
      step.status = index < activeIndex ? "done" : (index === activeIndex ? "active" : "pending");
      if (index === activeIndex) {
        const baseDetail = index === 0
          ? tr("tx_progress_waiting_task_detail", "Queued and waiting for the send worker")
          : (index === 1
            ? tr("tx_progress_composing_detail", "Building transaction inputs and outputs")
            : (index === 2
              ? tr("tx_progress_signing_detail", "Signing and packaging transaction context")
              : tr("tx_progress_broadcasting_detail", "Broadcasting to network nodes")));
        const activeSinceMs = Date.parse(stageUpdatedAt);
        const activeElapsedMs = Number.isFinite(activeSinceMs) && activeSinceMs > 0 ? Date.now() - activeSinceMs : 0;
        step.detail = activeElapsedMs > 0
          ? trf("tx_progress_current_step_elapsed", { step: baseDetail, detail: baseDetail, elapsed: formatElapsedText(activeElapsedMs) }, `${baseDetail}，用时 ${formatElapsedText(activeElapsedMs)}`)
          : baseDetail;
      }
    }
  });
  const elapsedMs = startedAt ? (Date.now() - Date.parse(startedAt)) : 0;
  return {
    done: status === "done",
    failed: status === "failed" || status === "interrupted",
    summary: status === "done"
      ? tr("tx_progress_success", "Completed successfully")
      : (errorText || (status === "running"
        ? tr("tx_progress_running", "Processing transaction...")
        : tr("tx_progress_summary_waiting", "Waiting for task startup..."))),
    elapsedText: formatElapsedText(elapsedMs),
    steps,
  };
}

function pushProgressView(progress) {
  const currentItem = progress?.currentItem || null;
  const currentEventType = String(currentItem?.eventType || "");
  const currentLabel = String(progress?.currentLabel || "compose");
  const errorText = localizeUserFacingError(progress?.lastError || "");
  const steps = txProgressStepBlueprint("push").map((step) => ({ ...step, status: "pending", detail: "" }));
  const stageIndex = currentLabel === "broadcast" ? 3 : (currentLabel === "sign" ? 2 : (currentLabel === "compose" ? 1 : 0));
  steps.forEach((step, index) => {
    if (String(progress?.status || "") === "done") {
      step.status = "done";
      step.detail = tr("tx_progress_step_done_detail", "Completed");
    } else if (String(progress?.status || "") === "failed") {
      step.status = index < stageIndex ? "done" : (index === stageIndex ? "error" : "pending");
      if (index === stageIndex) step.detail = errorText || tr("tx_progress_failed", "Failed");
    } else {
      step.status = index < stageIndex ? "done" : (index === stageIndex ? "active" : "pending");
      if (index === stageIndex) {
        step.detail = index === 0
          ? tr("tx_progress_waiting_task_detail", "Queued and waiting for the send worker")
          : (index === 1
            ? tr("tx_progress_composing_detail", "Building transaction inputs and outputs")
            : (index === 2
              ? tr("tx_progress_signing_detail", "Signing and packaging transaction context")
              : tr("tx_progress_broadcasting_detail", "Broadcasting to network nodes")));
      }
    }
  });
  const startedAt = String(progress?.startedAt || "");
  const elapsedMs = startedAt ? (Date.now() - Date.parse(startedAt)) : 0;
  const processed = Number(progress?.processed || 0);
  const total = Number(progress?.total || 0);
  const remaining = Number(progress?.remaining || 0);
  const currentOrdinal = Math.min(total || 0, Math.max(1, processed + (String(progress?.status || "") === "done" ? 0 : 1)));
  const itemTitle = currentEventType
    ? trf("tx_progress_push_item_title", { item: pendingEventLabel(currentEventType) }, `Publish ${pendingEventLabel(currentEventType)}`)
    : tr("tx_progress_push_title", "Publishing on-chain");
  return {
    title: itemTitle,
    done: String(progress?.status || "") === "done",
    failed: String(progress?.status || "") === "failed",
    summary: String(progress?.status || "") === "done"
      ? trf("tx_progress_push_done", { processed }, `Published ${processed} items successfully`)
      : (String(progress?.status || "") === "failed"
        ? (errorText || tr("tx_progress_failed", "Failed"))
        : trf("tx_progress_push_running", { current: currentOrdinal, total, remaining }, `Current ${currentOrdinal}/${total}, remaining ${remaining}`)),
    elapsedText: formatElapsedText(elapsedMs),
    steps,
  };
}

async function trackWalletSendProgress(commandId) {
  const safeId = String(commandId || "").trim();
  if (!safeId) throw new Error(tr("tx_progress_missing_command", "Missing command id"));
  const deadline = Date.now() + WALLET_OP_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const payload = await api(`/api/command-status/${encodeURIComponent(safeId)}`, { silent: true });
    const view = commandProgressView("send", payload);
    renderTxProgressUi({
      title: tr("tx_progress_send_title", "Sending BSV"),
      summary: view.summary,
      elapsedText: view.elapsedText,
      steps: view.steps,
    });
    if (view.done) return payload;
    if (view.failed) throw new Error(String(payload?.command?.error || payload?.job?.lastError || tr("wallet_send_failed", "Send failed")));
    await sleep(300);
  }
  throw new Error(tr("wallet_send_timeout", "Send timed out"));
}

async function trackWalletSyncCommand(commandId, options = {}) {
  const safeId = String(commandId || "").trim();
  if (!safeId) throw new Error(tr("tx_progress_missing_command", "Missing command id"));
  const deadline = Date.now() + WALLET_OP_TIMEOUT_MS;
  let lastProgressText = "";
  while (Date.now() <= deadline) {
    const payload = await api(`/api/command-status/${encodeURIComponent(safeId)}`, { silent: true });
    let progress = {};
    try {
      const progressPayload = await api("/api/wallet/sync-progress", { silent: true });
      progress = progressPayload?.progress || {};
    } catch (_) {
      progress = {};
    }
    const command = payload?.command || null;
    const job = payload?.job || null;
    const status = String(command?.status || "pending");
    const progressText = formatWalletSyncProgress(progress)
      || String(progress?.message || "")
      || String(job?.stage || "")
      || (status === "claimed"
        ? tr("wallet_refresh_worker_running", "Wallet refresh running in background")
        : tr("wallet_refresh_waiting_worker", "Wallet refresh queued and waiting for background worker"));
    if (progressText && progressText !== lastProgressText) {
      lastProgressText = progressText;
      if (typeof options.onProgress === "function") options.onProgress(progressText, { command, job, progress });
    }
    if (status === "done") {
      return command?.result && typeof command.result === "object"
        ? { success: true, ...command.result }
        : payload;
    }
    if (status === "failed" || status === "interrupted") {
      throw new Error(String(command?.error || job?.lastError || tr("wallet_refresh_failed", "Wallet refresh failed")));
    }
    await sleep(400);
  }
  throw new Error(tr("wallet_refresh_timeout", "Wallet refresh timed out"));
}

async function resolveWalletSyncResponse(initialPayload, options = {}) {
  if (initialPayload?.queued === true || initialPayload?.inProgress === true) {
    return trackWalletSyncCommand(initialPayload?.commandId || "", options);
  }
  return initialPayload;
}

async function trackPushProgress() {
  const deadline = Date.now() + PUSH_CHAIN_OP_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const payload = await api("/api/changes/push/status", { silent: true, timeoutMs: PUSH_CHAIN_STATUS_TIMEOUT_MS });
    const progress = payload?.progress || {};
    const view = pushProgressView(progress);
    renderTxProgressUi({
      title: view.title || tr("tx_progress_push_title", "Publishing on-chain"),
      summary: view.summary,
      elapsedText: view.elapsedText,
      steps: view.steps,
    });
    if (view.done) return payload;
    if (view.failed) throw new Error(localizeUserFacingError(progress?.lastError || tr("pending_publish_failed", "Publish failed")));
    await sleep(400);
  }
  throw new Error(tr("tx_progress_timeout", "Operation timed out"));
}

function renderSyncChainProgressTick(title, startedAt, options = {}) {
  const elapsedMs = Date.now() - Number(startedAt || Date.now());
  const steps = txProgressStepBlueprint("push").map((step, index) => ({ ...step, status: "pending", detail: "" }));
  const activeIndex = elapsedMs < 800 ? 0 : (elapsedMs < 2200 ? 1 : (elapsedMs < 4200 ? 2 : 3));
  steps.forEach((step, index) => {
    if (index < activeIndex) {
      step.status = "done";
      step.detail = tr("tx_progress_step_done_detail", "Completed");
    } else if (index === activeIndex) {
      step.status = "active";
      const baseDetail = index === 0
        ? tr("tx_progress_waiting_task_detail", "Queued and waiting for the send worker")
        : (index === 1
          ? tr("tx_progress_composing_detail", "Building transaction inputs and outputs")
          : (index === 2
            ? tr("tx_progress_signing_detail", "Signing and packaging transaction context")
            : tr("tx_progress_broadcasting_detail", "Broadcasting to network nodes")));
      step.detail = trf(
        "tx_progress_current_step_elapsed",
        { step: baseDetail, detail: baseDetail, elapsed: formatElapsedText(elapsedMs) },
        `${baseDetail}，用时 ${formatElapsedText(elapsedMs)}`,
      );
    }
  });
  renderTxProgressUi({
    title,
    summary: String(options.summary || tr("tx_progress_sync_chain_summary", "Submitting on-chain transaction...")),
    elapsedText: formatElapsedText(elapsedMs),
    steps,
  });
}

async function runSynchronousChainAction(title, action, options = {}) {
  const progressTitle = String(title || tr("tx_progress_push_title", "Publishing on-chain"));
  const startedAt = Date.now();
  openTxProgressModal("push", progressTitle);
  renderSyncChainProgressTick(progressTitle, startedAt, options);
  const timer = setInterval(() => {
    if (state.ui?.txProgress?.active !== true) return;
    renderSyncChainProgressTick(progressTitle, startedAt, options);
  }, 400);
  try {
    const result = await action();
    clearInterval(timer);
    const warning = String(result?.warning || "").trim();
    finalizeTxProgressSuccess(warning
      ? trf("tx_progress_success_with_warning", { warning }, `Completed successfully: ${warning}`)
      : tr("tx_progress_success", "Completed successfully"));
    return result;
  } catch (err) {
    clearInterval(timer);
    const msg = String(err?.message || err || tr("tx_progress_failed", "Failed"));
    state.ui.txProgress.closable = true;
    renderTxProgressUi({
      title: progressTitle,
      summary: msg,
      elapsedText: formatElapsedText(Date.now() - startedAt),
      steps: txProgressStepBlueprint("push").map((step, index) => ({
        ...step,
        status: index === 3 ? "error" : (index < 3 ? "done" : "pending"),
        detail: index === 3 ? msg : (index < 3 ? tr("tx_progress_step_done_detail", "Completed") : ""),
      })),
    });
    if (els.txProgressModal) els.txProgressModal.classList.remove("hidden");
    throw err;
  }
}

function defaultResyncBootstrapHeight() {
  const current = Math.floor(Number(state.sync.bootstrapHeight || 0));
  return current >= 947111 ? current : 947111;
}

function openResyncModal() {
  if (!els.resyncModal || !els.resyncBootstrapHeight) return;
  els.resyncBootstrapHeight.value = String(defaultResyncBootstrapHeight());
  if (els.resyncModalHint) {
    const pending = Number(state.sync.pendingUploads || 0);
    els.resyncModalHint.textContent = pending > 0
      ? trf("resync_pending_warning", { count: pending }, `There are still ${pending} local pending publish changes. Resync may clear them as well.`)
      : tr("resync_no_pending_warning", "No pending local publish changes detected, but local cache will still be cleared.");
  }
  resetResyncProgressUi();
  els.resyncModal.classList.remove("hidden");
}

function clearResyncFlowPoller() {
  const timer = state.ui?.resyncFlow?.pollTimer;
  if (timer) clearInterval(timer);
  state.ui.resyncFlow.pollTimer = null;
}

function resetResyncProgressUi() {
  clearResyncFlowPoller();
  state.ui.resyncFlow.active = false;
  state.ui.resyncFlow.error = "";
  state.ui.resyncFlow.commandId = "";
  state.ui.resyncFlow.commandType = "";
  state.ui.resyncFlow.resetEpoch = 0;
  state.ui.resyncFlow.resetCompleted = false;
  state.ui.resyncFlow.startDisabled = false;
  state.ui.resyncFlow.resetAcknowledged = false;
  state.ui.resyncFlow.baselineObserved = false;
  state.ui.resyncFlow.nonce = Math.max(0, Number(state.ui.resyncFlow.nonce || 0));
  state.ui.resyncFlow.startedAt = "";
  state.ui.resyncFlow.completedAt = "";
  state.ui.resyncFlow.peakPercent = 0;
  if (els.resyncConfirmPanel) els.resyncConfirmPanel.classList.remove("hidden");
  if (els.resyncProgressPanel) els.resyncProgressPanel.classList.add("hidden");
  if (els.resyncProgressTitle) els.resyncProgressTitle.textContent = tr("resync_progress_title", "Processing in background");
  if (els.resyncProgressSummary) els.resyncProgressSummary.textContent = tr("resync_progress_summary", "Waiting for task startup...");
  if (els.resyncProgressBar) els.resyncProgressBar.style.width = "0%";
  if (els.resyncProgressText) els.resyncProgressText.textContent = tr("resync_progress_preparing", "Preparing");
  if (els.resyncStepList) els.resyncStepList.innerHTML = "";
  if (els.resyncElapsed) els.resyncElapsed.textContent = tr("resync_elapsed_default", "Elapsed 0s");
  if (els.btnCloseResync) els.btnCloseResync.disabled = false;
  if (els.btnConfirmResync) els.btnConfirmResync.disabled = false;
}

function baseResyncSteps(progress = {}) {
  const bootstrapHeight = Math.max(0, Number(progress.bootstrapHeight || state.ui.resyncFlow.bootstrapHeight || state.sync.bootstrapHeight || 0));
  return [
    { key: "request", label: tr("resync_step_request", "1. Submit resync request"), detail: trf("resync_step_request_detail", { height: bootstrapHeight || "-" }, `Start height ${bootstrapHeight || "-"}`) },
    { key: "reset", label: tr("resync_step_reset", "2. Reset local sync state"), detail: tr("resync_step_reset_detail", "Clear old directories and write new bootstrap and sync epoch") },
    { key: "queue", label: tr("resync_step_queue", "3. Background job takeover"), detail: tr("resync_step_queue_detail", "Waiting for steward to claim the task and enter running state") },
    { key: "prepare", label: tr("resync_step_prepare", "4. Prepare sync data"), detail: tr("resync_step_prepare_detail", "Save reset state, reload trusted headers, and prepare the first sync window") },
    { key: "node", label: tr("resync_step_node", "5. Probe sync nodes"), detail: tr("resync_step_node_detail", "Check working nodes and prepare the first block workers") },
    { key: "rebuild", label: tr("resync_step_rebuild", "6. Enter sync"), detail: tr("resync_step_rebuild_detail", "Background sync has started and worker nodes are active") },
  ];
}

function progressMetaFromSnapshot(syncLike = {}, bootstrapOverride = null) {
  const bootstrapHeight = Math.max(0, Number(bootstrapOverride ?? syncLike.bootstrapHeight ?? state.sync.bootstrapHeight ?? 0));
  const localHeight = Math.max(0, Number(syncLike.localHeight ?? state.sync.localHeight ?? 0));
  const bootstrapIndex = syncLike.bootstrapIndex && typeof syncLike.bootstrapIndex === "object"
    ? syncLike.bootstrapIndex
    : (syncLike.sourceStats && typeof syncLike.sourceStats === "object" ? syncLike.sourceStats.bootstrapIndex : null);
  const recoveredHeight = Math.max(0, Number(bootstrapIndex?.recoveredHeight || bootstrapIndex?.toHeight || 0));
  const highestBlock = Math.max(
    0,
    Number(syncLike.highestBlock ?? syncLike.networkHeight ?? syncLike?.bhs?.tipHeight ?? state.sync.highestBlock ?? state.sync.networkHeight ?? state.sync?.bhs?.tipHeight ?? 0),
  );
  const total = Math.max(1, highestBlock - Math.max(0, bootstrapHeight - 1));
  const done = Math.max(0, localHeight - Math.max(0, bootstrapHeight - 1));
  const rawPercent = Math.max(0, Math.min(100, (done / total) * 100));
  const percent = done >= total
    ? 100
    : Math.min(99.9, Math.floor(rawPercent * 10) / 10);
  return {
    percent,
    localHeight,
    highestBlock,
    bootstrapHeight,
    recoveredHeight,
    lag: Math.max(0, highestBlock - localHeight),
  };
}

function normalizeResyncStatusEnvelope(syncStatus = null) {
  const syncEnvelope = syncStatus?.sync && typeof syncStatus.sync === "object" ? syncStatus.sync : {};
  const topRuntime = syncStatus?.runtime && typeof syncStatus.runtime === "object" ? syncStatus.runtime : {};
  const topJobState = syncStatus?.jobState && typeof syncStatus.jobState === "object" ? syncStatus.jobState : {};
  const topCommandQueue = syncStatus?.commandQueue && typeof syncStatus.commandQueue === "object" ? syncStatus.commandQueue : {};
  const nestedRuntime = syncEnvelope?.runtime && typeof syncEnvelope.runtime === "object" ? syncEnvelope.runtime : {};
  const nestedJobState = syncEnvelope?.jobState && typeof syncEnvelope.jobState === "object" ? syncEnvelope.jobState : {};
  const nestedCommandQueue = syncEnvelope?.commandQueue && typeof syncEnvelope.commandQueue === "object" ? syncEnvelope.commandQueue : {};
  return {
    sync: syncEnvelope,
    runtime: Object.keys(nestedRuntime).length ? nestedRuntime : topRuntime,
    jobState: Object.keys(nestedJobState).length ? nestedJobState : topJobState,
    commandQueue: Object.keys(nestedCommandQueue).length ? nestedCommandQueue : topCommandQueue,
  };
}

function mergeLiveSyncSnapshot(targetSync, liveSync) {
  const next = targetSync && typeof targetSync === "object" ? targetSync : {};
  const live = liveSync && typeof liveSync === "object" ? liveSync : null;
  if (!live) return next;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(live, key);
  const pickNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number(fallback || 0);
  };
  const nextSessionEpoch = Math.max(0, pickNumber(next.sessionEpoch, 0));
  const liveSessionEpoch = Math.max(0, pickNumber(live.sessionEpoch, 0));
  const nextBootstrapHeight = Math.max(0, pickNumber(next.bootstrapHeight, 0));
  const liveBootstrapHeight = Math.max(0, pickNumber(live.bootstrapHeight, 0));
  const resetEpochAdvance = liveSessionEpoch > nextSessionEpoch;
  const resetBootstrapRollback = liveBootstrapHeight > 0
    && nextBootstrapHeight > 0
    && liveBootstrapHeight !== nextBootstrapHeight
    && pickNumber(live.localHeight, 0) <= Math.max(0, liveBootstrapHeight - 1);
  const allowResetReplace = resetEpochAdvance || resetBootstrapRollback;
  if (hasOwn("bootstrapHeight")) next.bootstrapHeight = pickNumber(live.bootstrapHeight, next.bootstrapHeight);
  if (hasOwn("sessionEpoch")) next.sessionEpoch = allowResetReplace
    ? liveSessionEpoch
    : Math.max(nextSessionEpoch, liveSessionEpoch);
  if (hasOwn("localHeight")) next.localHeight = allowResetReplace
    ? Math.max(0, pickNumber(live.localHeight, next.localHeight))
    : Math.max(pickNumber(next.localHeight, 0), pickNumber(live.localHeight, next.localHeight));
  if (hasOwn("fixedSyncLastHeight")) next.fixedSyncLastHeight = allowResetReplace
    ? Math.max(0, pickNumber(live.fixedSyncLastHeight, next.fixedSyncLastHeight))
    : Math.max(pickNumber(next.fixedSyncLastHeight, 0), pickNumber(live.fixedSyncLastHeight, next.fixedSyncLastHeight));
  if (hasOwn("independentLocalHeight")) next.independentLocalHeight = allowResetReplace
    ? Math.max(0, pickNumber(live.independentLocalHeight, next.independentLocalHeight))
    : Math.max(pickNumber(next.independentLocalHeight, 0), pickNumber(live.independentLocalHeight, next.independentLocalHeight));
  if (hasOwn("receiptCommittedHeight")) next.receiptCommittedHeight = allowResetReplace
    ? Math.max(0, pickNumber(live.receiptCommittedHeight, next.receiptCommittedHeight))
    : Math.max(pickNumber(next.receiptCommittedHeight, 0), pickNumber(live.receiptCommittedHeight, next.receiptCommittedHeight));
  const nextBhsTipHeight = Math.max(
    pickNumber(next?.bhs?.tipHeight, 0),
    pickNumber(live?.bhs?.tipHeight, 0),
  );
  next.highestBlock = Math.max(
    0,
    pickNumber(next.highestBlock, 0),
    pickNumber(next.networkHeight, 0),
    pickNumber(live.highestBlock, 0),
    pickNumber(live.networkHeight, 0),
    nextBhsTipHeight,
  );
  next.lag = Math.max(0, next.highestBlock - next.localHeight);
  next.p2pHeaderCursorHeight = Math.max(
    pickNumber(next.p2pHeaderCursorHeight, 0),
    pickNumber(live.p2pHeaderCursorHeight, next.p2pHeaderCursorHeight),
  );
  next.p2pTipHeight = Math.max(
    pickNumber(next.p2pTipHeight, 0),
    pickNumber(live.p2pTipHeight, next.p2pTipHeight),
  );
  if (hasOwn("connectedNodes")) next.connectedNodes = pickNumber(live.connectedNodes, next.connectedNodes);
  if (hasOwn("activeSyncNodes")) next.activeSyncNodes = pickNumber(live.activeSyncNodes, next.activeSyncNodes);
  if (hasOwn("independentPhase")) next.independentPhase = String(live.independentPhase || next.independentPhase || "");
  if (hasOwn("independentTargetHeight")) next.independentTargetHeight = allowResetReplace
    ? Math.max(0, pickNumber(live.independentTargetHeight, next.independentTargetHeight))
    : Math.max(pickNumber(next.independentTargetHeight, 0), pickNumber(live.independentTargetHeight, next.independentTargetHeight));
  if (hasOwn("onlineNodeList") && Array.isArray(live.onlineNodeList)) next.onlineNodeList = live.onlineNodeList.slice();
  if (hasOwn("candidateNodeList") && Array.isArray(live.candidateNodeList)) next.candidateNodeList = live.candidateNodeList.slice();
  if (hasOwn("activeSyncNodeList") && Array.isArray(live.activeSyncNodeList)) next.activeSyncNodeList = live.activeSyncNodeList.slice();
  if (hasOwn("syncWorkerNodes")) next.syncWorkerNodes = pickNumber(live.syncWorkerNodes, next.syncWorkerNodes);
  if (hasOwn("syncWorkerNodeList") && Array.isArray(live.syncWorkerNodeList)) next.syncWorkerNodeList = live.syncWorkerNodeList.slice();
  if (hasOwn("candidateNodes")) next.candidateNodes = pickNumber(live.candidateNodes, next.candidateNodes);
  if (hasOwn("walletListenerNodes")) next.walletListenerNodes = pickNumber(live.walletListenerNodes, next.walletListenerNodes);
  if (hasOwn("walletListenerNodeList") && Array.isArray(live.walletListenerNodeList)) next.walletListenerNodeList = live.walletListenerNodeList.slice();
  if (typeof live.mode === "string" && live.mode) next.mode = live.mode;
  if (typeof live.online === "boolean") next.online = live.online;
  if (live.bhs && typeof live.bhs === "object") {
    next.bhs = {
      ...(next.bhs && typeof next.bhs === "object" ? next.bhs : {}),
      ...live.bhs,
      tipHeight: nextBhsTipHeight,
    };
  } else if (nextBhsTipHeight > 0) {
    next.bhs = {
      ...(next.bhs && typeof next.bhs === "object" ? next.bhs : {}),
      tipHeight: nextBhsTipHeight,
    };
  }
  return next;
}

function mergeServerSyncState(currentSync, incomingSync) {
  const base = currentSync && typeof currentSync === "object" ? { ...currentSync } : {};
  const incoming = incomingSync && typeof incomingSync === "object" ? { ...incomingSync } : null;
  if (!incoming) return base;
  const merged = {
    ...base,
    ...incoming,
  };
  mergeLiveSyncSnapshot(merged, base);
  mergeLiveSyncSnapshot(merged, incoming);
  if (Object.prototype.hasOwnProperty.call(incoming, "pendingDetails")) {
    merged.pendingDetails = Array.isArray(incoming.pendingDetails) ? incoming.pendingDetails.slice() : [];
    if (!merged.pendingDetails.length) merged.pendingUploads = 0;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "pendingUploads")) {
    const count = Number(incoming.pendingUploads || 0);
    merged.pendingUploads = Number.isFinite(count) ? Math.max(0, count) : 0;
    if (merged.pendingUploads <= 0 && !Object.prototype.hasOwnProperty.call(incoming, "pendingDetails")) {
      merged.pendingDetails = [];
    }
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "recoverableDetails")) {
    merged.recoverableDetails = Array.isArray(incoming.recoverableDetails) ? incoming.recoverableDetails.slice() : [];
  }
  if ((!Array.isArray(merged.nodePool) || !merged.nodePool.length) && Array.isArray(base.nodePool) && base.nodePool.length) {
    merged.nodePool = base.nodePool.slice();
  }
  return merged;
}

function syncSnapshotSessionEpoch(syncLike = null) {
  if (!syncLike || typeof syncLike !== "object") return 0;
  return Math.max(0, Number(syncLike.sessionEpoch || 0));
}

function shouldIgnoreIncomingSyncSnapshot(syncLike = null) {
  if (!syncLike || typeof syncLike !== "object") return false;
  const incomingEpoch = Math.max(0, Number(syncLike.sessionEpoch || 0));
  const floorEpoch = Math.max(
    0,
    Number(state.ui?.minSyncSessionEpoch || 0),
    Number(state.ui?.resyncFlow?.active ? (state.ui?.resyncFlow?.resetEpoch || 0) : 0),
    Number(state.ui?.syncResetDisplay?.epoch || 0),
  );
  if (incomingEpoch > 0 && floorEpoch > 0 && incomingEpoch < floorEpoch) {
    return true;
  }
  const holdUntilMs = Math.max(0, Number(state.ui?.syncResetDisplay?.holdUntilMs || 0));
  const bootstrapHeight = Math.max(
    0,
    Number(state.ui?.syncResetDisplay?.bootstrapHeight || state.ui?.resyncFlow?.bootstrapHeight || 0),
  );
  if (holdUntilMs > Date.now() && bootstrapHeight > 0) {
    const incomingLocalHeight = Math.max(
      0,
      Number(syncLike.localHeight || 0),
      Number(syncLike.fixedSyncLastHeight || 0),
      Number(syncLike.receiptCommittedHeight || 0),
    );
    if (incomingLocalHeight > Math.max(0, bootstrapHeight - 1) && (incomingEpoch <= 0 || incomingEpoch <= floorEpoch)) {
      return true;
    }
  }
  return false;
}

function currentCommittedSyncHeight(syncLike = null) {
  const row = syncLike && typeof syncLike === "object" ? syncLike : state.sync;
  return Math.max(
    0,
    Number(row?.localHeight || 0),
    Number(row?.fixedSyncLastHeight || 0),
    Number(row?.receiptCommittedHeight || 0),
  );
}

function shouldForceSyncResetDisplay(syncLike = null) {
  const display = state.ui?.syncResetDisplay || {};
  const holdUntilMs = Math.max(0, Number(display.holdUntilMs || 0));
  const bootstrapHeight = Math.max(0, Number(display.bootstrapHeight || 0));
  if (bootstrapHeight <= 0) return false;
  const flow = state.ui?.resyncFlow || {};
  if (holdUntilMs > Date.now()) return true;
  if (flow.active === true && flow.resetCompleted === true && flow.baselineObserved !== true) {
    const syncEpoch = Math.max(0, Number(syncLike?.sessionEpoch || state.sync?.sessionEpoch || 0));
    const wantedEpoch = Math.max(0, Number(flow.resetEpoch || 0));
    return wantedEpoch <= 0 || syncEpoch <= wantedEpoch;
  }
  return false;
}

function maybeClearSyncResetDisplay(syncLike = null) {
  const display = state.ui?.syncResetDisplay || {};
  if (!Number(display.bootstrapHeight || 0) && !Number(display.holdUntilMs || 0)) return;
  const flow = state.ui?.resyncFlow || {};
  const sync = syncLike && typeof syncLike === "object" ? syncLike : state.sync;
  const bootstrapHeight = Math.max(0, Number(display.bootstrapHeight || flow.bootstrapHeight || sync?.bootstrapHeight || 0));
  const sessionEpoch = Math.max(0, Number(sync?.sessionEpoch || 0));
  const committedLocalHeight = Math.max(
    0,
    Number(sync?.localHeight || 0),
    Number(sync?.fixedSyncLastHeight || 0),
    Number(sync?.receiptCommittedHeight || 0),
  );
  if (flow.active === true) {
    const wantedEpoch = Math.max(0, Number(flow.resetEpoch || 0));
    if (wantedEpoch > 0 && sessionEpoch >= wantedEpoch && committedLocalHeight <= Math.max(0, bootstrapHeight - 1)) {
      flow.resetAcknowledged = true;
      flow.baselineObserved = true;
    }
  }
  const clearDisplay = flow.active !== true
    && (Date.now() >= Math.max(0, Number(display.holdUntilMs || 0))
      || committedLocalHeight > Math.max(0, bootstrapHeight - 1));
  if (clearDisplay) {
    state.ui.syncResetDisplay = {
      epoch: 0,
      bootstrapHeight: 0,
      holdUntilMs: 0,
    };
  }
}

function nextResyncFlowNonce() {
  const next = Math.max(0, Number(state.ui?.resyncFlow?.nonce || 0)) + 1;
  state.ui.resyncFlow.nonce = next;
  return next;
}

function isActiveResyncFlowNonce(nonce) {
  return Boolean(state.ui?.resyncFlow?.active) && Number(state.ui?.resyncFlow?.nonce || 0) === Number(nonce || 0);
}

function statusMatchesResyncFlow(flow, syncStatus) {
  const wantedEpoch = Math.max(0, Number(flow?.resetEpoch || 0));
  const wantedCommandId = String(flow?.commandId || "").trim();
  const envelope = normalizeResyncStatusEnvelope(syncStatus);
  const sync = envelope.sync && typeof envelope.sync === "object" ? envelope.sync : {};
  const statusEpoch = Math.max(
    0,
    Number(envelope.sync?.sessionEpoch || 0),
    Number(envelope.runtime?.sessionEpoch || 0),
  );
  const currentJob = envelope.jobState?.currentJob || null;
  const lastCommand = envelope.commandQueue?.lastCommand || null;
  const statusCommandId = String(
    currentJob?.jobId || currentJob?.id || lastCommand?.id || ""
  ).trim();
  const bootstrapHeight = Math.max(0, Number(flow?.bootstrapHeight || sync?.bootstrapHeight || state.sync?.bootstrapHeight || 0));
  const committedLocalHeight = Math.max(
    0,
    Number(sync?.localHeight || 0),
    Number(sync?.fixedSyncLastHeight || 0),
  );
  const independentPhase = String(sync?.independentPhase || "");
  const paused = sync?.paused === true;
  const activeSyncNodes = Math.max(
    0,
    Number(sync?.activeSyncNodes || 0),
    Number(sync?.connectedNodes || 0),
  );
  const hasImplicitSyncProgress = bootstrapHeight > 0 && (
    committedLocalHeight >= bootstrapHeight
    || ((!paused && !["idle", "failed", ""].includes(independentPhase)) && activeSyncNodes > 0)
    || independentPhase === "round_running"
    || independentPhase === "round_committing"
    || independentPhase === "running"
  );
  if (!wantedEpoch && !wantedCommandId) return hasImplicitSyncProgress;
  if (wantedEpoch > 0 && statusEpoch > 0) return statusEpoch === wantedEpoch;
  if (wantedCommandId && statusCommandId) return statusCommandId === wantedCommandId;
  if (currentJob && String(currentJob?.jobType || "") === "run_chain_sync") {
    return String(currentJob?.status || "") === "running" || hasImplicitSyncProgress;
  }
  if (lastCommand && String(lastCommand?.commandType || lastCommand?.jobType || "") === "run_chain_sync") {
    return ["claimed", "running"].includes(String(lastCommand?.status || "")) || hasImplicitSyncProgress;
  }
  if (hasImplicitSyncProgress) return true;
  if (wantedEpoch > 0 && !statusEpoch) return false;
  if (wantedCommandId && !statusCommandId) return false;
  return false;
}

function buildResyncFlowState(syncStatus = null) {
  const flow = state.ui.resyncFlow || {};
  const envelope = normalizeResyncStatusEnvelope(syncStatus);
  const rawSync = envelope.sync || state.sync || {};
  const bootstrapBase = Math.max(0, Number(flow.bootstrapHeight || rawSync.bootstrapHeight || state.sync.bootstrapHeight || 0));
  const rawIndependentPhase = String(rawSync.independentPhase || "");
  const rawCommittedLocalHeight = Math.max(
    0,
    Number(rawSync.localHeight || 0),
    Number(rawSync.fixedSyncLastHeight || 0),
  );
  const rawActiveNodeCount = Math.max(
    0,
    Number(rawSync.activeSyncNodes || 0),
    Number(rawSync.connectedNodes || 0)
  );
  const hasImplicitSyncProgress = bootstrapBase > 0 && (
    rawCommittedLocalHeight >= bootstrapBase
    || rawActiveNodeCount > 0
    || rawIndependentPhase === "round_running"
    || rawIndependentPhase === "round_committing"
    || rawIndependentPhase === "running"
  );
  const hasMatchedStatus = syncStatus ? statusMatchesResyncFlow(flow, syncStatus) : hasImplicitSyncProgress;
  const treatAsMatched = hasMatchedStatus || hasImplicitSyncProgress;
  const sync = rawSync;
  const lagPolicy = envelope.runtime?.lagPolicy || state.runtime?.lagPolicy || null;
  const currentJob = envelope.jobState?.currentJob || null;
  const lastCommand = envelope.commandQueue?.lastCommand || null;
  const lastCommandStatus = String(lastCommand?.status || "");
  const lastCommandIsActive = ["queued", "claimed", "running"].includes(lastCommandStatus);
  const fallbackCommand = currentJob || (lastCommandIsActive ? lastCommand : null);
  const synthesizedJob = treatAsMatched
    ? {
      jobType: String(currentJob?.jobType || (lastCommandIsActive ? lastCommand?.commandType : "") || flow.commandType || ""),
      status: String(currentJob?.status || (lastCommandIsActive ? lastCommand?.status : "") || ""),
      stage: String(envelope.jobState?.currentJob?.stage || rawSync.independentPhase || "p2p_service_window"),
    }
    : null;
  const job = treatAsMatched
    ? (
      fallbackCommand
      || synthesizedJob
      || null
    )
    : null;
  const pendingCount = treatAsMatched ? Number(envelope.commandQueue?.pendingCount || 0) : 0;
  const claimedCount = treatAsMatched ? Number(envelope.commandQueue?.claimedCount || 0) : 0;
  const syncWorkerNodes = Math.max(
    0,
    Number(
      sync.activeSyncNodes
      || sync.connectedNodes
      || 0
    ),
  );
  const nodeReadyCount = syncWorkerNodes;
  const localHeight = Math.max(0, Number(sync.localHeight || 0));
  const highestBlock = Math.max(0, Number(sync.highestBlock || sync.networkHeight || sync?.bhs?.tipHeight || 0));
  const lag = Math.max(0, Number(sync.lag ?? (highestBlock - localHeight)));
  const committedLocalHeight = Math.max(localHeight, Number(sync.fixedSyncLastHeight || 0));
  const independentLocalHeight = Math.max(0, Number(sync.independentLocalHeight || 0));
  const bestLocalHeight = Math.max(committedLocalHeight, independentLocalHeight);
  const independentPhase = String(sync.independentPhase || "");
  const hasCommittedSyncProgress = committedLocalHeight >= bootstrapBase;
  const hasLiveSyncActivity = independentPhase === "round_running"
    || independentPhase === "round_committing"
    || independentPhase === "running";
  const progressMeta = progressMetaFromSnapshot(sync, bootstrapBase);
  const recoveredHeight = Math.max(0, Number(progressMeta.recoveredHeight || 0));
  const peakPercent = Math.max(
    0,
    Number(flow.peakPercent || 0),
    Number(progressMeta.percent || 0),
  );
  flow.peakPercent = peakPercent;
  const resetCompleted = flow.resetCompleted === true;
  const startDisabled = flow.startDisabled === true;
  const steps = baseResyncSteps({ bootstrapHeight: flow.bootstrapHeight }).map((step) => ({ ...step, status: "pending", tone: "" }));
  const startTs = flow.startedAt ? new Date(flow.startedAt).getTime() : 0;
  const elapsedMs = startTs > 0 ? Math.max(0, Date.now() - startTs) : 0;
  const elapsedText = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`;

  steps[0].status = "done";
  steps[0].tone = "done";
  if (flow.commandId) steps[0].detail = trf("resync_request_submitted", { commandId: flow.commandId }, `Request submitted, command ${flow.commandId}`);
  steps[1].status = resetCompleted ? "done" : "active";
  steps[1].tone = resetCompleted ? "done" : "active";
  if (resetCompleted) {
    steps[1].detail = trf("resync_reset_submitted", { epoch: Number(flow.resetEpoch || 0) || "-" }, `Reset submitted, epoch ${Number(flow.resetEpoch || 0) || "-"}`);
  }

  if (!resetCompleted) {
    const currentStep = steps[1];
    return {
      steps,
      finished: false,
      localHeight: Math.max(0, Number(rawSync.localHeight || 0)),
      highestBlock: Math.max(0, Number(rawSync.highestBlock || rawSync.networkHeight || rawSync?.bhs?.tipHeight || 0)),
      lag: Math.max(0, Number(rawSync.lag ?? 0)),
      percent: 0,
      elapsedText,
      currentLabel: currentStep?.label || tr("resync_progress_title", "Processing in background"),
      summary: currentStep?.detail || tr("resync_progress_summary", "Waiting for task startup..."),
    };
  }

  const activeJobType = String(job?.jobType || "");
  const activeStage = String(job?.stage || "");
  const activeStatus = String(job?.status || "");
  const isSyncJob = activeJobType === "run_chain_sync";
  const inPrepareStage = activeStage === "prepare_saved";
  const inNodeProbeStage = activeStage === "p2p_header_sync"
    || activeStage === "p2p_forward_probe"
    || activeStage === "p2p_task_queue_ready"
    || activeStage === "p2p_block_workers_done";
  const inWarmupStage = activeStage === "p2p_service_window";
  const hasQueuedWork = pendingCount > 0 || claimedCount > 0 || activeStatus === "running";
  const hasNodeActivity = isSyncJob && (activeStatus === "running" || hasLiveSyncActivity) && nodeReadyCount > 0;
  if (hasQueuedWork) {
    steps[2].status = activeStatus === "running" ? "done" : "active";
    steps[2].tone = activeStatus === "running" ? "done" : "active";
    steps[2].detail = activeStatus === "running"
      ? trf("resync_current_job", { jobType: activeJobType || "-", stage: activeStage || "-" }, `Current job ${activeJobType || "-"} / stage ${activeStage || "-"}`)
      : trf("resync_queue_pending", { pendingCount }, `${pendingCount} queued commands remaining`);
  }
  if (isSyncJob && (activeStatus === "running" || hasCommittedSyncProgress || hasLiveSyncActivity)) {
    steps[2].status = "done";
    steps[2].tone = "done";
    steps[2].detail = trf("resync_current_job", { jobType: activeJobType || "-", stage: activeStage || "-" }, `Current job ${activeJobType || "-"} / stage ${activeStage || "-"}`);
  }
  if (isSyncJob && (inPrepareStage || inNodeProbeStage || inWarmupStage)) {
    const prepareDone = !inPrepareStage || hasNodeActivity || hasCommittedSyncProgress || hasLiveSyncActivity;
    steps[3].status = prepareDone ? "done" : "active";
    steps[3].tone = prepareDone ? "done" : "active";
    steps[3].detail = !prepareDone
      ? trf("resync_prepare_stage_detail", { stage: activeStage || "prepare_saved" }, `Preparing sync data. Current stage ${activeStage || "prepare_saved"}`)
      : tr("resync_prepare_done_detail", "Trusted headers and saved state are ready.");
  } else if (isSyncJob && (hasCommittedSyncProgress || hasLiveSyncActivity)) {
    steps[3].status = "done";
    steps[3].tone = "done";
    steps[3].detail = tr("resync_prepare_done_detail", "Trusted headers and saved state are ready.");
  }
  if (nodeReadyCount > 0 && (hasNodeActivity || inNodeProbeStage || inWarmupStage || hasCommittedSyncProgress || hasLiveSyncActivity)) {
    steps[4].status = "done";
    steps[4].tone = "done";
    steps[4].detail = trf("resync_nodes_ready", { count: nodeReadyCount }, `${nodeReadyCount} nodes ready; preparing to sync`);
  } else if (isSyncJob && inNodeProbeStage) {
    steps[4].status = "active";
    steps[4].tone = "active";
    steps[4].detail = trf("resync_node_probe_stage_detail", { stage: activeStage || "p2p_header_sync" }, `Probing sync nodes. Current stage ${activeStage || "p2p_header_sync"}`);
  } else {
    steps[4].status = "pending";
    steps[4].tone = "";
  }
  const syncEntered = isSyncJob && (
    hasCommittedSyncProgress
    || hasLiveSyncActivity
    || (activeStatus === "running" && (nodeReadyCount > 0 || inWarmupStage || hasNodeActivity))
  );
  if (isSyncJob && (inWarmupStage || hasLiveSyncActivity || syncEntered)) {
    steps[5].status = "active";
    steps[5].tone = "active";
    const restoredText = recoveredHeight > 0
      ? trf("resync_fast_restored_inline", { height: recoveredHeight }, `Fast restored to ${recoveredHeight}. `)
      : "";
    steps[5].detail = trf(
      "resync_sync_running_detail",
      {
        count: Math.max(1, nodeReadyCount || 1),
        localHeight: committedLocalHeight,
        highestBlock,
        lag,
        stage: activeStage || independentPhase || "running",
        restored: restoredText,
      },
      `${restoredText}${Math.max(1, nodeReadyCount || 1)} nodes syncing. Local ${committedLocalHeight} / highest ${highestBlock} / lag ${lag} / stage ${activeStage || independentPhase || "running"}`,
    );
  } else if (isSyncJob && (inPrepareStage || inNodeProbeStage)) {
    steps[5].status = "active";
    steps[5].tone = "active";
    steps[5].detail = trf("resync_current_stage", { stage: activeStage || "prepare_saved" }, `Current stage ${activeStage || "prepare_saved"}`);
  }
  const readyToClose = !startDisabled && syncEntered;

  const currentStep = steps.find((step) => step.status === "active") || (readyToClose ? steps[6] : steps.find((step) => step.status === "pending") || steps[0]);
  const resetOnlyWaitingSummary = startDisabled && resetCompleted && !hasQueuedWork && !syncEntered
    ? tr("resync_reset_done_only", "Local sync state reset completed. Sync start is disabled.")
    : "";
  return {
    steps,
    finished: readyToClose,
    localHeight,
    highestBlock,
    lag,
    percent: peakPercent,
    recoveredHeight,
    elapsedText,
    currentLabel: readyToClose ? tr("resync_started_label", "Sync started") : (currentStep?.label || tr("resync_progress_title", "Processing in background")),
    summary: readyToClose
      ? trf("resync_started_summary", { count: Math.max(1, nodeReadyCount), elapsedText }, `Sync entered background mode with ${Math.max(1, nodeReadyCount)} nodes in ${elapsedText}`)
      : (resetOnlyWaitingSummary || currentStep?.detail || tr("resync_progress_summary", "Waiting for task startup...")),
  };
}

function renderResyncProgressUi(flowState = null) {
  if (!els.resyncProgressPanel) return;
  const view = flowState || buildResyncFlowState({
    sync: state.sync,
    runtime: state.runtime || {},
    jobState: state.jobState || null,
    commandQueue: state.commandQueue || null,
  });
  els.resyncProgressPanel.classList.remove("hidden");
  if (els.resyncProgressTitle) els.resyncProgressTitle.textContent = view.currentLabel;
  if (els.resyncProgressSummary) els.resyncProgressSummary.textContent = view.summary;
  if (els.resyncProgressBar) els.resyncProgressBar.style.width = `${Math.max(0, Math.min(100, Number(view.percent || 0)))}%`;
  if (els.resyncProgressText) {
    const restoredPrefix = Number(view.recoveredHeight || 0) > 0
      ? trf("resync_fast_restored_prefix", { height: Number(view.recoveredHeight || 0) }, `Restored to ${Number(view.recoveredHeight || 0)} · `)
      : "";
    els.resyncProgressText.textContent = restoredPrefix + (view.finished
      ? trf("resync_started_percent", { percent: Number(view.percent || 0).toFixed(2) }, `Started ${Number(view.percent || 0).toFixed(2)}%`)
      : trf("resync_sync_percent", { percent: Number(view.percent || 0).toFixed(2) }, `Sync ${Number(view.percent || 0).toFixed(2)}%`));
  }
  if (els.resyncElapsed) els.resyncElapsed.textContent = trf("resync_elapsed", { elapsed: String(view.elapsedText || "0s") }, `Elapsed ${String(view.elapsedText || "0s")}`);
  if (els.resyncStepList) {
    els.resyncStepList.innerHTML = view.steps.map((step) => {
      const statusLabel = step.status === "done"
        ? tr("status_done", "Done")
        : (step.status === "active" ? tr("status_active", "In progress") : (step.status === "error" ? tr("status_error", "Failed") : tr("status_pending", "Pending")));
      const statusIcon = step.status === "done"
        ? "✓"
        : (step.status === "active" ? "…" : (step.status === "error" ? "!" : "○"));
      const cls = ["resync-step"];
      if (step.tone) cls.push(step.tone);
      return `<div class="${cls.join(" ")}"><div class="resync-step-head"><div class="resync-step-title"><span class="resync-step-icon">${escapeHtml(statusIcon)}</span><strong>${escapeHtml(step.label)}</strong></div><span class="resync-step-status">${escapeHtml(statusLabel)}</span></div><p class="resync-step-detail">${escapeHtml(step.detail || "")}</p></div>`;
    }).join("");
  }
}

function finalizeResyncFlowView(view, flowNonce) {
  if (!view?.finished) return false;
  if (!isActiveResyncFlowNonce(flowNonce)) return false;
  const flow = state.ui.resyncFlow || {};
  flow.active = false;
  flow.completedAt = new Date().toISOString();
  clearResyncFlowPoller();
  if (els.btnCloseResync) els.btnCloseResync.disabled = false;
  if (els.btnConfirmResync) els.btnConfirmResync.disabled = false;
  if (els.resyncProgressSummary) {
    els.resyncProgressSummary.textContent = trf("resync_auto_close", { summary: view.summary }, `${view.summary}. Closing soon.`);
  }
  setTimeout(() => {
    if (!Number.isFinite(flowNonce) || Number(state.ui?.resyncFlow?.nonce || 0) !== flowNonce) return;
    if (els.resyncModal) els.resyncModal.classList.add("hidden");
    resetResyncProgressUi();
    renderAll();
  }, 1600);
  return true;
}

function releaseResyncFlowView(view, flowNonce) {
  if (!isActiveResyncFlowNonce(flowNonce)) return false;
  const flow = state.ui.resyncFlow || {};
  flow.active = false;
  flow.completedAt = new Date().toISOString();
  clearResyncFlowPoller();
  if (els.btnCloseResync) els.btnCloseResync.disabled = false;
  if (els.btnConfirmResync) els.btnConfirmResync.disabled = false;
  if (els.resyncProgressSummary && view?.summary) {
    els.resyncProgressSummary.textContent = view.summary;
  }
  return true;
}

function startResyncProgressFlow(meta = {}) {
  clearResyncFlowPoller();
  const nonce = Object.prototype.hasOwnProperty.call(meta || {}, "nonce")
    ? Number(meta.nonce || 0)
    : nextResyncFlowNonce();
  state.ui.resyncFlow.active = true;
  state.ui.resyncFlow.bootstrapHeight = Math.max(0, Number(meta.bootstrapHeight || state.sync.bootstrapHeight || 0));
  state.ui.resyncFlow.commandId = String(meta.commandId || "");
  state.ui.resyncFlow.commandType = String(meta.commandType || "");
  state.ui.resyncFlow.resetEpoch = Number(meta.resetEpoch || 0);
  state.ui.resyncFlow.resetCompleted = meta.resetCompleted === true;
  state.ui.resyncFlow.startDisabled = meta.startDisabled === true;
  state.ui.resyncFlow.resetAcknowledged = false;
  state.ui.resyncFlow.baselineObserved = false;
  state.ui.resyncFlow.nonce = Math.max(0, nonce);
  state.ui.resyncFlow.startedAt = new Date().toISOString();
  state.ui.resyncFlow.completedAt = "";
  state.ui.resyncFlow.peakPercent = 0;
  state.ui.resyncFlow.error = "";
  state.ui.syncResetDisplay = {
    epoch: Math.max(0, Number(meta.resetEpoch || 0)),
    bootstrapHeight: state.ui.resyncFlow.bootstrapHeight,
    holdUntilMs: Date.now() + 6000,
  };
  if (els.resyncConfirmPanel) els.resyncConfirmPanel.classList.add("hidden");
  if (els.resyncProgressPanel) els.resyncProgressPanel.classList.remove("hidden");
  if (els.btnCloseResync) els.btnCloseResync.disabled = false;
  if (els.btnConfirmResync) els.btnConfirmResync.disabled = true;
  renderResyncProgressUi(buildResyncFlowState({
    sync: state.sync,
    runtime: state.runtime || {},
    jobState: state.jobState || null,
    commandQueue: state.commandQueue || null,
  }));
}

function completeResyncToolFlow(meta = {}) {
  const flowNonce = Number(meta?.nonce || state.ui?.resyncFlow?.nonce || 0);
  if (!isActiveResyncFlowNonce(flowNonce)) return false;
  const autoClose = meta?.autoClose === true;
  const bootstrapHeight = Math.max(0, Number(meta?.bootstrapHeight || state.ui?.resyncFlow?.bootstrapHeight || state.sync.bootstrapHeight || 0));
  const interruptedExistingSync = meta?.interruptedExistingSync === true;
  const interruptedCount = Math.max(0, Number(meta?.interruptedCount || 0));
  const drainWaitMs = Math.max(0, Number(meta?.drainWaitMs || 0));
  const queuedCommandId = String(meta?.commandId || state.ui?.resyncFlow?.commandId || "");
  const summary = interruptedExistingSync
    ? trf(
      "resync_restart_completed_summary",
      {
        height: bootstrapHeight,
        count: interruptedCount,
        waitSec: (drainWaitMs / 1000).toFixed(1),
      },
      `Stopped ${Math.max(1, interruptedCount)} active sync command(s), reset local data, and queued a fresh sync from block ${bootstrapHeight} in ${(drainWaitMs / 1000).toFixed(1)}s.`,
    )
    : trf(
      "resync_restart_started_summary",
      { height: bootstrapHeight },
      `Local data reset completed and a fresh sync was queued from block ${bootstrapHeight}.`,
    );
  const view = {
    steps: baseResyncSteps({ bootstrapHeight }).map((step, index) => ({
      ...step,
      status: "done",
      tone: "done",
      detail: index === 2 && queuedCommandId
        ? trf("resync_queue_complete_detail", { commandId: queuedCommandId }, `Queued ${queuedCommandId}`)
        : step.detail,
    })),
    finished: autoClose,
    percent: 0,
    elapsedText: "0s",
    currentLabel: tr("resync_tool_complete_label", "Resync restarted"),
    summary,
  };
  renderResyncProgressUi(view);
  if (autoClose) {
    finalizeResyncFlowView(view, flowNonce);
  } else {
    releaseResyncFlowView(view, flowNonce);
  }
  return true;
}

function pushNotice(msg, level = "info") {
  if (!els.noticeStack) return;
  const n = document.createElement("div");
  n.className = `notice${level === "warn" ? " warn" : ""}`;
  n.textContent = String(msg || "");
  els.noticeStack.prepend(n);
  setTimeout(() => n.remove(), 4500);
}

function renderDebugStatus() {
  if (!els.debugStatusBar) return;
  const pendingUploads = Number(state.sync.pendingUploads || 0);
  const pendingDetails = Array.isArray(state.sync.pendingDetails) ? state.sync.pendingDetails.length : 0;
  const at = state.debug.at ? new Date(state.debug.at).toLocaleTimeString() : "-";
  const err = state.debug.lastError ? trf("debug_status_error", { error: String(state.debug.lastError) }, ` | Error: ${String(state.debug.lastError)}`) : "";
  els.debugStatusBar.innerHTML = escapeHtml(trf("debug_status_line", {
    pendingUploads,
    pendingDetails,
    categories: state.categories.length,
    products: state.products.length,
    lastApi: String(state.debug.lastApi || "-"),
    at: String(at),
    err,
  }, `Core status | Pending publish: ${pendingUploads} | Details: ${pendingDetails} | Categories: ${state.categories.length} | Products: ${state.products.length} | Last API: ${String(state.debug.lastApi || "-")} @ ${String(at)}${err}`));
}

function setButtonsBusy(busy) {
  const buttons = Array.from(document.querySelectorAll("button"));
  buttons.forEach((btn) => {
    if (btn.dataset.noBusy === "1") return;
    if (busy) {
      if (btn.dataset.busyManaged === "1") return;
      btn.dataset.busyManaged = "1";
      btn.dataset.prevDisabled = btn.disabled ? "1" : "0";
      btn.disabled = true;
      return;
    }
    if (btn.dataset.busyManaged !== "1") return;
    btn.disabled = btn.dataset.prevDisabled === "1";
    delete btn.dataset.busyManaged;
    delete btn.dataset.prevDisabled;
  });
}

function pushWalletLog(title, payload) {
  if (!els.walletTestLog) return;
  const row = document.createElement("div");
  row.className = "row";
  const titleText = escapeHtml(title);
  const payloadText = escapeHtml(typeof payload === "string" ? payload : JSON.stringify(payload));
  row.innerHTML = `<p><strong>${titleText}</strong></p><p class="mono">${payloadText}</p>`;
  els.walletTestLog.prepend(row);
}

function normalizeWalletSendPreflightStatus(statusOrOk) {
  if (statusOrOk === true) return "ready_confirmed_only";
  if (statusOrOk === false) return "blocked_need_sync";
  const status = String(statusOrOk || "").trim();
  if (
    status === "ready_confirmed_only"
    || status === "ready_with_unconfirmed_chain"
    || status === "blocked_need_sync"
    || status === "blocked_need_beef_context"
  ) {
    return status;
  }
  return "blocked_need_sync";
}

function walletSendPreflightIsReady(status) {
  return status === "ready_confirmed_only" || status === "ready_with_unconfirmed_chain";
}

function applyWalletStatePreflight(walletState, options = {}) {
  const ws = walletState && typeof walletState === "object" ? walletState : {};
  const status = String(ws.sendPreflightStatus || "").trim();
  const checkedAt = String(ws.lastIndexedAt || new Date().toISOString());
  if (status === "ready") {
    setWalletSendPreflight("ready_confirmed_only", options.readyReason || tr("wallet_index_ready", "Wallet index is ready and send precheck passed"), checkedAt);
    return { ready: true, status: "ready" };
  }
  if (status === "waiting_beef") {
    setWalletSendPreflight("blocked_need_beef_context", options.waitingBeefReason || tr("wallet_beef_waiting", "UTXO is ready but strict BEEF is still incomplete"), checkedAt);
    return { ready: false, status: "waiting_beef" };
  }
  if (status === "waiting_context") {
    setWalletSendPreflight("blocked_need_sync", options.waitingContextReason || tr("wallet_waiting_context", "UTXO found, but context transactions are still incomplete"), checkedAt);
    return { ready: false, status: "waiting_context" };
  }
  if (status === "no_utxo") {
    setWalletSendPreflight("blocked_need_sync", options.noUtxoReason || tr("wallet_no_utxo_yet", "Chain sync has not found any spendable UTXO yet"), checkedAt);
    return { ready: false, status: "no_utxo" };
  }
  setWalletSendPreflight("blocked_need_sync", options.fallbackReason || tr("wallet_sync_before_precheck", "Finish chain sync before running send precheck"), checkedAt);
  return { ready: false, status: status || "unknown" };
}

async function refreshWalletSendPreflightFromServer(options = {}) {
  const statusRes = await api("/api/wallet/status", { silent: Boolean(options.silent) });
  const walletState = statusRes?.walletState || {};
  return applyWalletStatePreflight(walletState, options);
}

function walletSendPreflightWalletKey() {
  const address = String(state.walletReceiveAddress || "").trim();
  const network = String(state.wallet?.network || "").trim();
  const chain = String(state.wallet?.chain || "").trim();
  if (!address) return "";
  return [network || "unknown-network", chain || "unknown-chain", address].join("|");
}

function persistWalletSendPreflight() {
  try {
    const walletKey = walletSendPreflightWalletKey();
    if (!walletKey) return;
    localStorage.setItem(WALLET_SEND_PREFLIGHT_STORAGE_KEY, JSON.stringify({
      walletKey,
      status: String(state.ui.walletSendPreflightStatus || "blocked_need_sync"),
      reason: String(state.ui.walletSendPreflightReason || ""),
      checkedAt: String(state.ui.walletSendPreflightAt || ""),
      localHeight: Number(state.sync.localHeight || 0),
      highestBlock: Number(state.sync.highestBlock || state.sync.networkHeight || state.sync?.bhs?.tipHeight || 0),
      lag: Number(state.sync.lag || 0),
      online: state.sync.online === false ? false : true,
    }));
  } catch (_) {}
}

function restoreWalletSendPreflight() {
  try {
    if (!state.wallet.loggedIn) return false;
    const walletKey = walletSendPreflightWalletKey();
    if (!walletKey) return false;
    const raw = localStorage.getItem(WALLET_SEND_PREFLIGHT_STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || String(saved.walletKey || "") !== walletKey) return false;
    if (Number(saved.localHeight || 0) !== Number(state.sync.localHeight || 0)) return false;
    if (Number(saved.highestBlock || 0) !== Number(state.sync.highestBlock || state.sync.networkHeight || state.sync?.bhs?.tipHeight || 0)) return false;
    if (Number(saved.lag || 0) !== Number(state.sync.lag || 0)) return false;
    if (Boolean(saved.online !== false) !== Boolean(state.sync.online !== false)) return false;
    setWalletSendPreflight(saved.status, saved.reason, saved.checkedAt, { persist: false });
    return true;
  } catch (_) {
    return false;
  }
}

function evaluateWalletSendPreflight(options = {}) {
  const statusHint = String(options.statusHint || "").trim();
  const syncLocalHeight = Number(
    options.walletLocalHeight
    ?? options.localHeight
    ?? state.sync.localHeight
    ?? 0,
  );
  const syncNetworkHeight = Number(
    options.walletNetworkHeight
    ?? options.highestBlock
    ?? state.sync.highestBlock
    ?? state.sync?.bhs?.tipHeight
    ?? syncLocalHeight,
  );
  if (options.requireBeefComplete && options.beefComplete !== true) {
    return {
      status: "blocked_need_beef_context",
      reason: options.blockedReason || tr("wallet_previous_beef_incomplete", "Previous send exists, but the new unconfirmed chain BEEF context is incomplete. Sync or wait for confirmation first."),
    };
  }
  if (statusHint === "ready_with_unconfirmed_chain" || options.allowUnconfirmedChain === true) {
    return {
      status: "ready_with_unconfirmed_chain",
      reason: options.readyReason || tr("wallet_previous_pending_ready", "Previous send is stored locally and its unconfirmed chain context is complete. You can continue sending"),
    };
  }
  return {
    status: "ready_confirmed_only",
    reason: options.readyReason || trf("wallet_index_ready_with_heights", { localHeight: syncLocalHeight, networkHeight: syncNetworkHeight }, `Wallet index ready, send precheck passed (Local ${syncLocalHeight} / Highest ${syncNetworkHeight})`),
  };
}

function setWalletSendPreflight(statusOrOk, reason, checkedAt = new Date().toISOString(), options = {}) {
  const status = normalizeWalletSendPreflightStatus(statusOrOk);
  state.ui.walletSendPreflightStatus = status;
  state.ui.walletSendPreflightOk = walletSendPreflightIsReady(status);
  state.ui.walletSendPreflightReason = String(reason || "").trim();
  state.ui.walletSendPreflightAt = checkedAt || "";
  if (options.persist !== false) persistWalletSendPreflight();
  try {
    renderHeader();
  } catch (_) {}
}

function walletSendGateStatus() {
  if (!state.wallet.exists) return { ready: false, reason: tr("wallet_not_created", "Wallet not created") };
  if (!state.wallet.loggedIn) return { ready: false, reason: tr("wallet_login_required", "Please sign in to the wallet first") };
  const runtimePolicy = state.runtime?.wallet?.policy || {};
  if (runtimePolicy.sendEnabled === false) {
    return {
      ready: false,
      reason: String(runtimePolicy.reason || "").trim() || tr("wallet_need_sync_before_send", "Please finish chain sync and refresh wallet state if needed before sending"),
    };
  }
  if (state.ui.walletSyncInFlight) return { ready: false, reason: tr("wallet_refresh_in_progress", "Wallet refresh and send precheck in progress") };
  const status = normalizeWalletSendPreflightStatus(state.ui.walletSendPreflightStatus);
  if (!walletSendPreflightIsReady(status)) {
    const hasNoSpendableBalance = Number(state.wallet.totalSat || 0) <= 0
      || /no spendable utxo|no_utxo|utxo/i.test(String(state.ui.walletSendPreflightStatus || state.ui.walletSendPreflightReason || ""));
    if (hasNoSpendableBalance) {
      return {
        ready: false,
        status: "no_utxo",
        reason: tr("wallet_balance_insufficient", "余额不足"),
      };
    }
    return { ready: false, status, reason: state.ui.walletSendPreflightReason || tr("wallet_need_sync_before_send", "Please finish chain sync and refresh wallet state if needed before sending") };
  }
  return {
    ready: true,
    status,
    reason: state.ui.walletSendPreflightReason || tr("wallet_precheck_passed", "Local wallet index and send precheck passed"),
    checkedAt: state.ui.walletSendPreflightAt || "",
  };
}

function walletAvailabilityGateStatus() {
  const lagPolicy = state.runtime?.lagPolicy || {};
  const walletRuntime = state.runtime?.wallet || {};
  const walletPolicy = walletRuntime?.policy || {};
  const listenerEnabled = walletPolicy.listenerEnabled !== false;
  const sendEnabled = walletPolicy.sendEnabled !== false;
  const connectedCount = Number(walletRuntime.peerCount || 0);
  const mode = String(lagPolicy.mode || "").trim();
  const lag = Math.max(0, Number(state.sync?.lag || lagPolicy.lag || 0));
  if (!state.wallet.exists) {
    return {
      label: tr("wallet_not_created", "Wallet not created"),
      tip: tr("wallet_not_created_tip", "No wallet is currently available."),
    };
  }
  if (!state.wallet.loggedIn) {
    return {
      label: tr("wallet_not_logged_in", "Wallet not signed in"),
      tip: tr("wallet_not_logged_in_tip", "Sign in to view full wallet state and send gate details."),
    };
  }
  if (mode === "full_sync") {
    return {
      label: tr("wallet_readonly_unavailable", "Read-only unavailable"),
      tip: lagPolicy.walletReason || trf("wallet_full_sync_tip", { lag }, `Currently lagging ${lag} blocks. In full-sync mode the wallet listener is disabled and sending is blocked.`),
    };
  }
  if (mode === "catchup_sync") {
    if (sendEnabled) {
      return {
        label: tr("wallet_available", "Wallet available"),
        tip: lagPolicy.walletReason || trf("wallet_catchup_send_enabled_tip", { lag, connectedCount }, `Catch-up sync in progress with lag ${lag}. Sending remains available while listener keeps ${connectedCount} connected nodes.`),
      };
    }
    if (listenerEnabled && connectedCount > 0) {
      return {
        label: tr("wallet_readonly_available", "Read-only available"),
        tip: trf("wallet_catchup_tip", { connectedCount }, `Catch-up sync in progress. ${connectedCount} listener nodes remain. Sending is blocked.`),
      };
    }
    return {
      label: tr("wallet_catchup_degraded", "Catch-up degraded"),
      tip: lagPolicy.walletReason || tr("wallet_catchup_degraded_tip", "Catch-up sync is using node capacity first. No listener capacity remains and sending is blocked."),
    };
  }
  if (listenerEnabled && sendEnabled) {
    return {
      label: tr("wallet_available", "Wallet available"),
      tip: connectedCount > 0
        ? trf("wallet_available_tip_connected", { connectedCount }, `Listener is connected to ${connectedCount} nodes. Sending is available.`)
        : tr("wallet_available_tip_sync", "Chain is synced and sending is available; listener is still connecting or not yet connected."),
    };
  }
  return {
    label: tr("wallet_state_unknown", "State unknown"),
    tip: lagPolicy.walletReason || tr("wallet_state_unknown_tip", "Current wallet runtime did not return a clear gate status."),
  };
}

function formatSignedBsv(value) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return "-";
  return safe > 0 ? `+${fmt(safe)}` : fmt(safe);
}

function applyWalletBalanceSnapshot(balance = {}, options = {}) {
  const confirmedSat = Number(balance.confirmed || 0);
  const availableSat = Number.isFinite(Number(balance.available))
    ? Number(balance.available || 0)
    : confirmedSat;
  const selfChangePendingSat = Number.isFinite(Number(balance.selfChangePending))
    ? Number(balance.selfChangePending || 0)
    : 0;
  const unconfirmedIncomingSat = Number.isFinite(Number(balance.unconfirmedIncoming))
    ? Number(balance.unconfirmedIncoming || 0)
    : (Number.isFinite(Number(balance.unconfirmed)) ? Number(balance.unconfirmed || 0) : 0);
  const totalSat = Number(balance.total || 0);
  const unconfirmedSat = unconfirmedIncomingSat;
  const confirmed = confirmedSat / 100000000;
  const available = availableSat / 100000000;
  const selfChangePending = selfChangePendingSat / 100000000;
  const unconfirmedIncoming = unconfirmedIncomingSat / 100000000;
  const unconfirmed = unconfirmedSat / 100000000;
  const total = totalSat / 100000000;
  const prevSat = options.prevSat ?? state.walletWatch.lastTotalSat;
  state.wallet.confirmedSat = confirmedSat;
  state.wallet.confirmedBsv = confirmed;
  state.wallet.availableSat = availableSat;
  state.wallet.availableBsv = available;
  state.wallet.selfChangePendingSat = selfChangePendingSat;
  state.wallet.selfChangePendingBsv = selfChangePending;
  state.wallet.unconfirmedIncomingSat = unconfirmedIncomingSat;
  state.wallet.unconfirmedIncomingBsv = unconfirmedIncoming;
  state.wallet.unconfirmedSat = unconfirmedSat;
  state.wallet.unconfirmedBsv = unconfirmed;
  state.wallet.totalSat = totalSat;
  state.wallet.totalBsv = total;
  state.walletWatch.lastTotalSat = totalSat;
  if (els.walletAvailableBalanceView) els.walletAvailableBalanceView.value = fmt(available);
  if (els.walletPendingBalanceView) els.walletPendingBalanceView.value = formatSignedBsv(selfChangePending);
  if (els.walletPendingIncomingBalanceView) els.walletPendingIncomingBalanceView.value = formatSignedBsv(unconfirmedIncoming);
  if (els.walletBalanceView) els.walletBalanceView.value = fmt(total);
  renderSendModalAvailableBalance();
  const notify = options.notify === true;
  const balanceUpdatedAt = String(balance?.updatedAt || "");
  const lastNotifiedBalanceUpdatedAt = String(state.walletWatch.lastNotifiedBalanceUpdatedAt || "");
  const shouldNotify = notify
    && prevSat !== null
    && totalSat !== prevSat
    && !!balanceUpdatedAt
    && balanceUpdatedAt !== lastNotifiedBalanceUpdatedAt;
  if (shouldNotify) {
    const delta = (totalSat - prevSat) / 100000000;
    if (delta > 0) {
      pushNotice(trf("wallet_received_notice", { amount: delta.toFixed(8) }, `Received +${delta.toFixed(8)} BSV`));
    } else {
      pushNotice(trf("wallet_spent_notice", { amount: delta.toFixed(8) }, `Wallet spent ${delta.toFixed(8)} BSV`));
    }
    state.walletWatch.lastNotifiedBalanceUpdatedAt = balanceUpdatedAt;
  }
  renderHeader();
}

function mergeWalletStateWithComputed(nextWallet = {}, previousWallet = state.wallet || {}) {
  const merged = {
    ...(previousWallet && typeof previousWallet === "object" ? previousWallet : {}),
    ...(nextWallet && typeof nextWallet === "object" ? nextWallet : {}),
  };
  const nextHasOwn = (key) => Object.prototype.hasOwnProperty.call(nextWallet || {}, key);
  for (const key of [
    "confirmedSat",
    "confirmedBsv",
    "unconfirmedSat",
    "unconfirmedBsv",
    "totalSat",
    "totalBsv",
    "updatedAt",
  ]) {
    const nextValue = nextWallet?.[key];
    if (nextValue === null || nextValue === undefined || nextValue === "") {
      const prevValue = previousWallet?.[key];
      if (prevValue !== null && prevValue !== undefined && prevValue !== "") merged[key] = prevValue;
    }
  }
  for (const key of ["exists", "loggedIn", "network", "chain"]) {
    if (!nextHasOwn(key)) {
      const prevValue = previousWallet?.[key];
      if (prevValue !== null && prevValue !== undefined && prevValue !== "") merged[key] = prevValue;
    }
  }
  if (previousWallet?.loggedIn === true && nextWallet?.loggedIn === false && !nextHasOwn("__forceLoggedOut")) {
    merged.loggedIn = true;
  }
  if (!Array.isArray(nextWallet?.historyItems) && Array.isArray(previousWallet?.historyItems)) {
    merged.historyItems = previousWallet.historyItems.slice();
  }
  if (Array.isArray(nextWallet?.historyItems) && nextWallet.historyItems.length <= 0 && Array.isArray(previousWallet?.historyItems) && previousWallet.historyItems.length > 0) {
    merged.historyItems = previousWallet.historyItems.slice();
  }
  return merged;
}

function renderSendModalAvailableBalance() {
  if (!els.sendModalAvailableBalance) return;
  const available = Number(state.wallet.availableBsv || 0);
  els.sendModalAvailableBalance.textContent = trf(
    "send_available_balance_hint",
    { amount: available.toFixed(8) },
    `Available balance: ${available.toFixed(8)} BSV`,
  );
}

function formatWalletSyncProgress(progress) {
  const p = progress && typeof progress === "object" ? progress : {};
  const parts = [];
  if (p.message) parts.push(localizeWalletProgressText(p.message));
  if (Number.isFinite(Number(p.scannedAddresses)) && Number.isFinite(Number(p.addressCount)) && Number(p.addressCount) > 0) {
    parts.push(trf("wallet_progress_addresses", { scanned: Number(p.scannedAddresses), total: Number(p.addressCount) }, `Addresses ${Number(p.scannedAddresses)}/${Number(p.addressCount)}`));
  }
  if (p.currentAddress) parts.push(trf("wallet_progress_current", { address: String(p.currentAddress) }, `Current ${String(p.currentAddress)}`));
  if (Number.isFinite(Number(p.foundUtxos))) parts.push(`UTXO ${Number(p.foundUtxos)}`);
  if (Number.isFinite(Number(p.foundTxids))) parts.push(trf("wallet_progress_txs", { count: Number(p.foundTxids) }, `Transactions ${Number(p.foundTxids)}`));
  if (Number.isFinite(Number(p.total)) && Number(p.total) > 0) {
    parts.push(trf("wallet_progress_balance", { amount: (Number(p.total) / 100000000).toFixed(8) }, `Balance ${(Number(p.total) / 100000000).toFixed(8)} BSV`));
  }
  if (p.error) parts.push(trf("wallet_progress_error", { error: localizeUserFacingError(p.error) }, `Error ${localizeUserFacingError(p.error)}`));
  return parts.filter(Boolean).join(" | ");
}

const LOCALE_STORAGE_KEY = "bsv_market.ui_locale.v1";
const DEFAULT_LOCALE_MANIFEST = {
  default: "en",
  locales: [
    { code: "en", label: "English" },
    { code: "zh", label: "Simplified Chinese" },
  ],
};
const APP_ASSET_VERSION = String(globalThis.__APP_ASSET_VERSION || "20260402-10");
const CHAT_META_VISIBILITY_STORAGE_KEY = "bsv_market.chat.message_meta_visibility.v1";
const localeState = {
  manifest: DEFAULT_LOCALE_MANIFEST,
  code: "en",
  messages: {},
  cache: new Map(),
};

function normalizeLocaleCode(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("zh")) return "zh";
  return value.split("-")[0];
}

function getSupportedLocaleCodes() {
  const list = Array.isArray(localeState.manifest?.locales) ? localeState.manifest.locales : [];
  return list.map((item) => normalizeLocaleCode(item?.code)).filter(Boolean);
}

function resolvePreferredLocale(preferred) {
  const supported = getSupportedLocaleCodes();
  const normalized = normalizeLocaleCode(preferred);
  if (normalized && supported.includes(normalized)) return normalized;
  return normalizeLocaleCode(localeState.manifest?.default) || "en";
}

async function loadLocaleManifest() {
  try {
    const resp = await fetch(`./locales/manifest.json?v=${encodeURIComponent(APP_ASSET_VERSION)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!resp.ok) throw new Error(`manifest http ${resp.status}`);
    const json = await resp.json();
    if (json && typeof json === "object") {
      localeState.manifest = json;
    }
  } catch (_) {
    localeState.manifest = DEFAULT_LOCALE_MANIFEST;
  }
}

async function loadLocaleMessages(code) {
  const resolved = resolvePreferredLocale(code);
  if (localeState.cache.has(resolved)) return localeState.cache.get(resolved);
  const resp = await fetch(`./locales/${encodeURIComponent(resolved)}.json?v=${encodeURIComponent(APP_ASSET_VERSION)}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!resp.ok) throw new Error(`locale http ${resp.status}`);
  const json = await resp.json();
  const messages = json && typeof json === "object" ? json : {};
  localeState.cache.set(resolved, messages);
  return messages;
}

function loadChatMetaVisibilityPreference() {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_META_VISIBILITY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const applyGroup = (groupKey, source) => {
      if (!source || typeof source !== "object") return;
      state.chat.messageMetaVisible[groupKey] = state.chat.messageMetaVisible[groupKey] || {};
      for (const key of ["who", "transport", "time", "status"]) {
        if (typeof source[key] === "boolean") {
          state.chat.messageMetaVisible[groupKey][key] = source[key];
        }
      }
    };
    if (parsed.self || parsed.peer) {
      applyGroup("self", parsed.self);
      applyGroup("peer", parsed.peer);
      return;
    }
    for (const groupKey of ["self", "peer"]) {
      for (const key of ["who", "transport", "time", "status"]) {
        if (typeof parsed[key] === "boolean") {
          state.chat.messageMetaVisible[groupKey][key] = parsed[key];
        }
      }
    }
  } catch (_) {}
}

function saveChatMetaVisibilityPreference() {
  try {
    globalThis.localStorage?.setItem(
      CHAT_META_VISIBILITY_STORAGE_KEY,
      JSON.stringify({
        self: {
          who: state.chat.messageMetaVisible?.self?.who === true,
          transport: state.chat.messageMetaVisible?.self?.transport !== false,
          time: state.chat.messageMetaVisible?.self?.time !== false,
          status: state.chat.messageMetaVisible?.self?.status === true,
        },
        peer: {
          who: state.chat.messageMetaVisible?.peer?.who === true,
          transport: state.chat.messageMetaVisible?.peer?.transport !== false,
          time: state.chat.messageMetaVisible?.peer?.time !== false,
          status: state.chat.messageMetaVisible?.peer?.status === true,
        },
      }),
    );
  } catch (_) {}
}

function renderLanguageOptions() {
  if (!els.langSelect) return;
  const locales = Array.isArray(localeState.manifest?.locales) ? localeState.manifest.locales : [];
  const current = resolvePreferredLocale(localeState.code);
  els.langSelect.innerHTML = locales.map((item) => {
    const code = resolvePreferredLocale(item?.code);
    const label = String(item?.label || code || "").trim() || code;
    const selected = code === current ? " selected" : "";
    return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");
  els.langSelect.value = current;
}

async function setUiLanguage(code, { persist = true, rerender = true } = {}) {
  const resolved = resolvePreferredLocale(code);
  const messages = await loadLocaleMessages(resolved);
  localeState.code = resolved;
  localeState.messages = messages;
  document.documentElement.lang = resolved === "zh" ? "zh-CN" : resolved;
  if (persist) {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, resolved); } catch (_) {}
  }
  renderLanguageOptions();
  applyI18n();
  if (rerender) {
    renderAll();
  }
}

async function initI18n() {
  await loadLocaleManifest();
  const stored = (() => {
    try { return localStorage.getItem(LOCALE_STORAGE_KEY) || ""; } catch (_) { return ""; }
  })();
  const initial = resolvePreferredLocale(stored || navigator.language || "");
  await setUiLanguage(initial, { persist: Boolean(stored), rerender: false });
  const warmLocales = getSupportedLocaleCodes().filter((code) => code && code !== initial);
  setTimeout(() => {
    warmLocales.forEach((code) => {
      loadLocaleMessages(code).catch(() => {});
    });
  }, 0);
}

function tr(key, fallback = "") {
  return localeState.messages?.[key] || fallback || key;
}
function trf(key, vars = {}, fallback = "") {
  let text = tr(key, fallback);
  Object.entries(vars || {}).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value));
  });
  return text;
}

function localizeApiErrorText(message = "", code = "") {
  const raw = String(message || "").trim();
  const safeCode = String(code || "").trim();
  if (/invalid password|密码错误/i.test(raw)) return tr("api_error_invalid_password", "Invalid password");
  if (/password is required|请输入钱包口令|请输入钱包密码/i.test(raw)) return tr("err_password_required", "Please enter wallet password");
  if (/No local SPV UTXOs found|missing \d+ spendable input/i.test(raw)) {
    return tr("balance_unconfirmed_wait", "Balance is not confirmed yet. Please wait for confirmation before publishing on-chain");
  }
  if (/Insufficient spendable balance/i.test(raw)) {
    return tr("balance_insufficient_spendable", "Insufficient spendable balance. Please keep enough confirmed spendable UTXOs for this on-chain action");
  }
  if (/not logged in|auth_required|请先登录|请先登录钱包/i.test(raw) || (safeCode === "AUTH_REQUIRED" && !raw)) {
    return tr("wallet_login_required", "Please sign in to the wallet first");
  }
  if (/等待发货交易区块确认后才可确认收货|wait for the shipment transaction/i.test(raw)) {
    return tr("buyer_order_wait_ship_confirmed", "等待发货交易区块确认后才可确认收货");
  }
  if (/order not found|订单不存在/i.test(raw)) return tr("order_not_found", "Order not found");
  if (/product unavailable|商品不可用/i.test(raw)) return tr("product_unavailable", "Product unavailable");
  if (/category name already exists|duplicate category|分类.*(重复|存在)/i.test(raw)) {
    return tr("category_name_duplicate", "Category name already exists");
  }
  if (/category not found|分类不存在|分类.*已删除/i.test(raw)) {
    return tr("category_not_found_or_deleted", "Category not found or already deleted");
  }
  const productVersionMismatch = raw.match(/版本不一致:\s*下单v(\d+),\s*当前v(\d+)/);
  if (productVersionMismatch) {
    return trf("product_version_mismatch_error", {
      orderVersion: productVersionMismatch[1],
      currentVersion: productVersionMismatch[2],
    }, `Product version mismatch: order v${productVersionMismatch[1]}, current v${productVersionMismatch[2]}`);
  }
  if (raw === "drive_upload_interrupted_resumable" || /上链中断，可继续/.test(raw)) {
    return tr("drive_upload_interrupted_resumable", "Upload was interrupted and can be resumed");
  }
  if (raw === "chat_direct_only_requires_p2p" || /附件或 directOnly 消息只能通过 P2P 直连发送/.test(raw)) {
    return tr("chat_direct_only_requires_p2p", "Attachments or direct-only messages require a P2P direct connection");
  }
  return raw || tr("api_request_failed", "Request failed");
}

function localizeUserFacingError(message = "", code = "") {
  return localizeApiErrorText(message, code);
}

function localizeChatNotice(message = "") {
  const raw = String(message || "").trim();
  if (!raw) return "";
  if (/^chat_[a-z0-9_]+$/.test(raw)) return tr(raw, raw);
  if (/聊天资料已保存到待上链队列/.test(raw)) return tr("chat_profile_publish_queued", "Chat profile was saved to the pending publish queue. Click Publish before chatting.");
  if (/已自动生成新的个人信息和聊天资料待上链/.test(raw)) return tr("chat_profile_auto_publish_queued", "A new profile and chat profile were queued for publishing. Click Publish before chatting.");
  if (/当前钱包还未发布聊天资料/.test(raw)) return tr("chat_publish_required", "To chat, save the chat profile and publish it on-chain first.");
  return raw;
}

function localizeDisplayName(name = "") {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (raw === "匿名买家A") return tr("default_anonymous_buyer_a", "Anonymous Buyer A");
  if (raw === "买家A") return tr("default_buyer_a", "Buyer A");
  if (raw === "本地商家") return tr("merchant_local", "Local merchant");
  if (raw === "未命名商家") return tr("merchant_unnamed", "Unnamed merchant");
  const unnamedMerchant = raw.match(/^未命名商家\(([^)]+)\)$/);
  if (unnamedMerchant) {
    return trf("merchant_unnamed_short", { id: unnamedMerchant[1] }, `Unnamed merchant (${unnamedMerchant[1]})`);
  }
  const merchantService = raw.match(/^(.+)客服$/);
  if (merchantService) {
    const merchant = localizeDisplayName(merchantService[1]) || merchantService[1];
    return trf("merchant_customer_service_name", { merchant }, `${merchant} service`);
  }
  return raw;
}

function localizeWalletHistoryLabel(label = "") {
  const raw = String(label || "").trim();
  if (!raw) return "";
  if (raw === "收入") return tr("wallet_income", "Income");
  if (raw === "支出") return tr("wallet_expense", "Expense");
  if (raw === "归集手续费") return tr("wallet_self_consolidation_fee", "Consolidation fee");
  if (raw === "上链支出") return tr("wallet_onchain_spend", "On-chain spend");
  if (raw === "商品收入") return tr("wallet_product_income", "Product income");
  if (raw === "订单支出") return tr("wallet_order_spend", "Order spend");
  if (raw === "订单转账") return tr("wallet_tx_type_order_transfer", "Order transfer");
  if (raw === "普通转账") return tr("wallet_tx_type_wallet_transfer", "Wallet transfer");
  if (raw === "数据上链") return tr("wallet_tx_type_data_anchor", "Data anchor");
  return raw;
}

function localizeWalletTransactionType(type = "", label = "") {
  const raw = String(type || "").trim();
  if (raw === "order_transfer") return tr("wallet_tx_type_order_transfer", "Order transfer");
  if (raw === "data_anchor") return tr("wallet_tx_type_data_anchor", "Data anchor");
  if (raw === "wallet_transfer") return tr("wallet_tx_type_wallet_transfer", "Wallet transfer");
  return localizeWalletHistoryLabel(label) || tr("wallet_tx_type_wallet_transfer", "Wallet transfer");
}

function formatWalletSatAmount(sat = 0, options = {}) {
  const value = Number(sat || 0);
  const sign = options.sign === false ? "" : (value >= 0 ? "+" : "-");
  return `${sign}${(Math.abs(value) / 100000000).toFixed(8)} BSV`;
}

function renderOrderSettlementBreakdownHtml(breakdown = null) {
  if (!breakdown || typeof breakdown !== "object") return "";
  const rows = [];
  const role = String(breakdown.role || "");
  if (role === "seller") {
    if (Number(breakdown.productIncomeSat || 0) > 0) {
      rows.push(`${tr("wallet_order_product_income", "Product income")} ${formatWalletSatAmount(breakdown.productIncomeSat)}`);
    }
    if (Number(breakdown.depositRefundSat || 0) > 0) {
      rows.push(`${tr("wallet_order_seller_deposit_refund", "Seller deposit returned")} ${formatWalletSatAmount(breakdown.depositRefundSat)}`);
    }
  } else if (role === "buyer") {
    if (Number(breakdown.productSpendSat || 0) > 0) {
      rows.push(`${tr("wallet_order_product_spend", "Product amount")} ${formatWalletSatAmount(-Number(breakdown.productSpendSat || 0))}`);
    }
    if (Number(breakdown.buyerDepositRefundSat || 0) > 0) {
      rows.push(`${tr("wallet_order_buyer_deposit_refund", "Buyer deposit returned")} ${formatWalletSatAmount(breakdown.buyerDepositRefundSat)}`);
    }
  }
  const feeNetSat = role === "seller"
    ? Math.max(0, Number(breakdown.displayFeeNetSat || breakdown.feeNetSat || 0))
    : Math.max(0, Number(breakdown.feeNetSat || 0));
  if (feeNetSat > 0) {
    rows.push(`${tr("wallet_order_settlement_fee", "Settlement fee")} ${formatWalletSatAmount(-feeNetSat)}`);
  }
  if (!rows.length) return "";
  return `<p class="wallet-history-detail">${rows.map(escapeHtml).join(" | ")}</p>`;
}

function localizeWalletProgressText(message = "") {
  const raw = String(message || "").trim();
  if (!raw) return "";
  if (raw === "开始从 WOC 重建钱包索引") return tr("wallet_progress_woc_rebuild_start", "Starting wallet index rebuild from WOC");
  if (raw === "索引重建完成") return tr("wallet_progress_index_rebuild_done", "Index rebuild completed");
  if (raw === "开始刷新钱包") return tr("wallet_progress_refresh_start", "Starting wallet refresh");
  if (raw === "开始刷新钱包：清空本地索引并重建") return tr("wallet_progress_refresh_clear_rebuild", "Starting wallet refresh: clear local index and rebuild");
  if (raw === "开始刷新钱包：准备重建索引") return tr("wallet_progress_refresh_prepare_rebuild", "Starting wallet refresh: preparing index rebuild");
  if (raw === "正在清空本地交易和 UTXO 索引") return tr("wallet_progress_clearing_local_index", "Clearing local transaction and UTXO index");
  if (raw === "钱包刷新完成") return tr("wallet_refresh_done_log", "Wallet refresh completed");
  if (raw === "钱包刷新失败") return tr("wallet_refresh_failed", "Wallet refresh failed");
  if (raw === "正在从 SPV 节点刷新余额") return tr("wallet_progress_spv_refresh", "Refreshing balance from SPV nodes");
  let match = raw.match(/^正在扫描地址 (\d+)\/(\d+)$/);
  if (match) return trf("wallet_progress_scanning_address", { current: match[1], total: match[2] }, `Scanning address ${match[1]}/${match[2]}`);
  match = raw.match(/^已扫 (\d+)\/(\d+) 个地址，发现 (\d+) 条 UTXO，(\d+) 条交易$/);
  if (match) {
    return trf("wallet_progress_scan_found", {
      current: match[1],
      total: match[2],
      utxos: match[3],
      txs: match[4],
    }, `Scanned ${match[1]}/${match[2]} addresses, found ${match[3]} UTXOs and ${match[4]} transactions`);
  }
  return localizeUserFacingError(raw);
}

function localizeOrderTip(tip = "") {
  const raw = String(tip || "").trim();
  if (!raw) return "";
  if (/^order_tip_[a-z0-9_]+$/.test(raw)) return tr(raw, raw);
  const map = {
    "买家已下单，等待卖家处理": "order_tip_place",
    "买家已下单，等待卖家确认发货": "order_tip_place",
    "卖家已接受订单，进入交易锁定": "order_tip_accept",
    "卖家已确认发货": "order_tip_ship",
    "买家确认收货，订单已完成": "order_tip_confirm_receipt",
    "买家在卖家确认发货前取消订单": "order_tip_buyer_cancel_before_ship",
    "卖家取消订单，买家锁定金额退回": "order_tip_seller_cancel",
    "买家已申请退货，等待卖家确认": "order_tip_return_request",
    "买家已发起退款申请，等待卖家确认": "order_tip_return_request",
    "卖家确认退货，订单已关闭": "order_tip_return_accept",
    "卖家确认退款，订单已关闭": "order_tip_confirm_refund",
    "卖家超时未响应，订单自动取消": "order_tip_timeout_cancel",
    "订单进入争议冻结流程，常规结算已锁定": "order_tip_dispute_lock",
  };
  return map[raw] ? tr(map[raw], raw) : raw;
}

function formatApiErrorMessage(message = "", code = "", requestId = "") {
  const localized = localizeApiErrorText(message, code);
  const suffix = `${code ? ` [${code}]` : ""}${requestId ? ` #${requestId}` : ""}`;
  return `${localized}${suffix}`;
}

function applyI18n() {
  Object.keys(localeState.messages || {}).forEach((id) => {
    const el = els[id];
    if (!el) return;
    if (id === "btnCopyReceive") return;
    if (id.startsWith("btnClose")) return;
    el.textContent = tr(id, el.textContent);
  });
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n") || "").trim();
    if (!key) return;
    el.textContent = tr(key, el.textContent);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n-placeholder") || "").trim();
    if (!key) return;
    el.setAttribute("placeholder", tr(key, el.getAttribute("placeholder") || ""));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n-alt") || "").trim();
    if (!key) return;
    el.setAttribute("alt", tr(key, el.getAttribute("alt") || ""));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n-title") || "").trim();
    if (!key) return;
    el.setAttribute("title", tr(key, el.getAttribute("title") || ""));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n-aria-label") || "").trim();
    if (!key) return;
    el.setAttribute("aria-label", tr(key, el.getAttribute("aria-label") || ""));
  });
  document.querySelectorAll("[data-i18n-open-text]").forEach((el) => {
    const key = String(el.getAttribute("data-i18n-open-text") || "").trim();
    if (!key) return;
    el.setAttribute("data-open-text", tr(key, el.getAttribute("data-open-text") || ""));
  });
  document.title = tr("page_title", document.title);
}

function renderReceiveQr() {
  if (E2E_UI_MODE) return;
  const address = String(state.walletReceiveAddress || "").trim();
  if (!address || !els.walletReceiveQr) {
    if (!els.walletReceiveQr) return;
    els.walletReceiveQr.removeAttribute("src");
    els.walletReceiveQr.style.display = "none";
    return;
  }
  els.walletReceiveQr.src = `/api/wallet/receive-address/qr?ts=${Date.now()}`;
  els.walletReceiveQr.style.display = "block";
}

function renderReceiveModalQr() {
  if (E2E_UI_MODE || !els.receiveModalQr) return;
  const address = String(state.walletReceiveAddress || "").trim();
  if (!address) {
    els.receiveModalQr.removeAttribute("src");
    els.receiveModalQr.style.display = "none";
    return;
  }
  els.receiveModalQr.src = `/api/wallet/receive-address/qr?ts=${Date.now()}`;
  els.receiveModalQr.style.display = "block";
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const probe = document.createElement("textarea");
  probe.value = value;
  probe.setAttribute("readonly", "");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  document.body.appendChild(probe);
  probe.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(probe);
  return Boolean(ok);
}

function estimateSendAllAmountBsv(inputCount, totalSat) {
  const safeInputs = Math.max(1, Number(inputCount || 1));
  const safeTotalSat = Math.max(0, Number(totalSat || 0));
  const feeSat = Math.max(1, Math.ceil((10 + (safeInputs * 148) + 34) * 2));
  const sendSat = Math.max(0, safeTotalSat - feeSat);
  return {
    feeSat,
    sendSat,
    sendBsv: sendSat / 100000000,
  };
}

async function ensureReceiveAddress() {
  if (E2E_UI_MODE) return;
  if (String(state.walletReceiveAddress || "").trim()) return;
  try {
    const result = await api("/api/wallet/receive-address");
    state.walletReceiveAddress = result.address || "";
    if (els.walletReceiveView) els.walletReceiveView.value = state.walletReceiveAddress;
    if (els.receiveModalAddress) els.receiveModalAddress.value = state.walletReceiveAddress;
    renderReceiveQr();
    renderReceiveModalQr();
  } catch (_) {
  // Ignore auto-load failure; user can click Receive manually.
  }
}

async function refreshWalletBalanceLive() {
  if (!state.wallet.loggedIn) return;
  try {
    const result = await api("/api/wallet/balance");
    applyWalletBalanceSnapshot(result, { notify: false });
  } catch (_) {
    // keep silent here; explicit actions still show their own errors
  }
}

async function refreshWalletBalanceCached() {
  if (!state.wallet.loggedIn) return;
  try {
    const result = await api("/api/wallet/balance");
    applyWalletBalanceSnapshot(result, { notify: false });
  } catch (_) {}
}

function startWalletPolling() {
  state.timers.walletPoll = null;
  state.walletWatch.pollTick = 0;
}

function startCatalogPolling() {
  state.timers.catalogPoll = null;
}

function issueServerStateToken() {
  state.ui.nextServerStateToken = Math.max(0, Number(state.ui.nextServerStateToken || 0)) + 1;
  return state.ui.nextServerStateToken;
}

async function refreshWalletBroadcastMonitor(options = {}) {
  const runMonitor = options.runMonitor === true;
  const suffix = runMonitor ? "?monitor=1" : "";
  const monitor = await api(`/api/wallet/broadcast-monitor${suffix}`, { silent: true }).catch(() => ({ records: [] }));
  state.wallet.broadcastMonitor = Array.isArray(monitor.records) ? monitor.records : [];
  renderWalletHistoryItems(state.wallet.historyItems);
}

async function refreshWalletHistory(options = {}) {
  if (!els.walletHistoryList) return;
  try {
    const status = await api("/api/wallet/status", { silent: true, timeoutMs: 5000 }).catch(() => null);
    if (status && status.loggedIn === false) {
      if (state.wallet.loggedIn === true && Array.isArray(state.wallet.historyItems) && state.wallet.historyItems.length > 0) {
        renderWalletHistoryItems(state.wallet.historyItems);
        return;
      }
      state.wallet.historyItems = [];
      els.walletHistoryList.innerHTML = `<div class="row">${escapeHtml(tr("wallet_history_login_required", "请先登录钱包以查看记录"))}</div>`;
      return;
    }
    const r = await api("/api/wallet/history?page=1&pageSize=10");
    const items = Array.isArray(r.items) ? r.items : [];
    state.wallet.historyItems = items;
    try {
      console.info("[wallet-history-refresh]", {
        total: Number(r?.total || 0),
        itemCount: items.length,
        updatedAt: String(r?.updatedAt || ""),
      });
    } catch (_) {}
    renderWalletHistoryItems(state.wallet.historyItems);
    if (options.includeBroadcastMonitor === true) {
      await refreshWalletBroadcastMonitor({ runMonitor: options.runBroadcastMonitor === true });
    }
  } catch (err) {
    const msg = String(err?.message || "");
    if (/AUTH_REQUIRED|Not logged in/i.test(msg)) {
      if (state.wallet.loggedIn === true && Array.isArray(state.wallet.historyItems) && state.wallet.historyItems.length > 0) {
        renderWalletHistoryItems(state.wallet.historyItems);
        return;
      }
      state.wallet.historyItems = [];
      els.walletHistoryList.innerHTML = `<div class="row">${escapeHtml(tr("wallet_history_login_required", "请先登录钱包以查看记录"))}</div>`;
      return;
    }
    if (!/AUTH_REQUIRED|Not logged in/i.test(msg) && !els.walletHistoryList.innerHTML.trim()) {
      els.walletHistoryList.innerHTML = `<div class="row">${escapeHtml(tr("wallet_history_load_failed", "Failed to load wallet history"))}</div>`;
    }
  }
}

function renderWalletHistoryItems(items = []) {
  if (!els.walletHistoryList) return;
  const safeItems = Array.isArray(items) ? items : [];
  const monitorRows = (Array.isArray(state.wallet?.broadcastMonitor) ? state.wallet.broadcastMonitor : [])
    .filter((row) => ["broadcast_pending_confirm", "broadcast_failed"].includes(String(row?.status || "")));
  try {
    const summary = {
      count: safeItems.length,
      loggedIn: Boolean(state.wallet?.loggedIn),
      firstTxid: String(safeItems[0]?.txid || ""),
      lastTxid: String(safeItems[safeItems.length - 1]?.txid || ""),
      at: new Date().toISOString(),
    };
    state.debug.walletHistoryRender = summary;
    console.info("[wallet-history-render]", summary);
  } catch (_) {}
  const sorted = safeItems.slice().sort((a, b) => {
    const ta = a?.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const tb = b?.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return tb - ta;
  });
  const monitorHtml = monitorRows.length ? monitorRows.map((row) => {
    const statusText = String(row.status || "") === "broadcast_pending_confirm"
      ? tr("wallet_broadcast_pending_confirm", "已广播待确认")
      : tr("wallet_broadcast_failed", "广播失败");
    const when = row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "-";
    const reason = String(row.failureReason || row.successReason || "");
    const retryButton = String(row.status || "") === "broadcast_failed"
      ? `<button type="button" data-wallet-rebroadcast-txid="${escapeHtml(row.txid || "")}">${escapeHtml(tr("wallet_rebroadcast_button", "重新广播"))}</button>`
      : "";
    return `<div class="row wallet-history-expense"><p><strong>${escapeHtml(statusText)}</strong> ${escapeHtml(when)}</p><p>${escapeHtml(reason)}</p><p class="mono">${escapeHtml(row.txid || "")}</p>${retryButton ? `<div class="actions inline">${retryButton}</div>` : ""}</div>`;
      }).join("") : "";
  const historyHtml = safeItems.length
    ? sorted.map((x) => {
        const kind = String(x.kind || "");
        const netSat = Number.isFinite(Number(x.netSat)) && Number(x.netSat || 0) !== 0
          ? Number(x.netSat)
          : (kind === "external_receive" ? 1 : -1) * Math.max(0, Number(x.amountSat || 0));
        const amountSat = Math.max(0, Number(x.amountSat || Math.abs(netSat || Number(x.netSat || 0))));
        const dir = kind === "external_receive" ? tr("wallet_income", "Income") : tr("wallet_expense", "Expense");
        const amountText = formatWalletSatAmount(netSat || ((kind === "external_receive" ? 1 : -1) * amountSat));
        let spendLabel = "";
        if (kind === "self_consolidation_fee") {
          spendLabel = localizeWalletHistoryLabel(x.label) || tr("wallet_self_consolidation_fee", "Consolidation fee");
        } else if (kind !== "external_receive") {
          spendLabel = localizeWalletHistoryLabel(x.label) || tr("wallet_trade_spend", "Transfer spend");
        }
        const ts = x.lastSeenAt ? new Date(x.lastSeenAt).toLocaleString() : "-";
        const status = x.confirmed ? tr("wallet_confirmed", "Confirmed") : tr("wallet_unconfirmed", "Unconfirmed");
        const transactionTypeText = localizeWalletTransactionType(x.transactionType, x.transactionTypeLabel);
        const businessLabel = kind === "external_receive"
          ? localizeWalletHistoryLabel(x.label)
          : spendLabel;
        const metaParts = [transactionTypeText, businessLabel].filter(Boolean);
        const typeText = metaParts.length ? ` (${metaParts.join(" / ")})` : "";
        const rowClass = dir === tr("wallet_income", "Income") ? "wallet-history-income" : "wallet-history-expense";
        const breakdownHtml = renderOrderSettlementBreakdownHtml(x.orderBreakdown);
        return `<div class="row ${rowClass}"><p><strong>${escapeHtml(dir)}</strong>${escapeHtml(typeText)} ${escapeHtml(amountText)} | ${escapeHtml(status)}</p>${breakdownHtml}<p>${escapeHtml(ts)}</p><p class="mono">${escapeHtml(x.txid)}</p></div>`;
      }).join("")
    : `<div class="row">${escapeHtml(tr("wallet_history_empty", "No wallet history yet"))}</div>`;
  els.walletHistoryList.innerHTML = `${monitorHtml}${historyHtml}`;
}

let walletUiRefreshPromise = null;

async function refreshWalletUiFromEvent(reason = "wallet_snapshot_event") {
  if (walletUiRefreshPromise) return walletUiRefreshPromise;
  walletUiRefreshPromise = (async () => {
    try {
      if (!state.wallet.loggedIn) {
        renderWalletHistoryItems([]);
        renderHeader();
        return;
      }
      const tasks = [
        refreshWalletBalanceCached(),
        refreshWalletSendPreflightFromServer({ silent: true }).catch(() => restoreWalletSendPreflight()),
      ];
      if (state.ui.walletViewActive === true) {
        tasks.push(refreshWalletHistory());
      }
      await Promise.allSettled(tasks);
      state.ui.walletUiLoaded = true;
      renderHeader();
    } finally {
      walletUiRefreshPromise = null;
    }
  })();
  return walletUiRefreshPromise;
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const isMutation = method !== "GET";
  const silent = Boolean(options.silent);
  const timeoutMs = Number(options.timeoutMs || 30000);
  const requestTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (isMutation && !silent) {
    state.ui.pendingMutations += 1;
    if (state.ui.pendingMutations === 1) {
      setButtonsBusy(true);
      pushNotice(tr("processing_please_wait", "Processing, please wait..."));
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    const startedAt = Date.now();
    if (String(path).includes("/api/wallet/send") || String(path).includes("/api/wallet/sync")) {
      try {
        console.info("[market-api-request]", {
          requestTag,
          path,
          method,
          timeoutMs,
          body: options.body || null,
        });
      } catch (_) {}
    }
    try {
      res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text();
    let json;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch (_) {
      throw new Error(trf("api_non_json", { status: res.status, statusText: res.statusText }, `API returned non-JSON (${res.status} ${res.statusText}). Confirm the service restarted to the latest version.`));
    }
    if (!res.ok || json.success === false) {
      const code = String(json?.code || '').trim();
      const requestId = String(json?.requestId || '').trim();
      const errText = String(json?.error || `HTTP ${res.status}`);
      if (String(path).includes("/api/wallet/send") || String(path).includes("/api/wallet/sync")) {
        try {
          console.warn("[market-api-fail]", {
            requestTag,
            path,
            method,
            status: res.status,
            code,
            requestId,
            elapsedMs: Date.now() - startedAt,
            error: errText,
          });
        } catch (_) {}
      }
      const error = new Error(formatApiErrorMessage(errText, code, requestId));
      error.status = res.status;
      error.code = code;
      error.requestId = requestId;
      error.rawMessage = errText;
      error.payload = json;
      throw error;
    }
    state.debug.lastApi = `${method} ${path}`;
    state.debug.lastError = "";
    state.debug.at = new Date().toISOString();
    if (String(path).includes("/api/wallet/send") || String(path).includes("/api/wallet/sync")) {
      try {
        console.info("[market-api-ok]", {
          requestTag,
          path,
          method,
          elapsedMs: Date.now() - startedAt,
          requestId: String(json?.requestId || ''),
          txid: String(json?.txid || ''),
        });
      } catch (_) {}
    }
    if (String(path).includes("/api/catalog/") || String(path).includes("/api/changes/push") || String(path).includes("/api/state-lite")) {
      try {
        console.debug("[market-api]", {
          path,
          method,
          ok: true,
          pendingUploads: json?.state?.sync?.pendingUploads,
          pendingDetails: Array.isArray(json?.state?.sync?.pendingDetails) ? json.state.sync.pendingDetails.length : undefined,
          error: json?.error,
        });
      } catch (_) {}
    }
    return json;
  } catch (err) {
    const isOrderChainRequest = String(path).startsWith("/api/orders/");
    const finalErr = err?.name === "AbortError"
      ? new Error(
        isOrderChainRequest
          ? tr("order_chain_timeout_retry", "Request timed out locally, but the transaction may still be broadcasting. Refresh the order list before retrying.")
          : tr("api_timeout_retry", "Request timed out, please try again later"),
      )
      : err;
    if (String(path).includes("/api/wallet/send") || String(path).includes("/api/wallet/sync")) {
      try {
        console.error("[market-api-exception]", {
          requestTag,
          path,
          method,
          error: String(finalErr?.message || err),
        });
      } catch (_) {}
    }
    state.debug.lastApi = `${method} ${path}`;
    state.debug.lastError = String(finalErr?.message || finalErr || err);
    state.debug.at = new Date().toISOString();
    throw finalErr;
  } finally {
    if (isMutation && !silent) {
      state.ui.pendingMutations = Math.max(0, Number(state.ui.pendingMutations || 0) - 1);
      if (state.ui.pendingMutations === 0) {
        setButtonsBusy(false);
      }
    }
  }
}

function clearEventReconnectTimer() {
  if (!state.events.reconnectTimer) return;
  clearTimeout(state.events.reconnectTimer);
  state.events.reconnectTimer = null;
}

function subscribeUiEvent(type, handler) {
  const key = String(type || "").trim();
  if (!key || typeof handler !== "function") return () => {};
  const handlers = state.events.handlers.get(key) || new Set();
  handlers.add(handler);
  state.events.handlers.set(key, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size <= 0) state.events.handlers.delete(key);
  };
}

function dispatchUiEvent(event = {}) {
  const type = String(event?.type || "").trim();
  if (!type) return;
  state.events.lastSeq = Math.max(Number(state.events.lastSeq || 0), Number(event?.seq || 0));
  handleFrontendEvent(event);
  const handlers = state.events.handlers.get(type);
  if (!handlers || handlers.size <= 0) return;
  handlers.forEach((handler) => {
    try {
      handler(event);
    } catch (err) {
      state.debug.lastError = String(err?.message || err || "event handler failed");
      state.debug.at = new Date().toISOString();
    }
  });
}

function applyBootstrapViews(views = {}) {
  let walletViewLoaded = false;
  const walletBalance = views.walletBalance;
  if (walletBalance && walletBalance.success !== false) {
    applyWalletBalanceSnapshot(walletBalance, { notify: false });
    walletViewLoaded = true;
  }
  const walletHistoryPage1 = views.walletHistoryPage1;
  if (walletHistoryPage1 && walletHistoryPage1.success !== false && Array.isArray(walletHistoryPage1.items)) {
    state.wallet.historyItems = walletHistoryPage1.items.slice();
    walletViewLoaded = true;
  }
  const walletReceiveAddress = views.walletReceiveAddress;
  if (walletReceiveAddress?.success !== false && walletReceiveAddress?.address) {
    state.walletReceiveAddress = String(walletReceiveAddress.address || "");
    if (els.walletReceiveView) els.walletReceiveView.value = state.walletReceiveAddress;
    renderReceiveQr();
    walletViewLoaded = true;
  }
  if (walletViewLoaded) state.ui.walletUiLoaded = true;
  const chatIdentity = views.chatIdentity;
  if (chatIdentity && chatIdentity.success !== false) {
    state.chat.selfWalletId = String(chatIdentity?.identity?.walletId || state.chat.selfWalletId || "");
  }
  const chatThreads = views.chatThreads;
  if (chatThreads && chatThreads.success !== false) {
    const rows = Array.isArray(chatThreads?.threads) ? chatThreads.threads : [];
    const people = (Array.isArray(chatThreads?.people) ? chatThreads.people : []).filter((person) => String(person?.walletId || "") !== String(state.chat.selfWalletId || ""));
    const friends = Array.isArray(chatThreads?.friends) ? chatThreads.friends : people.filter((person) => person?.isFriend === true);
    const hasIncomingList = rows.length > 0 || people.length > 0 || friends.length > 0;
    if (hasIncomingList || !hasLoadedChatSummaries()) {
      state.chat.threads = rows.filter((thread) => String(thread?.walletId || "") !== String(state.chat.selfWalletId || ""));
      state.chat.people = people;
      state.chat.friends = friends;
      state.chat.recent = Array.isArray(chatThreads?.recent) ? chatThreads.recent : state.chat.threads.filter((thread) => thread?.isFriend !== true).slice(0, 5);
    }
    state.chat.selfState = mergeChatSelfState(state.chat.selfState, chatThreads?.selfState);
    state.chat.unreadTotal = Number(chatThreads?.unreadTotal || 0);
    renderChatBadge();
  }
  const chatUnread = views.chatUnread;
  if (chatUnread && chatUnread.success !== false) {
    state.chat.unreadTotal = Number(chatUnread?.unreadTotal || 0);
    state.chat.buttonHasUnread = Boolean(chatUnread?.buttonHasUnread);
    renderChatBadge();
  }
}

function mergeChatSelfState(current, incoming) {
  const currentRow = current && typeof current === "object" ? current : null;
  const incomingRow = incoming && typeof incoming === "object" ? incoming : null;
  if (!incomingRow) return currentRow || { online: true, storageLimitBytes: 104857600 };
  if (!currentRow) return incomingRow;
  const currentTs = Date.parse(String(currentRow.updatedAt || "")) || 0;
  const incomingTs = Date.parse(String(incomingRow.updatedAt || "")) || 0;
  if (incomingTs < currentTs) return currentRow;
  return {
    ...currentRow,
    ...incomingRow,
  };
}

function applyBootstrapPayload(payload = {}, options = {}) {
  const token = issueServerStateToken();
  if (payload?.state) {
    applyServerState(payload.state, { token, allowTradeDomains: true });
  }
  applyBootstrapViews(payload?.views || {});
  if (options.render !== false) renderAll();
}

function isDomainLoaded(domain) {
  return state.ui?.domains?.[String(domain || "").trim()] === true;
}

function setDomainLoaded(domain, loaded = true) {
  const safeDomain = String(domain || "").trim();
  if (!safeDomain) return;
  state.ui.domains = {
    ...(state.ui.domains || {}),
    [safeDomain]: loaded === true,
  };
}

function resetLazyDomainsForLogin() {
  state.ui.domains = {
    sync: true,
    wallet: true,
    walletLedger: false,
    profile: true,
    catalog: false,
    order: false,
    chat: false,
  };
  state.ui.domainLoadsInFlight = {};
  state.merchants = [];
  state.categories = [];
  state.products = [];
  state.orders = [];
  state.chat.threads = [];
  state.chat.people = [];
  state.chat.friends = [];
  state.chat.recent = [];
  state.chat.searchResults = [];
  state.chat.unreadTotal = 0;
  state.chat.buttonHasUnread = false;
  state.ui.walletUiLoaded = false;
}

function clearTradeDomainsForResync() {
  state.ui.domains = {
    ...(state.ui.domains || {}),
    catalog: false,
    order: false,
  };
  state.merchants = [];
  state.categories = [];
  state.products = [];
  state.orders = [];
}

async function fetchBootstrapDomains(domains = []) {
  const unique = [...new Set((Array.isArray(domains) ? domains : []).map((d) => String(d || "").trim()).filter(Boolean))];
  if (!unique.length) return null;
  const tradeDomains = unique
    .filter((domain) => domain === "catalog" || domain === "order")
    .filter((domain) => domain !== "catalog" || catalogSyncEnabled());
  const localDomains = unique.filter((domain) => !tradeDomains.includes(domain));
  const payload = {
    success: true,
    bootstrapVersion: 1,
    serverTs: new Date().toISOString(),
    domains: {},
  };
  if (localDomains.length) {
    const localPayload = await api(`/api/bootstrap-lite?domains=${encodeURIComponent(localDomains.join(","))}`, { silent: true });
    if (localPayload?.domains && typeof localPayload.domains === "object") {
      Object.assign(payload.domains, localPayload.domains);
    }
  }
  if (tradeDomains.length && window.tradeClient && typeof window.tradeClient.bootstrapLite === "function") {
    try {
      const tradePayload = await window.tradeClient.bootstrapLite(tradeDomains.join(","));
      if (tradePayload?.domains && typeof tradePayload.domains === "object") {
        Object.assign(payload.domains, tradePayload.domains);
      }
    } catch (_) {
      const fallbackPayload = await api(`/api/bootstrap-lite?domains=${encodeURIComponent(tradeDomains.join(","))}`, { silent: true });
      if (fallbackPayload?.domains && typeof fallbackPayload.domains === "object") {
        Object.assign(payload.domains, fallbackPayload.domains);
      }
    }
  } else if (tradeDomains.length) {
    const fallbackPayload = await api(`/api/bootstrap-lite?domains=${encodeURIComponent(tradeDomains.join(","))}`, { silent: true });
    if (fallbackPayload?.domains && typeof fallbackPayload.domains === "object") {
      Object.assign(payload.domains, fallbackPayload.domains);
    }
  }
  return payload;
}

async function ensureDomainLoaded(domains = [], options = {}) {
  const requested = [...new Set((Array.isArray(domains) ? domains : [domains]).map((d) => String(d || "").trim()).filter(Boolean))];
  const missing = requested.filter((domain) => !isDomainLoaded(domain));
  if (!missing.length) return true;
  const key = missing.slice().sort().join(",");
  if (!key) return true;
  if (state.ui.domainLoadsInFlight?.[key]) return state.ui.domainLoadsInFlight[key];
  const promise = (async () => {
    const payload = await fetchBootstrapDomains(missing);
    if (payload) applyBootstrapLitePayload(payload, { render: options.render !== false });
    return true;
  })().finally(() => {
    const current = { ...(state.ui.domainLoadsInFlight || {}) };
    delete current[key];
    state.ui.domainLoadsInFlight = current;
  });
  state.ui.domainLoadsInFlight = {
    ...(state.ui.domainLoadsInFlight || {}),
    [key]: promise,
  };
  return promise;
}

function applyBootstrapLitePayload(payload = {}, options = {}) {
  const domains = payload?.domains && typeof payload.domains === "object" ? payload.domains : {};
  Object.keys(domains).forEach((domain) => setDomainLoaded(domain, true));
  if (domains.sync) handleFrontendEvent({ type: "sync.snapshot.updated", payload: domains.sync });
  if (domains.wallet) handleFrontendEvent({ type: "wallet.snapshot.updated", payload: domains.wallet });
  if (domains.walletLedger) handleFrontendEvent({ type: "wallet.ledger.updated", payload: domains.walletLedger });
  if (domains.catalog) handleFrontendEvent({ type: "catalog.snapshot.updated", payload: domains.catalog });
  if (domains.order) handleFrontendEvent({ type: "order.snapshot.updated", payload: domains.order });
  if (domains.chat) handleFrontendEvent({ type: "chat.snapshot.updated", payload: domains.chat });
  if (domains.profile) handleFrontendEvent({ type: "profile.snapshot.updated", payload: domains.profile });
  if (options.render !== false) renderAll();
}

function scheduleEventReconnect() {
  if (state.events.reconnectTimer) return;
  const delayMs = Math.min(5000, 500 * Math.max(1, Number(state.events.reconnectAttempts || 0)));
  state.events.reconnectTimer = setTimeout(() => {
    state.events.reconnectTimer = null;
    connectEventStream();
  }, delayMs);
}

function connectEventStream() {
  clearEventReconnectTimer();
  if (state.events.ws) {
    try { state.events.ws.close(); } catch (_) {}
    state.events.ws = null;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
  state.events.ws = ws;
  ws.addEventListener("open", () => {
    state.events.connected = true;
    state.events.reconnectAttempts = 0;
  });
  ws.addEventListener("message", (raw) => {
    try {
      const event = JSON.parse(String(raw?.data || "{}"));
      dispatchUiEvent(event);
    } catch (_) {}
  });
  ws.addEventListener("close", () => {
    state.events.connected = false;
    state.events.reconnectAttempts = Math.max(0, Number(state.events.reconnectAttempts || 0)) + 1;
    scheduleEventReconnect();
  });
  ws.addEventListener("error", () => {
    state.events.connected = false;
    try { ws.close(); } catch (_) {}
  });
}

function handleFrontendEvent(event = {}) {
  const type = String(event?.type || "").trim();
  const payload = event?.payload || {};
  if (!type) return;
  if (type === "system.bootstrap") {
    renderAll();
    return;
  }
  if (type === "sync.snapshot.updated") {
    const syncPayload = payload?.sync && typeof payload.sync === "object" ? payload.sync : payload;
    if (syncPayload && typeof syncPayload === "object" && !shouldIgnoreIncomingSyncSnapshot(syncPayload)) {
      state.sync = mergeServerSyncState(state.sync, syncPayload);
      maybeClearSyncResetDisplay(state.sync);
    }
    state.jobState = payload?.jobState && typeof payload.jobState === "object" ? payload.jobState : state.jobState;
    state.commandQueue = payload?.commandQueue && typeof payload.commandQueue === "object" ? payload.commandQueue : state.commandQueue;
    renderHeader();
    renderDebugStatus();
    if (state.ui.resyncFlow?.active) {
      const flowNonce = Number(state.ui?.resyncFlow?.nonce || 0);
      const view = buildResyncFlowState({
        sync: state.sync,
        runtime: state.runtime || {},
        jobState: state.jobState || null,
        commandQueue: state.commandQueue || null,
      });
      renderResyncProgressUi(view);
      finalizeResyncFlowView(view, flowNonce);
    }
    return;
  }
  if (type === "sync.nodes.updated") {
    if (payload && typeof payload === "object" && !shouldIgnoreIncomingSyncSnapshot(payload)) {
      state.sync = mergeServerSyncState(state.sync, payload);
      maybeClearSyncResetDisplay(state.sync);
    }
    renderHeader();
    if (els.spvNodesModal && !els.spvNodesModal.classList.contains("hidden")) {
      renderSpvNodesModalContent();
    }
    return;
  }
  if (type === "wallet.snapshot.updated") {
    if (payload?.wallet) {
      state.wallet = mergeWalletStateWithComputed(payload.wallet, state.wallet || {});
    }
    if (payload?.walletStatus) {
      state.wallet.exists = Boolean(payload.walletStatus.exists);
      state.wallet.loggedIn = Boolean(payload.walletStatus.loggedIn);
      if (payload.walletStatus.network) state.wallet.network = String(payload.walletStatus.network || state.wallet.network || "");
      if (payload.walletStatus.chain) state.wallet.chain = String(payload.walletStatus.chain || state.wallet.chain || "");
      if (payload.walletStatus.walletState) {
        applyWalletStatePreflight(payload.walletStatus.walletState, {
          readyReason: tr("wallet_ready_reason_recovered", "Wallet state recovered and send precheck passed"),
        });
      }
    }
    const walletBalance = payload?.walletBalance;
    if (walletBalance && walletBalance.success !== false) {
      applyWalletBalanceSnapshot(walletBalance, { notify: false });
      state.ui.walletUiLoaded = true;
    }
    const walletReceiveAddress = payload?.walletReceiveAddress;
    if (walletReceiveAddress?.success !== false && walletReceiveAddress?.address) {
      state.walletReceiveAddress = String(walletReceiveAddress.address || "");
      if (els.walletReceiveView) els.walletReceiveView.value = state.walletReceiveAddress;
      renderReceiveQr();
      state.ui.walletUiLoaded = true;
    }
    renderHeader();
    return;
  }
  if (type === "wallet.ledger.updated") {
    const walletHistoryPage1 = payload?.walletHistoryPage1;
    if (walletHistoryPage1 && walletHistoryPage1.success !== false && Array.isArray(walletHistoryPage1.items)) {
      state.wallet.historyItems = walletHistoryPage1.items.slice();
      renderWalletHistoryItems(state.wallet.historyItems);
      state.ui.walletUiLoaded = true;
      refreshWalletBroadcastMonitor({ runMonitor: false }).catch(() => {});
    }
    return;
  }
  if (type === "drive.upload.progress") {
    upsertDriveUploadProgress(payload);
    return;
  }
  if (type === "drive.upload.queue.error") {
    const message = String(payload?.error || "").trim();
    if (message) toast(message);
    refreshDriveUploadTasksForCurrentDir().catch(() => {});
    return;
  }
  if (type === "drive.entry.deleted" || type === "drive.file.deleted" || type === "drive.dir.deleted") {
    const targetType = String(payload?.targetType || (type === "drive.file.deleted" ? "file" : (type === "drive.dir.deleted" ? "dir" : "")));
    const targetId = String(payload?.targetId || "");
    clearDriveDeletePending(targetType, targetId);
    if (targetType === "file" && targetId) state.drive.files = (state.drive.files || []).filter((entry) => String(entry.fileId || "") !== targetId);
    if (targetType === "dir" && targetId) state.drive.dirs = (state.drive.dirs || []).filter((entry) => String(entry.dirId || "") !== targetId);
    renderDriveExplorer();
    return;
  }
  if (type === "drive.tree.updated") {
    if (shouldSkipDriveTreeUpdatedEvent(payload)) return;
    if (Date.now() < Number(state.drive.suppressTreeRefreshUntil || 0)) return;
    if (els.driveModal && !els.driveModal.classList.contains("hidden")) {
      fetchDriveTree(state.drive.currentPath || "/", { tree: !hasActiveDriveUploads() }).catch(() => {});
    }
    return;
  }
  if (type === "drive.file.added" || type === "drive.file.anchored" || type === "drive.file.not_onchain") {
    if (Date.now() < Number(state.drive.suppressTreeRefreshUntil || 0)) return;
    if (els.driveModal && !els.driveModal.classList.contains("hidden")) {
      fetchDriveTree(state.drive.currentPath || "/", { tree: false }).catch(() => {});
    }
    return;
  }
  if (type === "chat.snapshot.updated") {
    if (!state.wallet.loggedIn) return;
    refreshChatUnreadBadge().catch(() => {});
    if (!isDomainLoaded("chat")) return;
    const now = Date.now();
    if (now - Number(state.chat.lastSnapshotUiRefreshAt || 0) < 2000) return;
    state.chat.lastSnapshotUiRefreshAt = now;
    if (!Object.keys(state.chat.pairs || {}).length) {
      scheduleChatThreadsRefresh(60);
      return;
    }
    if (state.chat.activeWalletId) {
      refreshCurrentChatDirectStatus()
        .then(() => {
          updateChatUserRow(state.chat.activeWalletId) || renderChatUsers();
          renderChatStatusBar();
        })
        .catch(() => {});
    } else {
      renderChatUsers();
      renderChatStatusBar();
    }
    return;
  }
  if (type === "chat.message.appended") {
    const message = payload?.message && typeof payload.message === "object" ? payload.message : payload;
    if (!message || typeof message !== "object") return;
    const walletId = String(message?.walletId || message?.peerWalletId || "").trim();
    if (!walletId) return;
    const isUnreadIncoming = shouldTreatIncomingMessageAsUnread(message);
    const orderId = chatMessageOrderId(message);
    if (!isDomainLoaded("chat")) {
      if (isUnreadIncoming) {
        if (orderId) {
          markOrderChatUnread(orderId, 1);
          playChatNotificationSound();
          return;
        }
        const pair = threadByWalletId(walletId);
        upsertChatPair(walletId, {
          inList: true,
          summaryLoaded: false,
          displayName: String(message?.displayName || pair?.displayName || walletId),
          lastMessage: chatMessagePreviewText(String(message?.text || "")),
          lastTs: String(message?.ts || new Date().toISOString()),
          lastMessageAt: String(message?.ts || new Date().toISOString()),
          lastTransport: String(message?.transport || ""),
          unreadCount: Math.max(0, Number(pair?.unreadCount || 0)) + 1,
        });
        rebuildChatPairCollections();
        state.chat.buttonHasUnread = true;
        state.chat.buttonUnreadLatched = true;
        renderChatBadge();
        playChatNotificationSound();
      }
      return;
    }
    const reconciledPending = reconcilePendingLocalMessage(message, {
      walletId,
      mode: orderId ? "order" : "global",
      orderId,
    });
    upsertChatPair(walletId, {
      inList: true,
      summaryLoaded: true,
      displayName: String(message?.displayName || threadByWalletId(walletId)?.displayName || walletId),
      lastMessage: chatMessagePreviewText(String(message?.text || "")),
      lastTs: String(message?.ts || new Date().toISOString()),
      lastMessageAt: String(message?.ts || new Date().toISOString()),
      lastTransport: String(message?.transport || ""),
    });
    let messageChanged = reconciledPending;
    if (!reconciledPending && (messageBelongsToCurrentChat(message) || isChatThreadLoaded(walletId, orderId ? "order" : "global", orderId))) {
      messageChanged = upsertChatMessageInCache(message, {
        walletId,
        mode: orderId ? "order" : "global",
        orderId,
      }) || messageChanged;
    }
    const serverMsgId = String(message?.msgId || "").trim();
    if (serverMsgId) {
      state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((m) => String(m?.msgId || "") !== serverMsgId);
    }
    if (isUnreadIncoming) {
      if (orderId) {
        markOrderChatUnread(orderId, 1);
      } else {
        const pair = threadByWalletId(walletId);
        upsertChatPair(walletId, {
          unreadCount: Math.max(0, Number(pair?.unreadCount || 0)) + 1,
        });
        markChatButtonUnread(1);
      }
      playChatNotificationSound();
    } else if (messageBelongsToCurrentChat(message)) {
      upsertChatPair(walletId, {
        unreadCount: 0,
      });
    }
    rebuildChatPairCollections();
    if (els.chatModal && !els.chatModal.classList.contains("hidden")) {
      renderChatUsers();
      if (messageChanged && messageBelongsToCurrentChat(message)) {
        paintChatMessages(buildRenderableChatMessages());
        if (String(message?.direction || "") === "in") scheduleMarkActiveChatThreadRead(80);
      }
    }
    return;
  }
  if (type === "chat.status.updated") {
    const walletId = String(payload?.walletId || "").trim();
    if (!walletId) return;
    if (payload?.directConnected === true) removeChatConnectState(walletId);
    upsertChatPair(walletId, {
      __forceConnectionStatus: true,
      directConnected: payload?.directConnected === true,
      connecting: payload?.connecting === true,
      presenceStatus: String(payload?.presenceStatus || ""),
      statusLabel: String(payload?.statusLabel || ""),
      activeSessionId: String(payload?.activeSessionId || ""),
      inList: true,
      summaryLoaded: true,
    });
    rebuildChatPairCollections();
    if (state.chat.activeWalletId === walletId) {
      renderChatStatusBar(payload);
    }
    updateChatUserRow(walletId) || renderChatUsers();
    return;
  }
  if (type === "order.snapshot.updated") {
    setDomainLoaded("order", true);
    const incomingOrders = Array.isArray(payload?.orders) ? payload.orders : null;
    if (incomingOrders) {
      const previousById = new Map((Array.isArray(state.orders) ? state.orders : []).map((order) => [String(order?.id || ""), order]));
      const baselineWasReady = hydrateOrderNotificationBaselineFromStorage();
      const previousSignatures = { ...(state.ui?.orderNotifications?.signatures || {}) };
      trackOrderNotifications(incomingOrders);
      state.orders = incomingOrders;
      if (baselineWasReady || previousById.size > 0) {
        incomingOrders.forEach((order) => {
          const id = String(order?.id || order?.orderId || "");
          const previous = previousById.get(id);
          maybeOpenBuyerShipNotice(previous, order);
          maybeOpenOrderUpdateNotice(previous, order, { previousSignature: previousSignatures[id] || "" });
        });
      }
    }
    renderOrders();
    return;
  }
  if (type === "order.updated") {
    setDomainLoaded("order", true);
    const row = payload?.order && typeof payload.order === "object" ? payload.order : payload;
    const id = String(row?.id || row?.orderId || "").trim();
    if (!id) return;
    const next = Array.isArray(state.orders) ? state.orders.slice() : [];
    const idx = next.findIndex((item) => String(item?.id || "") === id);
    const previousOrder = idx >= 0 ? next[idx] : null;
    if (idx >= 0) next[idx] = { ...next[idx], ...row };
    else next.push(row);
    const baselineWasReady = hydrateOrderNotificationBaselineFromStorage();
    const previousSignatures = { ...(state.ui?.orderNotifications?.signatures || {}) };
    trackOrderNotifications(next);
    state.orders = next;
    if (baselineWasReady || Boolean(previousOrder) || idx < 0) {
      const nextOrder = idx >= 0 ? next[idx] : row;
      maybeOpenBuyerShipNotice(previousOrder, nextOrder);
      maybeOpenOrderUpdateNotice(previousOrder, nextOrder, {
        previousSignature: previousSignatures[id] || "",
        allowWithoutBaseline: idx < 0,
      });
    }
    renderOrders();
    return;
  }
  if (type === "catalog.snapshot.updated") {
    setDomainLoaded("catalog", true);
    state.currentMerchantId = String(payload.currentMerchantId || state.currentMerchantId || "");
    const incomingMerchants = Array.isArray(payload.merchants) ? payload.merchants : null;
    const incomingCategories = Array.isArray(payload.categories) ? payload.categories : null;
    const incomingProducts = Array.isArray(payload.products) ? payload.products : null;
    if (incomingMerchants) {
      state.merchants = incomingMerchants;
    }
    if (incomingCategories) {
      state.categories = normalizeCatalogCategories(incomingCategories);
    }
    if (incomingProducts) {
      state.products = normalizeCatalogProducts(incomingProducts);
    }
    renderMerchants();
    renderBuyerProducts();
    renderCategories();
    renderSellerProducts();
    return;
  }
  if (type === "catalog.category.added" || type === "catalog.category.updated" || type === "catalog.category.deleted") {
    if (!isDomainLoaded("catalog")) return;
    const row = payload?.category && typeof payload.category === "object" ? payload.category : payload;
    const id = String(row?.id || "").trim();
    if (!id) return;
    const next = Array.isArray(state.categories) ? state.categories.slice() : [];
    const idx = next.findIndex((item) => String(item?.id || "") === id);
    const merged = normalizeCatalogCategories([{
      ...(idx >= 0 ? next[idx] : {}),
      ...row,
      deleted: type === "catalog.category.deleted" ? true : Boolean(row?.deleted),
    }])[0];
    if (idx >= 0) next[idx] = merged;
    else next.push(merged);
    state.categories = next;
    renderBuyerProducts();
    renderCategories();
    renderSellerProducts();
    return;
  }
  if (type === "catalog.product.added" || type === "catalog.product.updated" || type === "catalog.product.deleted") {
    if (!isDomainLoaded("catalog")) return;
    const row = payload?.product && typeof payload.product === "object" ? payload.product : payload;
    const id = String(row?.id || "").trim();
    if (!id) return;
    const next = Array.isArray(state.products) ? state.products.slice() : [];
    const idx = next.findIndex((item) => String(item?.id || "") === id);
    const merged = normalizeCatalogProducts([{
      ...(idx >= 0 ? next[idx] : {}),
      ...row,
      deleted: type === "catalog.product.deleted" ? true : Boolean(row?.deleted),
    }])[0];
    if (idx >= 0) next[idx] = merged;
    else next.push(merged);
    state.products = next;
    renderBuyerProducts();
    renderSellerProducts();
    return;
  }
  if (type === "profile.snapshot.updated") {
    if (payload?.profile) state.profile = payload.profile;
    if (payload?.steward) state.steward = payload.steward;
    if (payload?.walletShadow) state.walletShadow = payload.walletShadow;
    if (Array.isArray(payload?.users)) state.users = payload.users;
    if (Object.prototype.hasOwnProperty.call(payload || {}, "currentMerchantId")) {
      state.currentMerchantId = String(payload.currentMerchantId || state.currentMerchantId || "m-local");
    }
    syncProfileEditorFromServer();
    renderHeader();
    renderOrders();
  }
}

function bindUiEventHandlers() {
}

function setLoginMode(mode) {
  const hasWallet = Boolean(state.wallet.exists);
  const safeMode = (!hasWallet && mode === "password") ? "create" : mode;
  state.auth.mode = safeMode;
  const isPassword = safeMode === "password";
  const isCreate = safeMode === "create";
  const isImport = safeMode === "import";
  els.tabLoginPassword.classList.toggle("hidden", !hasWallet);
  els.tabLoginPassword.hidden = !hasWallet;
  els.tabLoginPassword.style.display = hasWallet ? "" : "none";
  els.tabLoginPassword.classList.toggle("active", safeMode === "password");
  els.tabLoginCreate.classList.toggle("active", safeMode === "create");
  els.tabLoginImport.classList.toggle("active", safeMode === "import");
  els.loginPasswordWrap.classList.toggle("hidden", false);
  els.loginMnemonicWrap.classList.toggle("hidden", isPassword);
  els.loginMnemonicWrap.hidden = isPassword;
  els.loginMnemonicWrap.style.display = isPassword ? "none" : "grid";
  els.loginMnemonic.readOnly = false;
  els.loginMnemonic.placeholder = isCreate
    ? tr("login_mnemonic_create_placeholder", "Click Auto Generate to get a mnemonic and back it up")
    : tr("login_mnemonic_placeholder", "Enter 12/24-word mnemonic");
  els.btnGenerateMnemonic.classList.toggle("hidden", !isCreate);
  els.btnGenerateMnemonic.disabled = !isCreate;
  if (isPassword) setLoginHintByMode("password");
  if (isCreate) setLoginHintByMode("create");
  if (isImport) setLoginHintByMode("import");
  if (!isCreate) state.auth.createReady = false;
}

function setLoginHintByMode(mode) {
  if (mode === "password") els.loginHint.textContent = tr("login_hint_password");
  if (mode === "create") els.loginHint.textContent = tr("login_hint_create");
  if (mode === "import") els.loginHint.textContent = tr("login_hint_import");
}

function showLoadingModal(message = tr("loading_home_data", "Loading home data...")) {
  if (els.loadingHint) els.loadingHint.textContent = String(message || tr("loading_home_data", "Loading home data..."));
  if (els.loadingModal) els.loadingModal.classList.remove("hidden");
}

function hideLoadingModal() {
  if (els.loadingModal) els.loadingModal.classList.add("hidden");
}

async function runPostLoginBootstrap(initialBootstrap = null) {
  showLoadingModal(tr("loading_home_data", "Loading home data..."));
  try {
    resetLazyDomainsForLogin();
    const bootstrap = initialBootstrap || await fetchBootstrapDomains(CORE_BOOTSTRAP_DOMAINS);
    applyBootstrapLitePayload(bootstrap, { render: false });
    try {
      const tradeBootstrap = await fetchBootstrapDomains(["catalog", "order"]);
      applyBootstrapLitePayload(tradeBootstrap, { render: false });
    } catch (_) {}
    if (!isDomainLoaded("catalog") || !isDomainLoaded("order")) {
      try {
        const missingTradeDomains = [];
        if (!isDomainLoaded("catalog")) missingTradeDomains.push("catalog");
        if (!isDomainLoaded("order")) missingTradeDomains.push("order");
        const localTradeBootstrap = await api(`/api/bootstrap-lite?domains=${encodeURIComponent(missingTradeDomains.join(","))}`, { silent: true });
        applyBootstrapLitePayload(localTradeBootstrap, { render: false });
      } catch (_) {}
    }
    showLoadingModal(tr("loading_balance_profile", "Loading balance and profile..."));
    if (!E2E_UI_MODE) {
      refreshWalletSendPreflightFromServer({
        silent: true,
        readyReason: tr("wallet_ready_reason_recovered", "Wallet state recovered and send precheck passed"),
      }).catch(() => {
        restoreWalletSendPreflight();
      });
      connectEventStream();
    }
    renderAll();
    const repairTradeDomainsAfterLogin = async () => {
      const missingTradeDomains = [];
      if (!isDomainLoaded("catalog")) missingTradeDomains.push("catalog");
      if (!isDomainLoaded("order")) missingTradeDomains.push("order");
      if (!missingTradeDomains.length) return;
      try {
        const repaired = await api(`/api/bootstrap-lite?domains=${encodeURIComponent(missingTradeDomains.join(","))}`, { silent: true });
        applyBootstrapLitePayload(repaired, { render: true });
      } catch (_) {}
    };
    window.setTimeout(() => { void repairTradeDomainsAfterLogin(); }, 300);
    if (!E2E_UI_MODE) window.setTimeout(() => {
      if (!state.wallet.loggedIn) return;
      refreshStateLite().catch(() => {});
    }, 450);
    if (!E2E_UI_MODE) window.setTimeout(() => {
      if (!state.wallet.loggedIn) return;
      if (state.ui.walletViewActive !== true) return;
      ensureDomainLoaded("walletLedger", { render: true }).catch(() => {
        refreshWalletHistory().catch(() => {});
      });
    }, 0);
  } finally {
    hideLoadingModal();
  }
}

async function initAuthGate() {
  const status = await api("/api/wallet/status");
  state.wallet.exists = Boolean(status.exists);
  state.wallet.loggedIn = Boolean(status.loggedIn);
  state.wallet.network = String(status.network || state.wallet.network || "");
  state.wallet.chain = String(status.chain || state.wallet.chain || "");
  if (status.walletState) {
    applyWalletStatePreflight(status.walletState, {
      readyReason: tr("wallet_index_ready", "Wallet index is ready and send precheck passed"),
    });
  }
  if (!state.wallet.loggedIn) {
    setWalletSendPreflight(false, tr("wallet_login_required", "Please sign in to the wallet first"));
    state.ui.walletUiLoaded = false;
    state.ui.walletViewActive = false;
  }

  if (state.wallet.loggedIn) {
    els.loginModal.classList.add("hidden");
    return true;
  }

  els.loginPassword.value = "";
  els.loginMnemonic.value = "";
  state.auth.createReady = false;
  setLoginMode(state.wallet.exists ? "password" : "create");
  if (!state.wallet.exists) {
    els.loginHint.textContent = tr("login_hint_no_wallet");
  }
  els.loginModal.classList.remove("hidden");
  return false;
}

function applyServerState(s, options = {}) {
  const token = Math.max(0, Number(options?.token || 0));
  const appliedToken = Math.max(0, Number(state.ui.appliedServerStateToken || 0));
  if (token > 0 && token < appliedToken) return false;
  if (token > 0) state.ui.appliedServerStateToken = token;
  const profileBaseSignature = String(state.ui.profileFormSignature || "");
  const profileFormWasDirty = profileBaseSignature
    ? currentProfileFormSignature() !== profileBaseSignature
    : false;
  state.profile = s.profile || state.profile;
  state.steward = s.steward || state.steward;
  state.runtime = s.runtime || state.runtime;
  state.chatConfig = s.chatConfig || state.chatConfig;
  state.wallet = mergeWalletStateWithComputed(s.wallet || {}, state.wallet || {});
  state.walletShadow = s.walletShadow || state.walletShadow;
  if (s.jobState && typeof s.jobState === "object") state.jobState = s.jobState;
  if (s.commandQueue && typeof s.commandQueue === "object") state.commandQueue = s.commandQueue;
  const incomingSync = s.sync && typeof s.sync === "object" ? s.sync : null;
  if (!shouldIgnoreIncomingSyncSnapshot(incomingSync)) {
    state.sync = options?.replaceSync === true
      ? { ...(incomingSync || {}) }
      : mergeServerSyncState(state.sync, incomingSync);
  }
  maybeClearSyncResetDisplay(state.sync);
  const currentEpoch = syncSnapshotSessionEpoch(state.sync);
  if (currentEpoch > 0 && currentEpoch >= Math.max(0, Number(state.ui?.minSyncSessionEpoch || 0))) {
    state.ui.minSyncSessionEpoch = currentEpoch;
  }
  const allowTradeDomains = options?.allowTradeDomains === true;
  if (Array.isArray(s.orders) && s.orders.length > 0) {
    setDomainLoaded("order", true);
  }
  if (
    (Array.isArray(s.merchants) && s.merchants.length > 0)
    || (Array.isArray(s.categories) && s.categories.length > 0)
    || (Array.isArray(s.products) && s.products.length > 0)
  ) {
    setDomainLoaded("catalog", true);
  }
  if (Object.prototype.hasOwnProperty.call(s || {}, "currentMerchantId")) {
    state.currentMerchantId = String(s.currentMerchantId || state.currentMerchantId || "m-local");
  }
  if (isDomainLoaded("catalog")) {
    if (Array.isArray(s.merchants)) {
      const shouldReplaceMerchants = allowTradeDomains
        || s.merchants.length > 0
        || !Array.isArray(state.merchants)
        || state.merchants.length === 0;
      if (shouldReplaceMerchants) state.merchants = s.merchants;
    }
    if (Array.isArray(s.categories)) {
      const shouldReplaceCategories = allowTradeDomains
        || s.categories.length > 0
        || !Array.isArray(state.categories)
        || state.categories.length === 0;
      if (shouldReplaceCategories) state.categories = normalizeCatalogCategories(s.categories);
    }
    if (Array.isArray(s.products)) {
      const shouldReplaceProducts = allowTradeDomains
        || s.products.length > 0
        || !Array.isArray(state.products)
        || state.products.length === 0;
      if (shouldReplaceProducts) state.products = normalizeCatalogProducts(s.products);
    }
  }
  if (Array.isArray(s.users)) state.users = s.users;
  if (isDomainLoaded("order") && Array.isArray(s.orders)) {
    const shouldReplaceOrders = allowTradeDomains
      || s.orders.length > 0
      || !Array.isArray(state.orders)
      || state.orders.length === 0;
    if (shouldReplaceOrders) {
      const previousById = new Map((Array.isArray(state.orders) ? state.orders : []).map((order) => [String(order?.id || order?.orderId || ""), order]));
      const baselineWasReady = hydrateOrderNotificationBaselineFromStorage();
      const previousSignatures = { ...(state.ui?.orderNotifications?.signatures || {}) };
      trackOrderNotifications(s.orders);
      state.orders = s.orders;
      if (baselineWasReady || previousById.size > 0) {
        s.orders.forEach((order) => {
          const id = String(order?.id || order?.orderId || "");
          const previous = previousById.get(id) || null;
          maybeOpenBuyerShipNotice(previous, order);
          maybeOpenOrderUpdateNotice(previous, order, { previousSignature: previousSignatures[id] || "" });
        });
      }
    }
  }
  if (s.chat) {
    state.chat.unreadTotal = Number(s.chat.unreadTotal || 0);
    state.chat.buttonHasUnread = Boolean(s.chat.buttonHasUnread);
    state.chat.directThreads = Number(s.chat.directThreads || 0);
    state.chat.needsProfilePublish = Boolean(s.chat.needsProfilePublish);
    state.chat.legacyProfileReanchorQueued = Boolean(s.chat.legacyProfileReanchorQueued);
    state.chat.migrationNotice = localizeChatNotice(s.chat.migrationNotice || "");
  }
  if (!state.chat.needsProfilePublish) {
    state.ui.lastChatMigrationNotice = "";
  } else if (state.chat.migrationNotice && state.ui.lastChatMigrationNotice !== state.chat.migrationNotice) {
    state.ui.lastChatMigrationNotice = state.chat.migrationNotice;
    toast(localizeChatNotice(state.chat.migrationNotice));
  }

  const merchantsForBuyer = buyerMerchants();
  if (
    !state.selectedMerchantId
    || (
      state.selectedMerchantId !== BUYER_ALL_MERCHANTS
      && !merchantsForBuyer.some((m) => m.id === state.selectedMerchantId)
    )
  ) {
    const hasExternalProducts = (state.products || []).some((p) => !isOwnedProduct(p) && !(p?.deleted && Number(p?.deleteSync?.acked || 0) >= Number(p?.deleteSync?.total || 0)));
    state.selectedMerchantId = (merchantsForBuyer.length || hasExternalProducts) ? BUYER_ALL_MERCHANTS : "";
  }
  const ownCategories = sellerCategories();
  if (!state.selectedCategoryId || !ownCategories.some((c) => c.id === state.selectedCategoryId)) {
    state.selectedCategoryId = ownCategories[0]?.id || "";
  }
  const ownProducts = state.products.filter((p) => isOwnedProduct(p));
  if (!state.selectedSellerProductId || !ownProducts.some((p) => p.id === state.selectedSellerProductId)) {
    state.selectedSellerProductId = ownProducts[0]?.id || "";
  }
  syncProfileEditorFromServer(profileFormWasDirty);
  syncCategoryEditorFromServer();
  syncProductEditorFromServer();
  if (profileFormWasDirty && els.chatConfigStatus) {
    if (state.chat.needsProfilePublish) {
      els.chatConfigStatus.textContent = state.chat.migrationNotice || tr("chat_config_publish_required", "Save the chat profile and publish it on-chain before chatting.");
    } else {
      const enabledText = state.chatConfig.enabled === false ? tr("chat_config_status_disabled", "Disabled") : tr("chat_config_status_enabled", "Enabled");
      els.chatConfigStatus.textContent = trf("chat_config_status_line", { status: enabledText, mode: "v2" }, `Chat service: ${enabledText} | Transport: v2`);
    }
  }
  updateSaveProfileButtonState();
  renderChatBadge();
  if (state.chat.activeWalletId && !threadByWalletId(state.chat.activeWalletId)) {
    state.chat.activeWalletId = "";
  }
  if (els.walletAvailableBalanceView) {
    els.walletAvailableBalanceView.value = state.wallet.availableBsv === null ? "-" : fmt(state.wallet.availableBsv);
  }
  if (els.walletPendingBalanceView) {
    els.walletPendingBalanceView.value = state.wallet.selfChangePendingBsv === null ? "-" : formatSignedBsv(state.wallet.selfChangePendingBsv);
  }
  if (els.walletPendingIncomingBalanceView) {
    els.walletPendingIncomingBalanceView.value = state.wallet.unconfirmedIncomingBsv === null ? "-" : formatSignedBsv(state.wallet.unconfirmedIncomingBsv);
  }
  els.walletBalanceView.value = state.wallet.totalBsv === null ? "-" : fmt(state.wallet.totalBsv);
  if (state.wallet.totalBsv !== null && state.walletWatch.lastTotalSat === null) {
    state.walletWatch.lastTotalSat = Math.round(Number(state.wallet.totalBsv || 0) * 100000000);
  }
  els.walletReceiveView.value = state.walletReceiveAddress || "";
  renderReceiveQr();
  renderSendModalAvailableBalance();
  return true;
}

function applyChatConfigForm() {
  if (els.chatEnabled) els.chatEnabled.value = state.chatConfig.enabled === false ? "0" : "1";
  if (els.chatListenPort) els.chatListenPort.value = state.chatConfig.listenPort || 8787;
  if (els.chatPublicHost) els.chatPublicHost.value = state.chatConfig.publicHost || "";
  if (els.chatPublicPort) els.chatPublicPort.value = state.chatConfig.publicPort || state.chatConfig.listenPort || 8787;
  if (els.chatAllowOnchainInvite) els.chatAllowOnchainInvite.value = state.chatConfig.allowOnchainInvite === false ? "0" : "1";
  if (els.chatAutoPublishEndpoint) els.chatAutoPublishEndpoint.value = state.chatConfig.autoPublishEndpoint === false ? "0" : "1";
  if (els.chatConfigStatus) {
    if (state.chat.needsProfilePublish) {
      els.chatConfigStatus.textContent = state.chat.migrationNotice || tr("chat_config_publish_required", "Save the chat profile and publish it on-chain before chatting.");
    } else {
      const enabledText = state.chatConfig.enabled === false ? tr("chat_config_status_disabled", "Disabled") : tr("chat_config_status_enabled", "Enabled");
      els.chatConfigStatus.textContent = trf("chat_config_status_line", { status: enabledText, mode: "v2" }, `Chat service: ${enabledText} | Transport: v2`);
    }
  }
}

function editingGateStatus() {
  return profileEditingGateStatus();
}

function editingAllowed() {
  return editingGateStatus().ready === true;
}

function profileEditingGateStatus() {
  if (!state.wallet.exists) return { ready: false, reason: tr("wallet_not_created", "Wallet not created") };
  if (!state.wallet.loggedIn) return { ready: false, reason: tr("wallet_login_required", "Please sign in to the wallet first") };
  return { ready: true, reason: "" };
}

function profileEditingAllowed() {
  return profileEditingGateStatus().ready === true;
}

function requireProfileEditingAllowed(actionLabel = "Edit profile") {
  const gate = profileEditingGateStatus();
  if (gate.ready) return true;
  toast(trf("editing_unavailable", { actionLabel, reason: gate.reason || tr("wallet_login_required", "Please sign in to the wallet first") }, `${actionLabel} unavailable: ${gate.reason || "Please sign in to the wallet first"}`));
  return false;
}

function requireEditingAllowed(actionLabel = "Edit") {
  const gate = editingGateStatus();
  if (gate.ready) return true;
  toast(trf("editing_unavailable", { actionLabel, reason: gate.reason || tr("finish_sync_first", "finish sync first") }, `${actionLabel} unavailable: ${gate.reason || "finish sync first"}`));
  return false;
}

function currentProfileFormPayload() {
  return {
    profileName: String(els.profileName?.value || "").trim(),
    chatEnabled: els.chatEnabled?.value !== "0",
    chatListenPort: Number(els.chatListenPort?.value || 8787),
    chatPublicHost: String(els.chatPublicHost?.value || "").trim(),
    chatPublicPort: Number(els.chatPublicPort?.value || 8787),
    chatAllowOnchainInvite: els.chatAllowOnchainInvite?.value !== "0",
    chatAutoPublishEndpoint: els.chatAutoPublishEndpoint?.value !== "0",
  };
}

function catalogSyncEnabled() {
  return state?.steward?.catalogSyncEnabled !== false;
}

function profilePayloadFromStateSnapshot(snapshot = state) {
  return {
    profileName: String(snapshot?.profile?.name || "").trim(),
    chatEnabled: snapshot?.chatConfig?.enabled !== false,
    chatListenPort: Number(snapshot?.chatConfig?.listenPort || 8787),
    chatPublicHost: String(snapshot?.chatConfig?.publicHost || "").trim(),
    chatPublicPort: Number(snapshot?.chatConfig?.publicPort || snapshot?.chatConfig?.listenPort || 8787),
    chatAllowOnchainInvite: snapshot?.chatConfig?.allowOnchainInvite !== false,
    chatAutoPublishEndpoint: snapshot?.chatConfig?.autoPublishEndpoint !== false,
  };
}

function profilePayloadSignature(payload) {
  return JSON.stringify(payload || {});
}

function applyProfilePayloadToForm(payload = {}) {
  if (els.profileName) els.profileName.value = payload.profileName || "";
  if (els.chatEnabled) els.chatEnabled.value = payload.chatEnabled === false ? "0" : "1";
  if (els.chatListenPort) els.chatListenPort.value = payload.chatListenPort || 8787;
  if (els.chatPublicHost) els.chatPublicHost.value = payload.chatPublicHost || "";
  if (els.chatPublicPort) els.chatPublicPort.value = payload.chatPublicPort || 8787;
  if (els.chatAllowOnchainInvite) els.chatAllowOnchainInvite.value = payload.chatAllowOnchainInvite === false ? "0" : "1";
  if (els.chatAutoPublishEndpoint) els.chatAutoPublishEndpoint.value = payload.chatAutoPublishEndpoint === false ? "0" : "1";
}

function syncStewardFormFromState() {
  if (els.regionPriority) els.regionPriority.value = String(state.steward?.regionPriority || "local");
  if (els.pollSec) els.pollSec.value = Number(state.steward?.pollSec || 15);
  if (els.replayWindow) els.replayWindow.value = Number(state.steward?.replayWindow || 120);
  if (els.catalogSyncEnabled) els.catalogSyncEnabled.value = catalogSyncEnabled() ? "1" : "0";
  if (els.stewardText) {
    els.stewardText.textContent = catalogSyncEnabled()
      ? tr("catalog_sync_enabled_hint", "商品同步已开启。进入买家页/卖家页时可加载商品市场数据。")
      : tr("catalog_sync_disabled_hint", "商品同步已关闭。不会自动加载或手动同步商品市场数据。");
  }
}

async function runBuyerProductPurchase(productId) {
  const safeProductId = String(productId || "").trim();
  const product = productById(safeProductId);
  if (!product) return toast(tr("product_not_found", "Product not found"));
  try {
    const quantity = Math.max(1, Math.floor(Number(els.productDetailQuantity?.value || 1)));
    const stock = Math.max(0, Math.floor(Number(product.stock || 0)));
    if (stock > 0 && quantity > stock) {
      toast(trf("order_quantity_exceeds_stock", { quantity, stock }, `库存不足，当前库存 ${stock}，不能下单 ${quantity} 件。`));
      return;
    }
    const confirmed = await openOrderPurchaseConfirmModal(product, quantity);
    if (!confirmed) return;
    setDomainLoaded("order", true);
    rememberLocalOrderCreateIntent(safeProductId, quantity);
    await callAndRefresh(() => runSynchronousChainAction(
      tr("order_place_progress_title", "生成订单并广播"),
      () => api("/api/orders/place", {
        method: "POST",
        body: { productId: safeProductId, quantity },
        timeoutMs: ORDER_CHAIN_OP_TIMEOUT_MS,
      }),
      { summary: tr("order_place_progress_summary", "正在生成订单交易并广播...") },
    ), {
      beforeApply: (result) => rememberLocalOrdersFromState(result?.state, {
        productId: safeProductId,
        quantity,
      }),
    });
    closeProductDetailModal();
  } catch (err) {
    console.error("[buyer-product-purchase-failed]", {
      productId: safeProductId,
      error: String(err?.message || err || ""),
    });
    toast(err?.message || tr("order_place_failed", "Order creation failed"));
  }
}

function findOrderById(orderId) {
  const safeOrderId = String(orderId || "").trim();
  if (!safeOrderId) return null;
  return (Array.isArray(state.orders) ? state.orders : [])
    .find((item) => String(item?.id || item?.orderId || "").trim() === safeOrderId) || null;
}

async function runOrderChainActionWithProgress(orderId, action, options = {}) {
  const safeOrderId = String(orderId || "").trim();
  const safeAction = String(action || "").trim();
  const progressTitle = String(options.progressTitle || tr("tx_progress_push_title", "Publishing on-chain"));
  const order = options.order && typeof options.order === "object" ? options.order : findOrderById(safeOrderId);
  const body = {
    action: safeAction,
    transitionId: String(options.transitionId || `${safeAction}:${safeOrderId}:${Date.now()}`),
  };
  if (order) body.order = order;
  if (options.extraBody && typeof options.extraBody === "object") Object.assign(body, options.extraBody);
  rememberLocalOrderMutation(safeOrderId);
  return callAndRefresh(() => runSynchronousChainAction(
    progressTitle,
    () => api(`/api/orders/${encodeURIComponent(safeOrderId)}/action`, {
      method: "POST",
      body,
      timeoutMs: ORDER_CHAIN_OP_TIMEOUT_MS,
    }),
    { summary: String(options.progressSummary || tr("tx_progress_step_broadcast", "Broadcasting transaction")) },
  ), {
    beforeApply: (result) => rememberLocalOrdersFromState(result?.state, { orderIds: [safeOrderId] }),
  });
}

function openConflictModal(options = {}) {
  return new Promise((resolve) => {
    state.ui.conflictResolver = resolve;
    state.ui.conflictCloseValue = Object.prototype.hasOwnProperty.call(options, "closeValue")
      ? options.closeValue
      : null;
    state.ui.conflictCancelValue = Object.prototype.hasOwnProperty.call(options, "cancelValue")
      ? options.cancelValue
      : false;
    state.ui.conflictConfirmValue = Object.prototype.hasOwnProperty.call(options, "confirmValue")
      ? options.confirmValue
      : true;
    if (els.conflictModalTitle) els.conflictModalTitle.textContent = String(options.title || tr("conflict_modal_title", "Data conflict detected"));
    if (els.conflictModalMessage) els.conflictModalMessage.textContent = String(options.message || tr("conflict_modal_message", "The database value has changed. Choose how to proceed."));
    if (els.btnCancelConflictModal) els.btnCancelConflictModal.textContent = String(options.cancelLabel || tr("btnConflictCancel", "Use latest data"));
    if (els.btnConfirmConflictModal) els.btnConfirmConflictModal.textContent = String(options.confirmLabel || tr("btnConflictConfirm", "Keep my changes"));
    if (els.conflictModal) els.conflictModal.classList.remove("hidden");
    setTimeout(() => {
      if (els.btnConfirmConflictModal) els.btnConfirmConflictModal.focus();
    }, 0);
  });
}

function closeConflictModal(result = null) {
  if (els.conflictModal) els.conflictModal.classList.add("hidden");
  const resolver = state.ui.conflictResolver;
  state.ui.conflictResolver = null;
  state.ui.conflictCloseValue = null;
  state.ui.conflictCancelValue = null;
  state.ui.conflictConfirmValue = null;
  if (typeof resolver === "function") resolver(result);
}

async function openShipmentInfoModal(order = null) {
  const productName = order ? orderProductTitle(order) : "";
  if (els.shipmentInfoMessage) {
    els.shipmentInfoMessage.textContent = productName
      ? trf("seller_ship_info_message_with_product", { product: productName }, `请输入发货信息，最多 100 个字符。商品：${productName}`)
      : tr("seller_ship_info_message", "请输入发货信息，最多 100 个字符。");
  }
  if (els.shipmentInfoInput) {
    els.shipmentInfoInput.value = "";
    els.shipmentInfoInput.maxLength = 100;
  }
  if (els.shipmentInfoModal) els.shipmentInfoModal.classList.remove("hidden");
  setTimeout(() => {
    try { els.shipmentInfoInput?.focus(); } catch (_) {}
  }, 0);
  return new Promise((resolve) => {
    state.ui.shipmentInfoResolver = resolve;
  });
}

function closeShipmentInfoModal(confirmed = false) {
  const resolver = state.ui.shipmentInfoResolver;
  state.ui.shipmentInfoResolver = null;
  const value = String(els.shipmentInfoInput?.value || "").trim();
  if (confirmed && value.length > 100) {
    state.ui.shipmentInfoResolver = resolver;
    toast(tr("seller_ship_info_too_long", "发货信息不能超过100个字符"));
    return;
  }
  if (els.shipmentInfoModal) els.shipmentInfoModal.classList.add("hidden");
  if (typeof resolver === "function") resolver(confirmed ? value : null);
}

function syncProfileEditorFromServer(profileFormWasDirty = null) {
  const payload = profilePayloadFromStateSnapshot(state);
  const latestSig = profilePayloadSignature(payload);
  const baseSig = String(state.ui.profileFormSignature || "");
  const currentSig = currentProfileFormSignature();
  const dirty = profileFormWasDirty === null
    ? (baseSig ? currentSig !== baseSig : false)
    : profileFormWasDirty;
  state.ui.profileLatestSignature = latestSig;
  if (!dirty) {
    applyProfilePayloadToForm(payload);
    syncStewardFormFromState();
    state.ui.profileFormSignature = latestSig;
    state.ui.profileLatestSignature = latestSig;
    state.ui.profileConflictPending = false;
    updateSaveProfileButtonState();
    return;
  }
  if (latestSig !== baseSig && latestSig !== currentSig) {
    state.ui.profileConflictPending = true;
  } else {
    state.ui.profileConflictPending = false;
  }
  syncStewardFormFromState();
  updateSaveProfileButtonState();
}

function currentProfileFormSignature() {
  return profilePayloadSignature(currentProfileFormPayload());
}

function updateSaveProfileButtonState() {
  if (!els.btnSaveProfile) return;
  const editable = profileEditingAllowed();
  const unchanged = currentProfileFormSignature() === String(state.ui.profileFormSignature || "");
  els.btnSaveProfile.disabled = !editable || unchanged;
}

function bindProfileDirtyTracking() {
  [
    els.profileName,
    els.chatEnabled,
    els.chatListenPort,
    els.chatPublicHost,
    els.chatPublicPort,
    els.chatConnectMode,
    els.chatRelayUrl,
    els.chatAllowOnchainInvite,
    els.chatFallbackToOnchain,
    els.chatAutoPublishEndpoint,
  ].filter(Boolean).forEach((el) => {
    el.addEventListener("input", updateSaveProfileButtonState);
    el.addEventListener("change", updateSaveProfileButtonState);
  });
}

function isChatModalOpen() {
  return Boolean(els.chatModal && !els.chatModal.classList.contains("hidden"));
}

function isDocumentActive() {
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return document.visibilityState === "visible" && focused;
}

function shouldTreatIncomingMessageAsUnread(message = {}) {
  if (String(message?.direction || "").toLowerCase() !== "in") return false;
  if (isChatModalOpen() && messageBelongsToCurrentChat(message)) return false;
  return true;
}

function chatMessageOrderId(message = {}) {
  return String(message?.orderId || message?.order_id || "").trim();
}

function isOrderChatMessage(message = {}) {
  return Boolean(chatMessageOrderId(message));
}

function orderChatUnreadCount(orderId = "") {
  const id = String(orderId || "").trim();
  if (!id) return 0;
  return Math.max(0, Number(state.ui?.orderChatUnread?.[id] || 0));
}

function orderChatUnreadDotHtml(orderId = "") {
  return orderChatUnreadCount(orderId) > 0
    ? `<span class="order-chat-unread-dot" aria-hidden="true"></span>`
    : "";
}

function orderChatUnreadTotal() {
  return Object.values(state.ui?.orderChatUnread || {})
    .reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function markOrderChatUnread(orderId = "", increment = 1) {
  const id = String(orderId || "").trim();
  if (!id) return;
  const step = Math.max(1, Number(increment || 1));
  state.ui.orderChatUnread = {
    ...(state.ui.orderChatUnread || {}),
    [id]: Math.max(0, Number(state.ui.orderChatUnread?.[id] || 0)) + step,
  };
  renderOrders();
  if (String(state.ui?.orderDetail?.orderId || "") === id) renderOrderDetailModal();
  renderChatBadge();
}

function clearOrderChatUnread(orderId = "") {
  const id = String(orderId || "").trim();
  if (!id || !state.ui?.orderChatUnread?.[id]) return;
  const next = { ...(state.ui.orderChatUnread || {}) };
  delete next[id];
  state.ui.orderChatUnread = next;
  renderOrders();
  if (String(state.ui?.orderDetail?.orderId || "") === id) renderOrderDetailModal();
  renderChatBadge();
}

function markChatButtonUnread(increment = 1) {
  const step = Math.max(1, Number(increment || 1));
  state.chat.buttonHasUnread = true;
  state.chat.buttonUnreadLatched = true;
  state.chat.unreadTotal = Math.max(step, Math.max(0, Number(state.chat.unreadTotal || 0)) + step);
  renderChatBadge();
}

function clearChatButtonUnreadLatch() {
  state.chat.buttonUnreadLatched = false;
  state.chat.buttonHasUnread = Math.max(0, Number(state.chat.unreadTotal || 0)) > 0;
  renderChatBadge();
}

function ensureChatNotifyAudioReady() {
  if (chatNotifyAudioContext) {
    if (chatNotifyAudioContext.state === "suspended") {
      chatNotifyAudioContext.resume().catch(() => {});
    }
    return chatNotifyAudioContext;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    chatNotifyAudioContext = new AudioCtx();
    if (chatNotifyAudioContext.state === "suspended") {
      chatNotifyAudioContext.resume().catch(() => {});
    }
    return chatNotifyAudioContext;
  } catch (_) {
    return null;
  }
}

function playChatNotificationSound() {
  const now = Date.now();
  if (now - Number(state.chat.lastNotifyAt || 0) < 1200) return;
  state.chat.lastNotifyAt = now;
  const audioContext = ensureChatNotifyAudioReady();
  if (!audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startAt = Math.max(audioContext.currentTime, 0);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(932, startAt);
    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.exponentialRampToValueAtTime(0.035, startAt + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.18);
  } catch (_) {}
}

function renderChatBadge() {
  const unread = Math.max(0, Number(state.chat.unreadTotal || 0));
  const globalUnread = Math.max(0, unread - orderChatUnreadTotal());
  const hasUnread = !isChatModalOpen() && (globalUnread > 0 || Boolean(state.chat.buttonHasUnread) || Boolean(state.chat.buttonUnreadLatched));
  if (els.btnChat) {
    els.btnChat.classList.toggle("has-unread", hasUnread);
  }
  if (els.btnChatBadge) {
    els.btnChatBadge.classList.add("hidden");
  }
}

async function refreshChatConfigCard() {
  try {
    const configRes = await api("/api/chat/config");
    state.chatConfig = configRes.config || state.chatConfig;
    applyChatConfigForm();
    const identityRes = await api("/api/chat/identity");
    if (els.chatPubKey) els.chatPubKey.value = identityRes.identity?.chatPubKey || "";
    applyChatConfigForm();
    if (currentProfileFormSignature() === String(state.ui.profileFormSignature || "")) {
      const latestSig = profilePayloadSignature(profilePayloadFromStateSnapshot(state));
      state.ui.profileFormSignature = latestSig;
      state.ui.profileLatestSignature = latestSig;
      state.ui.profileConflictPending = false;
      updateSaveProfileButtonState();
    }
  } catch (err) {
    if (els.chatConfigStatus) els.chatConfigStatus.textContent = trf("chat_config_load_failed", { error: err.message }, `Chat service status: failed to load (${err.message})`);
  }
}

async function refreshChatUnreadBadge() {
  if (!state.wallet.loggedIn) return;
  const now = Date.now();
  if (now - Number(state.chat.lastUnreadRefreshAt || 0) < 2000) return;
  state.chat.lastUnreadRefreshAt = now;
  try {
    const r = await api("/api/chat/unread");
    state.chat.unreadTotal = Number(r.unreadTotal || 0);
    state.chat.buttonHasUnread = Boolean(r.buttonHasUnread);
    renderChatBadge();
  } catch (_) {}
}

async function refreshCurrentChatDirectStatus() {
  const walletId = String(state.chat.activeWalletId || "");
  if (!walletId) return null;
  return refreshChatDirectStatusForWallet(walletId, { render: true, activeOnly: true });
}

function getCachedChatDirectStatus(walletId = state.chat.activeWalletId) {
  const id = String(walletId || "").trim();
  if (!id) return null;
  const connectState = getChatConnectState(id);
  if (connectState?.phase === "connected") {
    return {
      walletId: id,
      directConnected: true,
      connecting: false,
      transport: "p2p",
      source: "connectState",
    };
  }
  const thread = threadByWalletId(id);
  if (thread?.directConnected === true) {
    return {
      ...thread,
      walletId: id,
      directConnected: true,
      connecting: false,
      transport: "p2p",
      source: "thread",
    };
  }
  return null;
}

async function refreshChatDirectStatusForWallet(walletId, options = {}) {
  const id = String(walletId || "").trim();
  if (!id) return null;
  const activeSeq = Number(state.chat.activeSwitchSeq || 0);
  try {
    const status = await api(`/api/chat/status?walletId=${encodeURIComponent(id)}`, { silent: options.silent === true });
    const localConnectState = getChatConnectState(id);
    const keepLocalConnecting = localConnectState?.phase === "connecting" && status?.directConnected !== true;
    upsertChatPair(id, {
      __forceConnectionStatus: true,
      directConnected: status?.directConnected === true,
      connecting: keepLocalConnecting ? true : status?.connecting === true,
      presenceStatus: String(status?.presenceStatus || ""),
      statusLabel: String(status?.statusLabel || ""),
      activeSessionId: String(status?.activeSessionId || ""),
    });
    rebuildChatPairCollections();
    if (status?.directConnected === true) {
      removeChatConnectState(id);
    } else if (status?.connecting === true) {
      const current = getChatConnectState(id);
      if (!current || current.phase !== "connecting") {
        beginChatConnectCountdown(id);
      }
    } else if (!keepLocalConnecting && (status?.transport === "p2p" || status?.presenceStatus === "chatable")) {
      removeChatConnectState(id);
    }
    if (options.render !== false) {
      updateChatUserRow(id) || renderChatUsers();
      if (options.activeOnly !== true || (state.chat.activeWalletId === id && Number(state.chat.activeSwitchSeq || 0) === activeSeq)) {
        renderChatStatusBar(status);
      }
    }
    return status;
  } catch (_) {
    return null;
  }
}

async function refreshVisibleChatDirectStatuses(options = {}) {
  if (state.chat.visibleStatusRefreshInFlight) return;
  state.chat.visibleStatusRefreshInFlight = true;
  const seq = Number(state.chat.statusRefreshSeq || 0) + 1;
  state.chat.statusRefreshSeq = seq;
  try {
    const walletIds = Array.from(new Set([]
      .concat(Array.isArray(state.chat.people) ? state.chat.people : [])
      .concat(Array.isArray(state.chat.friends) ? state.chat.friends : [])
      .concat(Array.isArray(state.chat.threads) ? state.chat.threads : [])
      .map((row) => String(row?.walletId || "").trim())
      .filter(Boolean)));
    await Promise.all(walletIds.map((walletId) => refreshChatDirectStatusForWallet(walletId, {
      silent: true,
      render: false,
    })));
    if (seq === Number(state.chat.statusRefreshSeq || 0)) {
      rebuildChatPairCollections();
      walletIds.forEach((walletId) => updateChatUserRow(walletId));
      renderChatStatusBar();
    }
  } finally {
    state.chat.visibleStatusRefreshInFlight = false;
  }
}

function stopChatStatusPolling() {
  if (state.chat?.statusPollTimer) {
    clearInterval(state.chat.statusPollTimer);
    state.chat.statusPollTimer = null;
  }
}

function ensureChatStatusPolling() {
  stopChatStatusPolling();
}

async function refreshChatThreads() {
  if (state.chat.threadsRefreshPromise) return state.chat.threadsRefreshPromise;
  const promise = (async () => {
    debugChatOpenPerf("threads_request_start");
    const startedAt = performance.now();
    const r = await api("/api/chat/open?limit=50");
    state.chat.lastThreadsLoadedAt = Date.now();
    state.chat.selfWalletId = String(r?.identity?.walletId || state.chat.selfWalletId || "");
    const rows = []
      .concat(Array.isArray(r.threads) ? r.threads : [])
      .concat(Array.isArray(r.people) ? r.people : [])
      .concat(Array.isArray(r.friends) ? r.friends : [])
      .concat(Array.isArray(r.recent) ? r.recent : []);
    rows
      .filter((row) => String(row?.walletId || "") !== String(state.chat.selfWalletId || ""))
      .forEach((row) => {
        upsertChatPair(row.walletId, {
          ...row,
          inList: true,
          summaryLoaded: true,
          lastTs: String(row?.lastTs || row?.lastMessageAt || ""),
        });
      });
    state.chat.selfState = mergeChatSelfState(state.chat.selfState, r.selfState);
    rebuildChatPairCollections();
    Object.keys(state.chat.connectStates || {}).forEach((walletId) => {
      const thread = threadByWalletId(walletId);
      if (thread?.directConnected === true) {
        removeChatConnectState(walletId);
      }
    });
    renderChatBadge();
    if (state.chat.activeWalletId && !threadByWalletId(state.chat.activeWalletId)) {
      setActiveChatWallet("");
    }
    renderChatStatusBar();
    debugChatOpenPerf("threads_request_done", {
      requestMs: Math.round(performance.now() - startedAt),
      rowCount: rows.length,
      pairCount: Object.keys(state.chat.pairs || {}).length,
    });
  })();
  state.chat.threadsRefreshPromise = promise;
  try {
    return await promise;
  } finally {
    if (state.chat.threadsRefreshPromise === promise) state.chat.threadsRefreshPromise = null;
  }
}

function scheduleChatThreadsRefresh(delayMs = 80) {
  if (state.chat?.refreshTimer) {
    clearTimeout(state.chat.refreshTimer);
    state.chat.refreshTimer = null;
  }
  state.chat.refreshTimer = setTimeout(async () => {
    state.chat.refreshTimer = null;
    try {
      await refreshChatThreads();
      if (els.chatModal && !els.chatModal.classList.contains("hidden")) {
        renderChatUsers();
        if (state.chat.activeWalletId) {
          paintChatMessages(buildRenderableChatMessages());
          refreshCurrentChatDirectStatus()
            .then(() => {
              updateChatUserRow(state.chat.activeWalletId) || renderChatUsers();
            })
            .catch(() => {});
        }
      }
    } catch (_) {}
  }, Math.max(0, Number(delayMs || 0)));
}

function renderPendingModalContent() {
  if (!els.pendingList || !els.pendingSummary) return;
  const rows = Array.isArray(state.sync.pendingDetails) ? state.sync.pendingDetails : [];
  const recoverableRows = Array.isArray(state.sync.recoverableDetails) ? state.sync.recoverableDetails : [];
  const estimatedTotalFeeSat = Number(state.sync.pendingEstimatedFeeSat || 0);
  const renderRecoverableRows = () => {
    if (els.recoverableSummary) {
      els.recoverableSummary.textContent = recoverableRows.length
        ? trf("recoverable_summary_count", { count: recoverableRows.length }, `${recoverableRows.length} recoverable unconfirmed broadcasts`)
        : tr("recoverable_summary_empty", "No recoverable unconfirmed broadcasts");
    }
    if (els.recoverableList) {
      els.recoverableList.innerHTML = recoverableRows.length
        ? recoverableRows.map((r) => {
          const when = r.broadcastedAt ? new Date(r.broadcastedAt).toLocaleString() : "-";
          const reason = r.lastError ? ` | ${escapeHtml(tr("error_label", "Error"))}: ${escapeHtml(r.lastError)}` : "";
          return `<div class="row"><p><strong>${escapeHtml(pendingEventLabel(r.eventType))}</strong> / ${escapeHtml(r.targetType || "-")} / ${escapeHtml(r.targetId || "-")}</p><p>${escapeHtml(trf("recoverable_item_line", { status: r.status || "-", when, rebroadcastCount: Number(r.rebroadcastCount || 0) }, `Status: ${r.status || "-"} | Broadcast: ${when} | Rebroadcasts: ${Number(r.rebroadcastCount || 0)}`))}${reason}</p><p class="mono">${escapeHtml(r.txid || "")}</p><div class="actions inline"><button type="button" data-recover-change-id="${escapeHtml(r.id)}">${escapeHtml(tr("recover_change_button", "Cancel and restore local reservation"))}</button></div></div>`;
        }).join("")
        : `<div class="row">${escapeHtml(tr("recoverable_none", "No unconfirmed broadcasts need recovery."))}</div>`;
    }
  };
  if (!rows.length) {
    els.pendingSummary.textContent = tr("pending_summary_empty", "No pending on-chain items");
    if (els.pendingFeeSummary) els.pendingFeeSummary.textContent = tr("pending_fee_summary_default", "Estimated fee: 0.00000000 BSV");
    els.pendingList.innerHTML = `<div class="row">${escapeHtml(tr("pending_queue_empty", "Queue is empty"))}</div>`;
    if (els.btnConfirmPushInModal) els.btnConfirmPushInModal.disabled = true;
    renderRecoverableRows();
    return;
  }
  els.pendingSummary.textContent = trf("pending_summary_count", { count: rows.length }, `${rows.length} pending publish records`);
  if (els.pendingFeeSummary) {
    els.pendingFeeSummary.textContent = trf("pending_fee_summary", { bsv: (estimatedTotalFeeSat / 100000000).toFixed(8), sat: estimatedTotalFeeSat }, `Estimated fee: ${(estimatedTotalFeeSat / 100000000).toFixed(8)} BSV (${estimatedTotalFeeSat} sat)`);
  }
  if (els.btnConfirmPushInModal) els.btnConfirmPushInModal.disabled = false;
  els.pendingList.innerHTML = rows.map((r) => {
    const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-";
    const payloadText = escapeHtml(JSON.stringify(r.payload || {}));
    const estSat = Number(r.estimatedFeeSat || 0);
    return `<div class="row"><p><strong>${escapeHtml(pendingEventLabel(r.eventType))}</strong> / ${escapeHtml(r.targetType || "-")} / ${escapeHtml(r.targetId || "-")}</p><p>${escapeHtml(trf("pending_item_line", { when, attempts: Number(r.attempts || 0), version: Number(r.schemaVersion || 0), estSat }, `Last modified: ${when} | Retries: ${Number(r.attempts || 0)} | Version: v${Number(r.schemaVersion || 0)} | Estimate: ${estSat} sat`))}</p><p class="mono">${payloadText}</p></div>`;
  }).join("");

  renderRecoverableRows();
}

async function openPendingModal() {
  if (els.pendingModal) els.pendingModal.classList.remove("hidden");
  if (els.pendingList) els.pendingList.innerHTML = `<div class="row">${escapeHtml(tr("pending_loading", "Loading pending publish items..."))}</div>`;
  if (els.recoverableList) els.recoverableList.innerHTML = `<div class="row">${escapeHtml(tr("recoverable_loading", "Loading recovery items..."))}</div>`;
  renderPendingModalContent();
  if (els.pendingPassword) els.pendingPassword.value = "";
  const token = issueServerStateToken();
  const preview = await api("/api/changes/preview");
  if (preview?.state) applyServerState(preview.state, { token });
  if (Number(preview?.pendingUploads || 0) <= 0 && Array.isArray(preview?.pendingDetails) && preview.pendingDetails.length === 0) {
    state.sync.pendingUploads = 0;
    state.sync.pendingDetails = [];
    state.sync.pendingEstimatedFeeSat = 0;
    state.sync.pendingEstimatedFeeBsv = 0;
    state.sync.pendingOversizeCount = 0;
  }
  if (Array.isArray(preview?.recoverableDetails)) {
    state.sync.recoverableDetails = preview.recoverableDetails.slice();
  }
  renderPendingModalContent();
}

async function refreshStateLite() {
  const token = issueServerStateToken();
  const shouldReadWalletBalance = Boolean(state.wallet?.loggedIn);
  const [r, syncStatus, walletStatus, walletBalance] = await Promise.all([
    api("/api/state-lite"),
    api("/api/sync/status", { silent: true }).catch(() => null),
    api("/api/wallet/status", { silent: true }).catch(() => null),
    shouldReadWalletBalance
      ? api("/api/wallet/balance", { silent: true }).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (r?.state?.sync && syncStatus?.sync) {
    mergeLiveSyncSnapshot(r.state.sync, syncStatus.sync);
  }
  if (r?.state) {
    const walletState = r.state.wallet && typeof r.state.wallet === "object" ? r.state.wallet : {};
    const mergedWallet = { ...walletState };
    if (walletStatus && typeof walletStatus === "object") {
      mergedWallet.exists = Boolean(walletStatus.exists);
      mergedWallet.loggedIn = Boolean(walletStatus.loggedIn);
      if (walletStatus.network) mergedWallet.network = String(walletStatus.network);
      if (walletStatus.chain) mergedWallet.chain = String(walletStatus.chain);
      if (walletStatus.walletState) {
        applyWalletStatePreflight(walletStatus.walletState, {
          readyReason: tr("wallet_index_ready", "Wallet index is ready and send precheck passed"),
        });
      }
    }
    if (walletBalance && walletBalance.success !== false) {
      const confirmedSat = Number(walletBalance.confirmed || 0);
      const availableSat = Number.isFinite(Number(walletBalance.available))
        ? Number(walletBalance.available || 0)
        : confirmedSat;
      const selfChangePendingSat = Number.isFinite(Number(walletBalance.selfChangePending))
        ? Number(walletBalance.selfChangePending || 0)
        : 0;
      const unconfirmedIncomingSat = Number.isFinite(Number(walletBalance.unconfirmedIncoming))
        ? Number(walletBalance.unconfirmedIncoming || 0)
        : (Number.isFinite(Number(walletBalance.unconfirmed)) ? Number(walletBalance.unconfirmed || 0) : 0);
      const totalSat = Number(walletBalance.total || 0);
      const unconfirmedSat = unconfirmedIncomingSat;
      mergedWallet.confirmedSat = confirmedSat;
      mergedWallet.confirmedBsv = confirmedSat / 100000000;
      mergedWallet.availableSat = availableSat;
      mergedWallet.availableBsv = availableSat / 100000000;
      mergedWallet.selfChangePendingSat = selfChangePendingSat;
      mergedWallet.selfChangePendingBsv = selfChangePendingSat / 100000000;
      mergedWallet.unconfirmedIncomingSat = unconfirmedIncomingSat;
      mergedWallet.unconfirmedIncomingBsv = unconfirmedIncomingSat / 100000000;
      mergedWallet.unconfirmedSat = unconfirmedSat;
      mergedWallet.unconfirmedBsv = unconfirmedSat / 100000000;
      mergedWallet.totalSat = totalSat;
      mergedWallet.totalBsv = totalSat / 100000000;
      mergedWallet.updatedAt = walletBalance.updatedAt || mergedWallet.updatedAt || null;
    }
    r.state.wallet = mergedWallet;
  }
  applyServerState(r.state, { token });
  if (state.wallet.loggedIn && (!isDomainLoaded("catalog") || !Array.isArray(state.products) || state.products.length === 0)) {
    try {
      const catalogPayload = await fetchBootstrapDomains(["catalog"]);
      applyBootstrapLitePayload(catalogPayload, { render: false });
    } catch (_) {}
  }
  renderAll();
}

function canSettleFunds() {
  return true;
}

function canPublishCatalog() {
  return true;
}

function threadByWalletId(walletId) {
  const id = String(walletId || "");
  const pair = state.chat.pairs?.[id];
  if (pair && typeof pair === "object") return pair;
  return (state.chat.threads || []).find((t) => String(t?.walletId || "") === id)
    || (state.chat.people || []).find((t) => String(t?.walletId || "") === id)
    || (state.chat.searchResults || []).find((t) => String(t?.walletId || "") === id)
    || null;
}

function defaultChatPair(walletId = "") {
  return {
    walletId: String(walletId || "").trim(),
    displayName: "",
    merchantId: "",
    directConnected: false,
    connecting: false,
    presenceStatus: "",
    statusLabel: "",
    activeSessionId: "",
    unreadCount: 0,
    lastMessage: "",
    lastMessageAt: "",
    lastTs: "",
    lastTransport: "",
    __listOrder: 0,
    isFriend: false,
    blocked: false,
    inList: false,
    summaryLoaded: false,
    threadEntries: {},
  };
}

function isWalletIdLike(value = "") {
  return /^wallet-[a-z0-9_-]+$/i.test(String(value || "").trim());
}

function isGeneratedChatName(value = "", walletId = "") {
  const name = String(value || "").trim();
  const id = String(walletId || "").trim();
  if (!name) return true;
  if (id && name === id) return true;
  return /^wallet-[a-z0-9_-]+$/i.test(name) || /^m-[a-z0-9_-]+$/i.test(name);
}

function resolveChatPairDisplayName(walletId, currentDisplayName = "", patchDisplayName = "") {
  const id = String(walletId || "").trim();
  const current = String(currentDisplayName || "").trim();
  const incoming = String(patchDisplayName || "").trim();
  const currentIsPlaceholder = isGeneratedChatName(current, id);
  const incomingIsPlaceholder = isGeneratedChatName(incoming, id);
  if (!incoming) return current;
  if (incomingIsPlaceholder && current && !currentIsPlaceholder) return current;
  return incoming;
}

function upsertChatPair(walletId, patch = {}) {
  const id = String(walletId || "").trim();
  if (!id) return null;
  const current = state.chat.pairs?.[id];
  const safePatch = patch && typeof patch === "object" ? { ...patch } : {};
  const forceConnectionStatus = safePatch.__forceConnectionStatus === true;
  delete safePatch.__forceConnectionStatus;
  if (Object.prototype.hasOwnProperty.call(safePatch, "displayName")) {
    safePatch.displayName = resolveChatPairDisplayName(id, current?.displayName, safePatch.displayName);
  }
  if (
    !forceConnectionStatus
    && current?.directConnected === true
    && safePatch.directConnected === false
    && safePatch.connecting !== true
  ) {
    delete safePatch.directConnected;
    if (String(safePatch.presenceStatus || "") !== "chatable") delete safePatch.presenceStatus;
    if (!safePatch.statusLabel) delete safePatch.statusLabel;
  }
  const next = {
    ...(current && typeof current === "object" ? current : defaultChatPair(id)),
    ...safePatch,
    walletId: id,
    __listOrder: Math.max(
      1,
      Number(current?.__listOrder || safePatch.__listOrder || 0)
        || Number(state.chat.nextPairListOrder++ || 1),
    ),
    threadEntries: {
      ...((current && typeof current.threadEntries === "object" && current.threadEntries) || {}),
      ...((safePatch && typeof safePatch.threadEntries === "object" && safePatch.threadEntries) || {}),
    },
  };
  state.chat.pairs = {
    ...(state.chat.pairs || {}),
    [id]: next,
  };
  return next;
}

function chatPairThreadEntryKey(mode = state.chat.mode, orderId = null) {
  const safeMode = String(mode || "global").trim() || "global";
  const safeOrderId = safeMode === "order"
    ? String(orderId ?? state.chat.activeOrderId ?? "").trim()
    : "";
  return `${safeMode}:${safeOrderId}`;
}

function getChatPairThreadEntry(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  const pair = threadByWalletId(walletId);
  if (!pair || typeof pair !== "object") return null;
  const key = chatPairThreadEntryKey(mode, orderId);
  return pair.threadEntries?.[key] && typeof pair.threadEntries[key] === "object"
    ? pair.threadEntries[key]
    : null;
}

function rebuildChatPairCollections() {
  const allPairs = Object.values(state.chat.pairs || {}).filter((row) => row && typeof row === "object" && row.inList === true);
  const sorted = allPairs.slice().sort((a, b) => {
    const oa = Math.max(0, Number(a?.__listOrder || 0));
    const ob = Math.max(0, Number(b?.__listOrder || 0));
    if (oa !== ob) return oa - ob;
    return String(a?.displayName || a?.walletId || "").localeCompare(String(b?.displayName || b?.walletId || ""));
  });
  state.chat.threads = sorted.slice();
  state.chat.people = sorted.slice();
  state.chat.friends = sorted.filter((row) => row?.isFriend === true);
  state.chat.recent = sorted.filter((row) => row?.isFriend !== true);
  state.chat.unreadTotal = sorted.reduce((sum, row) => sum + Math.max(0, Number(row?.unreadCount || 0)), 0);
  state.chat.buttonHasUnread = state.chat.unreadTotal > 0;
}

function hasLoadedChatSummaries() {
  return Object.values(state.chat.pairs || {}).some((row) => row && row.summaryLoaded === true);
}

function getChatConnectState(walletId) {
  const id = String(walletId || "").trim();
  if (!id) return null;
  const row = state.chat.connectStates?.[id];
  return row && typeof row === "object" ? row : null;
}

function clearChatConnectStateTimer(walletId) {
  const entry = getChatConnectState(walletId);
  if (entry?.timer) clearTimeout(entry.timer);
  if (entry?.clearTimer) clearTimeout(entry.clearTimer);
  if (entry) {
    entry.timer = null;
    entry.clearTimer = null;
  }
}

function setChatConnectState(walletId, patch = {}) {
  const id = String(walletId || "").trim();
  if (!id) return null;
  const prev = getChatConnectState(id) || {};
  const next = {
    ...prev,
    ...patch,
    walletId: id,
  };
  state.chat.connectStates = {
    ...(state.chat.connectStates || {}),
    [id]: next,
  };
  return next;
}

function removeChatConnectState(walletId) {
  const id = String(walletId || "").trim();
  if (!id || !state.chat.connectStates?.[id]) return;
  clearChatConnectStateTimer(id);
  const next = { ...(state.chat.connectStates || {}) };
  delete next[id];
  state.chat.connectStates = next;
}

function chatConnectRemainingSeconds(entry) {
  const deadlineAt = Number(entry?.deadlineAt || 0);
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}

function applyChatConnectStateToThread(thread) {
  if (!thread || typeof thread !== "object") return thread;
  const connectState = getChatConnectState(thread.walletId);
  if (!connectState) return thread;
  if (thread.directConnected === true) {
    return {
      ...thread,
      connectFailed: false,
    };
  }
  if (thread.connecting === true && connectState.phase === "failed") {
    return {
      ...thread,
      connectFailed: false,
    };
  }
  if (connectState.phase === "connecting") {
    return {
      ...thread,
      directConnected: false,
      connecting: true,
      connectCountdownSec: chatConnectRemainingSeconds(connectState),
      connectFailed: false,
    };
  }
  if (connectState.phase === "verifying") {
    return {
      ...thread,
      directConnected: false,
      connecting: true,
      connectVerifying: true,
      connectCountdownSec: chatConnectRemainingSeconds(connectState),
      connectFailed: false,
    };
  }
  if (connectState.phase === "failed") {
    return {
      ...thread,
      directConnected: false,
      connecting: false,
      connectFailed: true,
      connectError: String(connectState.error || ""),
    };
  }
  if (connectState.phase === "connected") {
    return {
      ...thread,
      directConnected: true,
      connecting: false,
      connectFailed: false,
      presenceStatus: "online",
      statusLabel: tr("chat_status_direct", "已连接"),
    };
  }
  return thread;
}

function renderChatConnectionFeedback() {
  if (state.chat.activeWalletId) updateChatUserRow(state.chat.activeWalletId);
  Object.keys(state.chat.connectStates || {}).forEach((walletId) => updateChatUserRow(walletId));
  renderChatStatusBar();
  if (state.chat.activeWalletId) {
    refreshCurrentChatDirectStatus().catch(() => null);
  }
}

async function pollChatConnectState(walletId) {
  const id = String(walletId || "").trim();
  const entry = getChatConnectState(id);
  if (!entry || !["connecting", "verifying"].includes(String(entry.phase || ""))) return;
  const remainingSec = chatConnectRemainingSeconds(entry);
  if (remainingSec <= 0) {
    if (entry.phase === "connecting") {
      setChatConnectState(id, {
        phase: "verifying",
        error: "",
        deadlineAt: Date.now() + 8000,
        timer: null,
      });
    } else {
      setChatConnectState(id, {
        phase: "failed",
        error: tr("chat_status_connect_failed", "连接失败"),
        timer: null,
      });
    }
    renderChatConnectionFeedback();
    return;
  }
  try {
    const status = await api(`/api/chat/status?walletId=${encodeURIComponent(id)}`, { silent: true });
    if (status?.directConnected === true) {
      clearChatConnectStateTimer(id);
      upsertChatPair(id, {
        inList: true,
        summaryLoaded: true,
        directConnected: true,
        connecting: false,
        presenceStatus: String(status?.presenceStatus || "online"),
        statusLabel: String(status?.statusLabel || tr("chat_status_direct", "已连接")),
        activeSessionId: String(status?.activeSessionId || ""),
      });
      rebuildChatPairCollections();
      setChatConnectState(id, {
        phase: "connected",
        connectedAt: Date.now(),
        timer: null,
      });
      renderChatConnectionFeedback();
      const clearTimer = setTimeout(async () => {
        removeChatConnectState(id);
        rebuildChatPairCollections();
        renderChatConnectionFeedback();
      }, 5000);
      clearTimer.unref?.();
      setChatConnectState(id, { clearTimer });
      return;
    }
  } catch (_) {}
  renderChatConnectionFeedback();
  const timer = setTimeout(() => {
    pollChatConnectState(id).catch(() => null);
  }, 1000);
  timer.unref?.();
  setChatConnectState(id, { timer });
}

function beginChatConnectCountdown(walletId) {
  const id = String(walletId || "").trim();
  if (!id) return;
  clearChatConnectStateTimer(id);
  setChatConnectState(id, {
    phase: "connecting",
    startedAt: Date.now(),
    deadlineAt: Date.now() + 30000,
    error: "",
    timer: null,
    clearTimer: null,
  });
  renderChatConnectionFeedback();
  pollChatConnectState(id).catch(() => null);
}

function failChatConnectCountdown(walletId, message = "") {
  const id = String(walletId || "").trim();
  if (!id) return;
  clearChatConnectStateTimer(id);
  setChatConnectState(id, {
    phase: "failed",
    error: String(message || tr("chat_status_connect_failed", "连接失败")),
    timer: null,
    clearTimer: null,
  });
  renderChatConnectionFeedback();
}

function verifyChatConnectAfterError(walletId, message = "") {
  const id = String(walletId || "").trim();
  if (!id) return;
  clearChatConnectStateTimer(id);
  setChatConnectState(id, {
    phase: "verifying",
    error: String(message || ""),
    deadlineAt: Date.now() + 8000,
    timer: null,
    clearTimer: null,
  });
  renderChatConnectionFeedback();
  pollChatConnectState(id).catch(() => null);
}

function currentChatThread() {
  return threadByWalletId(state.chat.activeWalletId);
}

function currentChatThreadTitle() {
  const thread = currentChatThread();
  const name = String(thread?.displayName || "").trim();
  if (name) return localizeDisplayName(name);
  return String(state.chat.activeWalletId || "").trim() || tr("chat_window_title", "聊天窗口");
}

function renderChatSurfaceTitle() {
  if (!els.chatTitle) return;
  const surfaceMode = String(state.chat.surfaceMode || "full");
  if (surfaceMode === "thread") {
    const contextTitle = String(state.chat.threadContext?.title || "").trim();
    els.chatTitle.textContent = contextTitle || currentChatThreadTitle();
    return;
  }
  els.chatTitle.textContent = tr("chat_window_title_with_list", "Chat window (contacts on the left)");
}

function setChatSurfaceMode(surfaceMode = "full", context = {}) {
  const nextMode = String(surfaceMode || "full") === "thread" ? "thread" : "full";
  state.chat.surfaceMode = nextMode;
  state.chat.threadContext = nextMode === "thread"
    ? { ...(context && typeof context === "object" ? context : {}) }
    : null;
  const hideContactList = nextMode === "thread"
    && (String(context?.source || "") === "order" || Boolean(context?.orderId));
  if (els.chatCard) els.chatCard.classList.toggle("order-direct", hideContactList);
  if (els.btnChatShowList) els.btnChatShowList.classList.add("hidden");
  renderChatSurfaceTitle();
}

function chatThreadCacheKey(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  const safeWalletId = String(walletId || "").trim();
  const safeMode = String(mode || "global").trim() || "global";
  const safeOrderId = safeMode === "order" ? String(orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  return `${safeMode}:${safeWalletId}:${safeOrderId}`;
}

function getChatThreadCacheEntry(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  const pairEntry = getChatPairThreadEntry(walletId, mode, orderId);
  if (pairEntry) return pairEntry;
  const key = chatThreadCacheKey(walletId, mode, orderId);
  return state.chat.threadCache?.[key] && typeof state.chat.threadCache[key] === "object" ? state.chat.threadCache[key] : null;
}

function setChatThreadBackendReady(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null, ready = true) {
  const key = chatThreadCacheKey(walletId, mode, orderId);
  if (!String(walletId || "").trim()) return;
  state.chat.threadBackendReady = {
    ...(state.chat.threadBackendReady || {}),
    [key]: ready === true,
  };
}

function isChatThreadBackendReady(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  const key = chatThreadCacheKey(walletId, mode, orderId);
  if (state.chat.threadBackendReady?.[key] === true) return true;
  return getChatThreadCacheEntry(walletId, mode, orderId)?.loaded === true;
}

function setChatThreadLoading(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null, loading = true) {
  const key = chatThreadCacheKey(walletId, mode, orderId);
  if (!String(walletId || "").trim()) return;
  state.chat.threadLoading = {
    ...(state.chat.threadLoading || {}),
    [key]: loading === true,
  };
}

function isChatThreadLoading(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  const key = chatThreadCacheKey(walletId, mode, orderId);
  return state.chat.threadLoading?.[key] === true;
}

function updateChatComposeState() {
  const walletId = String(state.chat.activeWalletId || "").trim();
  const hasActive = Boolean(walletId);
  if (els.chatInput) {
    els.chatInput.disabled = !hasActive;
  }
  if (els.btnSendChat) {
    const backendReady = hasActive && isChatThreadBackendReady(walletId, state.chat.mode, state.chat.activeOrderId);
    const loading = hasActive && isChatThreadLoading(walletId, state.chat.mode, state.chat.activeOrderId);
    els.btnSendChat.disabled = !hasActive || !backendReady;
    els.btnSendChat.title = !hasActive
      ? tr("chat_select_contact_first", "请先选择一个联系人")
      : (!backendReady
        ? (loading ? tr("chat_thread_loading", "正在加载聊天记录") : tr("chat_thread_not_ready", "聊天后台状态未就绪"))
        : "");
  }
  updateChatLoadMoreState();
}

function setChatThreadCacheEntry(messages, options = {}) {
  const walletId = String(options.walletId ?? state.chat.activeWalletId ?? "").trim();
  if (!walletId) return null;
  const mode = String(options.mode ?? state.chat.mode ?? "global").trim() || "global";
  const orderId = mode === "order" ? String(options.orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  const key = chatThreadCacheKey(walletId, mode, orderId);
  const current = getChatThreadCacheEntry(walletId, mode, orderId);
  const existingByKey = new Map((Array.isArray(current?.messages) ? current.messages : []).map((row) => {
    const msgId = String(row?.msgId || "").trim();
    const txid = String(row?.txid || "").trim();
    return [msgId || (txid ? `tx:${txid}` : ""), row];
  }).filter(([rowKey]) => rowKey));
  const rows = mergeChatMessagesSorted((Array.isArray(messages) ? messages : []).map((row) => {
    const msgId = String(row?.msgId || "").trim();
    const txid = String(row?.txid || "").trim();
    const rowKey = msgId || (txid ? `tx:${txid}` : "");
    return normalizeChatMessageForOrder(row, existingByKey.get(rowKey) || null);
  }));
  const pair = upsertChatPair(walletId, {});
  const pairThreadKey = chatPairThreadEntryKey(mode, orderId);
  const entry = {
    walletId,
    mode,
    orderId,
    loaded: options.loaded === true,
    page: Math.max(1, Number(options.page || 1)),
    lastFetchedCount: Math.max(0, Number(options.lastFetchedCount ?? rows.length)),
    lastLoadedAt: new Date().toISOString(),
    messages: rows,
  };
  if (pair) {
    upsertChatPair(walletId, {
      threadEntries: {
        ...(pair.threadEntries || {}),
        [pairThreadKey]: entry,
      },
    });
  }
  state.chat.threadCache = {
    ...(state.chat.threadCache || {}),
    [key]: entry,
  };
  return entry;
}

function isChatThreadLoaded(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) {
  return getChatThreadCacheEntry(walletId, mode, orderId)?.loaded === true;
}

let chatAutoReadTimer = null;

function scheduleMarkActiveChatThreadRead(delayMs = 120) {
  if (chatAutoReadTimer) clearTimeout(chatAutoReadTimer);
  chatAutoReadTimer = setTimeout(() => {
    chatAutoReadTimer = null;
    markActiveChatThreadRead().catch(() => {});
  }, Math.max(0, Number(delayMs || 0)));
}

function allocateChatMessageSequence() {
  const next = Math.max(1, Number(state.chat.nextMessageSequence || 1));
  state.chat.nextMessageSequence = next + 1;
  return next;
}

function normalizeChatMessageForOrder(row = {}, existing = null) {
  const base = row && typeof row === "object" ? row : {};
  const prior = existing && typeof existing === "object" ? existing : null;
  const msgId = String(base?.msgId || prior?.msgId || "").trim();
  const transport = String(base?.transport || "").trim();
  const status = String(base?.status || "").trim();
  const pendingLike = msgId.startsWith("local:")
    || transport === "pending"
    || status === "sending"
    || status === "pending_confirm";
  const preservedTs = String(pendingLike
    ? (prior?.__sortTs || base?.__sortTs || prior?.ts || base?.ts || "")
    : (base?.ts || prior?.ts || base?.__sortTs || prior?.__sortTs || "")
  ).trim();
  const preservedSeq = Math.max(
    0,
    Number(prior?.__orderSeq || base?.__orderSeq || 0),
  );
  if (preservedSeq > 0) {
    state.chat.nextMessageSequence = Math.max(
      Number(state.chat.nextMessageSequence || 1),
      preservedSeq + 1,
    );
  }
  const sourceEventSeq = Math.max(
    0,
    Number(prior?.sourceEventSeq || prior?.source_event_seq || base?.sourceEventSeq || base?.source_event_seq || 0),
  );
  return {
    ...base,
    sourceEventSeq,
    source_event_seq: sourceEventSeq,
    __sortTs: preservedTs || new Date().toISOString(),
    __orderSeq: preservedSeq > 0 ? preservedSeq : allocateChatMessageSequence(),
  };
}

function resequenceChatMessagesForPrepend(prependedRows = [], existingRows = []) {
  const rows = [
    ...(Array.isArray(prependedRows) ? prependedRows : []),
    ...(Array.isArray(existingRows) ? existingRows : []),
  ];
  return rows.map((row, index) => ({
    ...(row && typeof row === "object" ? row : {}),
    __orderSeq: index + 1,
  }));
}

function mergeChatMessagesSorted(rows = []) {
  const deduped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const msgId = String(row?.msgId || "").trim();
    const txid = String(row?.txid || "").trim();
    const key = msgId || (txid ? `tx:${txid}` : `row:${Math.random().toString(36).slice(2, 10)}`);
    const previous = deduped.get(key) || null;
    const merged = {
      ...(previous || {}),
      ...(row && typeof row === "object" ? row : {}),
    };
    deduped.set(key, normalizeChatMessageForOrder(merged, previous || row));
  });
  return Array.from(deduped.values()).sort((a, b) => {
    const msgIdA = String(a?.msgId || "").trim();
    const msgIdB = String(b?.msgId || "").trim();
    const localA = msgIdA.startsWith("local:");
    const localB = msgIdB.startsWith("local:");
    const sa = Math.max(0, Number(a?.__orderSeq || 0));
    const sb = Math.max(0, Number(b?.__orderSeq || 0));
    if (sa !== sb) return sa - sb;
    const ta = Date.parse(String(a?.__sortTs || a?.ts || "")) || 0;
    const tb = Date.parse(String(b?.__sortTs || b?.ts || "")) || 0;
    if (ta !== tb) return ta - tb;
    const eventSeqA = Math.max(0, Number(a?.sourceEventSeq || a?.source_event_seq || 0));
    const eventSeqB = Math.max(0, Number(b?.sourceEventSeq || b?.source_event_seq || 0));
    if (eventSeqA > 0 && eventSeqB > 0 && eventSeqA !== eventSeqB) return eventSeqA - eventSeqB;
    if (!localA && !localB && msgIdA && msgIdB && msgIdA !== msgIdB) return msgIdA.localeCompare(msgIdB);
    return msgIdA.localeCompare(msgIdB);
  });
}

function messageBelongsToCurrentChat(message = {}) {
  const walletId = String(message?.walletId || message?.peerWalletId || "").trim();
  if (!walletId || walletId !== String(state.chat.activeWalletId || "").trim()) return false;
  if (state.chat.mode === "order") {
    return String(message?.orderId || "") === String(state.chat.activeOrderId || "");
  }
  return !message?.orderId;
}

function buildRenderableChatMessages() {
  const entry = getChatThreadCacheEntry();
  const rows = Array.isArray(entry?.messages) ? entry.messages : [];
  const pending = (state.chat.pendingLocalMessages || []).filter((m) => {
    if (String(m?.walletId || "") !== String(state.chat.activeWalletId || "")) return false;
    if (state.chat.mode === "order") return String(m?.orderId || "") === String(state.chat.activeOrderId || "");
    return !m?.orderId;
  });
  const seenMsgIds = new Set(rows.map((m) => String(m?.msgId || "")).filter(Boolean));
  const seenClientMsgIds = new Set(rows.map((m) => String(m?.clientMsgId || m?.clientMessageId || "")).filter(Boolean));
  const merged = rows.concat(pending.filter((m) => {
    const msgId = String(m?.msgId || "").trim();
    const clientMsgId = String(m?.clientMsgId || m?.clientMessageId || msgId || "").trim();
    return !seenMsgIds.has(msgId) && !seenClientMsgIds.has(clientMsgId);
  }));
  return mergeChatMessagesSorted(merged);
}

function chatMessagesDataSignature(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ([
    String(row?.msgId || ""),
    String(row?.clientMsgId || row?.clientMessageId || ""),
    String(row?.walletId || row?.peerWalletId || ""),
    String(row?.orderId || ""),
    String(row?.direction || ""),
    String(row?.transport || ""),
    String(row?.status || ""),
    String(row?.txid || ""),
    String(row?.ts || ""),
    String(row?.text || ""),
    String(row?.__sortTs || ""),
    String(row?.__orderSeq || ""),
    String(row?.sourceEventSeq || row?.source_event_seq || ""),
  ].join("\u001f"))).join("\u001e");
}

function currentChatPaintSignature(messages = []) {
  return [
    String(state.chat.activeWalletId || ""),
    String(state.chat.mode || "global"),
    String(state.chat.activeOrderId || ""),
    state.chat.messageMetaVisible?.self?.who === true ? "1" : "0",
    state.chat.messageMetaVisible?.self?.transport !== false ? "1" : "0",
    state.chat.messageMetaVisible?.self?.time !== false ? "1" : "0",
    state.chat.messageMetaVisible?.self?.status === true ? "1" : "0",
    state.chat.messageMetaVisible?.peer?.who === true ? "1" : "0",
    state.chat.messageMetaVisible?.peer?.transport !== false ? "1" : "0",
    state.chat.messageMetaVisible?.peer?.time !== false ? "1" : "0",
    state.chat.messageMetaVisible?.peer?.status === true ? "1" : "0",
    chatMessagesDataSignature(messages),
  ].join("\u001d");
}

function upsertChatMessageInCache(message = {}, options = {}) {
  const walletId = String(options.walletId ?? message?.walletId ?? message?.peerWalletId ?? "").trim();
  if (!walletId) return false;
  const mode = String(options.mode ?? state.chat.mode ?? "global").trim() || "global";
  const orderId = mode === "order" ? String(options.orderId ?? message?.orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  const current = getChatThreadCacheEntry(walletId, mode, orderId);
  const baseRows = Array.isArray(current?.messages) ? current.messages : [];
  const msgId = String(message?.msgId || "").trim();
  let nextRows = baseRows.slice();
  if (!msgId) {
    nextRows.push(normalizeChatMessageForOrder(message));
  } else {
    const existingIndex = nextRows.findIndex((row) => String(row?.msgId || "").trim() === msgId);
    if (existingIndex >= 0) {
      nextRows[existingIndex] = normalizeChatMessageForOrder({
        ...nextRows[existingIndex],
        ...(message && typeof message === "object" ? message : {}),
      }, nextRows[existingIndex]);
    } else {
      nextRows.push(normalizeChatMessageForOrder(message));
    }
  }
  const beforeSig = chatMessagesDataSignature(baseRows);
  const afterSig = chatMessagesDataSignature(nextRows);
  if (beforeSig === afterSig) return false;
  setChatThreadCacheEntry(nextRows, {
    walletId,
    mode,
    orderId,
    loaded: current?.loaded === true,
    page: Math.max(1, Number(current?.page || 1)),
    lastFetchedCount: Math.max(Number(current?.lastFetchedCount || 0), nextRows.length),
  });
  return true;
}

function replaceChatMessageInCache(previousMsgId, message = {}, options = {}) {
  const oldMsgId = String(previousMsgId || "").trim();
  const walletId = String(options.walletId ?? message?.walletId ?? message?.peerWalletId ?? "").trim();
  if (!oldMsgId || !walletId) {
    upsertChatMessageInCache(message, options);
    return;
  }
  const mode = String(options.mode ?? state.chat.mode ?? "global").trim() || "global";
  const orderId = mode === "order" ? String(options.orderId ?? message?.orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  const current = getChatThreadCacheEntry(walletId, mode, orderId);
  const baseRows = Array.isArray(current?.messages) ? current.messages : [];
  const replacementMsgId = String(message?.msgId || oldMsgId).trim();
  const existingIndex = baseRows.findIndex((row) => String(row?.msgId || "").trim() === oldMsgId);
  let nextRows = baseRows.slice();
  if (existingIndex >= 0) {
    nextRows[existingIndex] = normalizeChatMessageForOrder({
      ...nextRows[existingIndex],
      ...(message && typeof message === "object" ? message : {}),
      msgId: replacementMsgId || oldMsgId,
    }, nextRows[existingIndex]);
    if (replacementMsgId && replacementMsgId !== oldMsgId) {
      nextRows = nextRows.filter((row, index) => (
        index === existingIndex || String(row?.msgId || "").trim() !== replacementMsgId
      ));
    }
  } else {
    const replacementIndex = replacementMsgId
      ? baseRows.findIndex((row) => String(row?.msgId || "").trim() === replacementMsgId)
      : -1;
    if (replacementIndex >= 0) {
      nextRows[replacementIndex] = normalizeChatMessageForOrder({
        ...nextRows[replacementIndex],
        ...(message && typeof message === "object" ? message : {}),
        msgId: replacementMsgId,
      }, nextRows[replacementIndex]);
    } else {
      nextRows.push(normalizeChatMessageForOrder({
        ...(message && typeof message === "object" ? message : {}),
        msgId: replacementMsgId || oldMsgId,
      }));
    }
  }
  setChatThreadCacheEntry(nextRows, {
    walletId,
    mode,
    orderId,
    loaded: current?.loaded === true,
    page: Math.max(1, Number(current?.page || 1)),
    lastFetchedCount: Math.max(Number(current?.lastFetchedCount || 0), nextRows.length),
  });
}

function removeChatMessageFromCache(msgId, options = {}) {
  const targetMsgId = String(msgId || "").trim();
  const walletId = String(options.walletId ?? state.chat.activeWalletId ?? "").trim();
  if (!targetMsgId || !walletId) return;
  const mode = String(options.mode ?? state.chat.mode ?? "global").trim() || "global";
  const orderId = mode === "order" ? String(options.orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  const current = getChatThreadCacheEntry(walletId, mode, orderId);
  const baseRows = Array.isArray(current?.messages) ? current.messages : [];
  const nextRows = baseRows.filter((row) => String(row?.msgId || "").trim() !== targetMsgId);
  if (nextRows.length === baseRows.length) return;
  setChatThreadCacheEntry(nextRows, {
    walletId,
    mode,
    orderId,
    loaded: current?.loaded === true,
    page: Math.max(1, Number(current?.page || 1)),
    lastFetchedCount: Math.max(0, Number(current?.lastFetchedCount || nextRows.length)),
  });
}

function findMatchingPendingLocalMessage(message = {}) {
  const walletId = String(message?.walletId || message?.peerWalletId || "").trim();
  const direction = String(message?.direction || "").trim();
  if (!walletId || direction !== "out") return null;
  const clientMsgId = String(message?.clientMsgId || message?.clientMessageId || "").trim();
  if (clientMsgId) {
    const directMatch = (Array.isArray(state.chat.pendingLocalMessages) ? state.chat.pendingLocalMessages : []).find((row) => (
      String(row?.walletId || "").trim() === walletId
      && String(row?.direction || "").trim() === "out"
      && (
        String(row?.msgId || "").trim() === clientMsgId
        || String(row?.clientMsgId || row?.clientMessageId || "").trim() === clientMsgId
      )
    ));
    if (directMatch) return directMatch;
  }
  const text = String(message?.text || "");
  const orderId = message?.orderId == null ? "" : String(message.orderId || "");
  const serverTs = Date.parse(String(message?.ts || "")) || Date.now();
  let best = null;
  for (const row of Array.isArray(state.chat.pendingLocalMessages) ? state.chat.pendingLocalMessages : []) {
    const pendingMsgId = String(row?.msgId || "").trim();
    if (!pendingMsgId.startsWith("local:")) continue;
    if (String(row?.direction || "").trim() !== "out") continue;
    if (String(row?.walletId || "").trim() !== walletId) continue;
    const pendingOrderId = row?.orderId == null ? "" : String(row.orderId || "");
    if (pendingOrderId !== orderId) continue;
    if (String(row?.text || "") !== text) continue;
    const pendingTs = Date.parse(String(row?.ts || "")) || 0;
    const deltaMs = Math.abs(serverTs - pendingTs);
    if (deltaMs > 2 * 60 * 1000) continue;
    if (!best || deltaMs < best.deltaMs) {
      best = { row, deltaMs };
    }
  }
  return best?.row || null;
}

function reconcilePendingLocalMessage(message = {}, options = {}) {
  const matched = findMatchingPendingLocalMessage(message);
  if (!matched) return false;
  const previousMsgId = String(matched?.msgId || "").trim();
  const serverMsgId = String(message?.msgId || "").trim();
  const clientMsgId = String(message?.clientMsgId || message?.clientMessageId || matched?.clientMsgId || matched?.clientMessageId || previousMsgId || "").trim();
  const walletId = String(options.walletId ?? message?.walletId ?? message?.peerWalletId ?? "").trim();
  const mode = String(options.mode ?? (message?.orderId ? "order" : state.chat.mode ?? "global")).trim() || "global";
  const orderId = mode === "order"
    ? String(options.orderId ?? message?.orderId ?? matched?.orderId ?? state.chat.activeOrderId ?? "").trim()
    : "";
  replaceChatMessageInCache(previousMsgId, {
    ...matched,
    ...(message && typeof message === "object" ? message : {}),
    walletId: String(message?.walletId || matched?.walletId || walletId),
    clientMsgId,
    __sortTs: String(matched?.__sortTs || matched?.ts || message?.ts || new Date().toISOString()),
    __orderSeq: Math.max(0, Number(matched?.__orderSeq || message?.__orderSeq || 0)) || allocateChatMessageSequence(),
  }, {
    walletId: String(message?.walletId || matched?.walletId || walletId),
    mode,
    orderId,
  });
  state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((row) => {
    const rowMsgId = String(row?.msgId || "").trim();
    const rowClientMsgId = String(row?.clientMsgId || row?.clientMessageId || rowMsgId || "").trim();
    return rowMsgId !== previousMsgId
      && (!serverMsgId || rowMsgId !== serverMsgId)
      && (!clientMsgId || rowClientMsgId !== clientMsgId);
  });
  return true;
}

function setActiveChatWallet(walletId) {
  state.chat.activeWalletId = String(walletId || "");
  state.chat.messagePage = 1;
  state.chat.lastFetchedMessageCount = 0;
  state.chat.activeSwitchSeq = Number(state.chat.activeSwitchSeq || 0) + 1;
  if (state.chat.activeWalletId) {
    setChatThreadBackendReady(
      state.chat.activeWalletId,
      state.chat.mode,
      state.chat.activeOrderId,
      getChatThreadCacheEntry(state.chat.activeWalletId, state.chat.mode, state.chat.activeOrderId)?.loaded === true,
    );
  }
  updateChatComposeState();
}

function currentChatPageSize() {
  return Math.max(1, Number(state.chat.messagePageSize || 10));
}

function currentChatHasMore() {
  return Number(state.chat.lastFetchedMessageCount || 0) >= currentChatPageSize();
}

function updateChatLoadMoreState() {
  if (!els.btnChatLoadMore) return;
  const threadLoading = Boolean(state.chat.activeWalletId)
    && isChatThreadLoading(state.chat.activeWalletId, state.chat.mode, state.chat.activeOrderId);
  const hasMore = Boolean(state.chat.activeWalletId) && currentChatHasMore() && !threadLoading;
  els.btnChatLoadMore.disabled = !hasMore || state.chat.loadingOlderMessages === true || threadLoading;
  els.btnChatLoadMore.classList.toggle("hidden", !hasMore);
  els.btnChatLoadMore.textContent = state.chat.loadingOlderMessages === true
    ? tr("chat_loading_more", "加载中...")
    : (threadLoading
      ? tr("chat_thread_loading", "正在加载聊天记录")
      : tr("chat_load_more", "加载更早消息"));
}

function resolveMerchantChatWalletId(merchantId = "") {
  const safeMerchantId = String(merchantId || "").trim();
  if (!safeMerchantId) return "";
  const candidates = [
    ...(Array.isArray(state.chat.threads) ? state.chat.threads : []),
    ...(Array.isArray(state.chat.people) ? state.chat.people : []),
    ...(Array.isArray(state.chat.searchResults) ? state.chat.searchResults : []),
  ];
  const exact = candidates.find((row) => String(row?.merchantId || "").trim() === safeMerchantId);
  if (exact?.walletId) return String(exact.walletId);
  const safe = safeMerchantId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return safe ? `wallet-${safe}` : "";
}

function resolveProductChatWalletId(productOrId = null) {
  const product = productOrId && typeof productOrId === "object"
    ? productOrId
    : state.products.find((p) => String(p?.id || "") === String(productOrId || "")) || null;
  return resolveMerchantChatWalletId(product?.merchantId);
}

function currentChatWalletId() {
  return walletIdByMerchant(state.currentMerchantId || "");
}

function orderChainChatPubKey(order = null, role = "") {
  const safeRole = String(role || "").trim();
  if (safeRole === "buyer") {
    return String(order?.chain?.buyerChatPubKey || order?.buyerChatPubKey || "").trim();
  }
  if (safeRole === "seller") {
    return String(order?.chain?.sellerChatPubKey || order?.sellerChatPubKey || "").trim();
  }
  return "";
}

function resolveOrderChatWalletId(order = null) {
  const currentWalletId = currentChatWalletId();
  const buyerWalletId = String(order?.buyerWalletId || "").trim();
  const sellerWalletId = String(order?.sellerWalletId || "").trim();
  if (currentWalletId) {
    if (buyerWalletId && buyerWalletId === currentWalletId && sellerWalletId) return sellerWalletId;
    if (sellerWalletId && sellerWalletId === currentWalletId && buyerWalletId) return buyerWalletId;
  }
  if (buyerWalletId && buyerWalletId !== currentWalletId) return buyerWalletId;
  if (sellerWalletId && sellerWalletId !== currentWalletId) return sellerWalletId;
  const productId = String(order?.snapshot?.product_id || "");
  const product = state.products.find((p) => String(p?.id || "") === productId) || null;
  return resolveMerchantChatWalletId(product?.merchantId || order?.merchantId);
}

function orderPeerChatPubKeyCandidates(order = null) {
  const currentWalletId = currentChatWalletId();
  const buyerWalletId = String(order?.buyerWalletId || "").trim();
  const sellerWalletId = String(order?.sellerWalletId || "").trim();
  const buyerPubKey = orderChainChatPubKey(order, "buyer");
  const sellerPubKey = orderChainChatPubKey(order, "seller");
  const candidates = [];
  if (currentWalletId && sellerWalletId === currentWalletId && buyerPubKey) candidates.push(buyerPubKey);
  if (currentWalletId && buyerWalletId === currentWalletId && sellerPubKey) candidates.push(sellerPubKey);
  if (!buyerWalletId && buyerPubKey) candidates.push(buyerPubKey);
  if (!sellerWalletId && sellerPubKey) candidates.push(sellerPubKey);
  return [...new Set(candidates.filter(Boolean))];
}

async function resolveOrderChatWalletIdWithPubKeyFallback(order = null, initialWalletId = "") {
  const currentWalletId = currentChatWalletId();
  const initial = String(initialWalletId || "").trim();
  if (initial && initial !== currentWalletId) return initial;
  for (const pubKey of orderPeerChatPubKeyCandidates(order)) {
    try {
      const result = await api(`/api/chat/wallet-id-for-pubkey?pubKey=${encodeURIComponent(pubKey)}`, { silent: true });
      const walletId = String(result?.walletId || "").trim();
      if (walletId && walletId !== currentWalletId) return walletId;
    } catch (_) {}
  }
  return initial;
}

async function markActiveChatThreadRead() {
  const walletId = String(state.chat.activeWalletId || "");
  if (!walletId) return;
  const currentUnread = Math.max(0, Number(threadByWalletId(walletId)?.unreadCount || 0));
  if (currentUnread <= 0) return;
  await api("/api/chat/thread/read", { method: "POST", silent: true, body: { walletId } });
  upsertChatPair(walletId, { unreadCount: 0 });
  rebuildChatPairCollections();
  state.chat.unreadTotal = Math.max(0, Number(state.chat.unreadTotal || 0) - currentUnread);
  if (state.chat.unreadTotal <= 0) clearChatButtonUnreadLatch();
  renderChatUsers();
  await refreshChatUnreadBadge();
}

function currentChatStatusLabel(status = null) {
  const base = status && typeof status === "object" ? status : currentChatThread();
  const source = applyChatConnectStateToThread(base);
  if (!source) return tr("chat_status_none_selected", "未选择联系人");
  if (source.blocked) return tr("chat_status_blocked", "黑名单");
  if (source.friendStatus === "incoming_pending") return tr("chat_status_friend_incoming", "待处理好友请求");
  if (source.friendStatus === "outgoing_pending") return tr("chat_status_friend_outgoing", "好友请求已发送");
  if (source.friendStatus === "rejected") return tr("chat_status_friend_rejected", "好友请求已被拒绝");
  if (source.directConnected) return tr("chat_status_direct", "已连接");
  if (source.connectVerifying) return tr("chat_status_connect_verifying", "正在确认连接状态...");
  if (source.connecting) {
    const countdownSec = Math.max(0, Number(source.connectCountdownSec || 0));
    return trf("chat_status_connecting_countdown", { seconds: countdownSec }, `连接中 (${countdownSec}s)`);
  }
  if (source.connectFailed) return tr("chat_status_connect_failed", "连接失败");
  if (String(source.presenceStatus || "").toLowerCase() === "offline") return tr("chat_status_offline", "离线拒聊");
  return tr("chat_status_onchain_only", "仅链上");
}

function renderChatStatusBar(status = null) {
  renderChatSurfaceTitle();
  if (els.chatSelfStatus) {
    const online = state.chat.selfState?.online !== false;
    els.chatSelfStatus.textContent = online ? tr("chat_self_online", "在线") : tr("chat_self_offline", "离线");
    if (els.chatSelfStatusDot) {
      els.chatSelfStatusDot.classList.toggle("online", online);
      els.chatSelfStatusDot.classList.toggle("offline", !online);
    }
  }
  if (els.btnChatToggleOnline) {
    const online = state.chat.selfState?.online !== false;
    els.btnChatToggleOnline.textContent = online ? tr("chat_toggle_offline_short", "离线") : tr("chat_toggle_online_short", "在线");
  }
  if (els.chatThreadStatus) {
    els.chatThreadStatus.textContent = currentChatStatusLabel(status);
  }
  const thread = currentChatThread();
  if (els.btnChatP2pConnect) {
    const activeWalletId = String(state.chat.activeWalletId || "").trim();
    const source = applyChatConnectStateToThread(status && typeof status === "object" ? {
      ...(thread || {}),
      ...status,
      walletId: activeWalletId,
    } : thread);
    const direct = source?.directConnected === true;
    els.btnChatP2pConnect.classList.toggle("hidden", !activeWalletId);
    els.btnChatP2pConnect.classList.toggle("connected", direct);
    els.btnChatP2pConnect.disabled = !activeWalletId;
    els.btnChatP2pConnect.textContent = direct ? tr("chat_p2p_disconnect_btn", "断开") : tr("chat_p2p_connect_btn", "P2P");
    els.btnChatP2pConnect.title = direct
      ? tr("chat_p2p_disconnect_title", "断开当前 P2P 直连状态")
      : tr("chat_p2p_check_title", "检查非 HTTP P2P 直连状态");
    els.btnChatP2pConnect.dataset.chatWalletId = activeWalletId;
  }
  if (els.btnChatFriendAction) {
    els.btnChatFriendAction.disabled = false;
    els.btnChatFriendAction.textContent = tr("chat_friend_confirm_action", "好友确认");
  }
  if (els.btnChatBlockAction) {
    els.btnChatBlockAction.disabled = !thread;
    els.btnChatBlockAction.textContent = thread?.blocked ? tr("chat_unblock_action", "移出黑名单") : tr("chat_block_action", "加入黑名单");
  }
  updateChatComposeState();
}

async function searchChatUsers() {
  const q = String(els.chatSearchInput?.value || "").trim();
  state.chat.searchQuery = q;
  if (!q) {
    state.chat.searchResults = [];
    renderChatUsers();
    return;
  }
  const r = await api(`/api/chat/search?q=${encodeURIComponent(q)}`);
  state.chat.searchResults = Array.isArray(r.results) ? r.results : [];
  renderChatUsers();
}

function syncProgressMeta() {
  const bootstrapHeight = Math.max(0, Number(state.sync.bootstrapHeight || 0));
  const rawLocalHeight = Math.max(0, Number(state.sync.localHeight || 0));
  const rawHighestBlock = Math.max(0, Number(state.sync.highestBlock || state.sync.networkHeight || state.sync?.bhs?.tipHeight || 0));
  const bootstrapIndex = state.sync.bootstrapIndex && typeof state.sync.bootstrapIndex === "object"
    ? state.sync.bootstrapIndex
    : (state.sync.sourceStats && typeof state.sync.sourceStats === "object" ? state.sync.sourceStats.bootstrapIndex : null);
  const recoveredHeight = Math.max(0, Number(bootstrapIndex?.recoveredHeight || bootstrapIndex?.toHeight || 0));
  const forceResetDisplay = shouldForceSyncResetDisplay(state.sync);
  const forcedBootstrapHeight = Math.max(
    0,
    Number(state.ui?.syncResetDisplay?.bootstrapHeight || bootstrapHeight || 0),
  );
  const localHeight = forceResetDisplay && forcedBootstrapHeight > 0
    ? Math.max(0, forcedBootstrapHeight - 1)
    : rawLocalHeight;
  const highestBlock = Math.max(0, rawHighestBlock);
  const progressBootstrapHeight = forceResetDisplay && forcedBootstrapHeight > 0
    ? forcedBootstrapHeight
    : bootstrapHeight;
  const total = Math.max(1, highestBlock - Math.max(0, progressBootstrapHeight - 1));
  const done = Math.max(0, localHeight - Math.max(0, progressBootstrapHeight - 1));
  const percent = Math.max(0, Math.min(100, Math.round((done / total) * 1000) / 10));
  return {
    percent,
    localHeight,
    highestBlock,
    bootstrapHeight: progressBootstrapHeight,
    recoveredHeight,
    lag: Math.max(0, highestBlock - localHeight),
  };
}

function syncInProgress() {
  const progress = syncProgressMeta();
  const mode = String(state.sync.mode || "").toUpperCase();
  if (progress.lag > 0) return true;
  return mode === "OUT_OF_SYNC" || mode === "SYNCING" || mode === "RECOVERING";
}

function filteredProductsForBuyer() {
  const items = visibleBuyerProductsBase();
  if (state.buyerBrowseMode === "merchant") {
    const merchantId = String(state.selectedMerchantId || "").trim();
    if (!merchantId || merchantId === BUYER_ALL_MERCHANTS) return [];
    return items.filter((p) => String(p?.merchantId || "").trim() === merchantId);
  }
  return items.filter((p) => {
    if (!matchesPrimaryCategoryKeyword(state.search.primaryCategory, p)) return false;
    return true;
  });
}

async function applyBuyerKeywordSearch(options = {}) {
  if (!els.keyword) return;
  state.search.keyword = String(els.keyword.value || "").trim();
  try {
    await ensureDomainLoaded("catalog", { render: false });
  } catch (err) {
    if (options.showError !== false) toast(err.message);
  }
  renderBuyerPrimaryCategories();
  renderMerchants();
  renderBuyerMerchantCategories();
  renderBuyerProducts();
}

function scheduleBuyerKeywordSearch() {
  if (buyerSearchDebounceTimer) clearTimeout(buyerSearchDebounceTimer);
  buyerSearchDebounceTimer = setTimeout(() => {
    buyerSearchDebounceTimer = null;
    applyBuyerKeywordSearch({ showError: false }).catch((err) => {
      console.warn("buyer keyword search failed", err);
    });
  }, 180);
}

function filteredSellerProducts() {
  return state.products.filter((p) => isOwnedProduct(p) && productCategoryId(p) === state.selectedCategoryId);
}

function walletIdByMerchant(merchantId = "") {
  const safeMerchantId = String(merchantId || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return safeMerchantId ? `wallet-${safeMerchantId}` : "";
}

function filteredOrders() {
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  const sellerOrders = (state.orders || []).filter((o) => String(o?.sellerWalletId || "") === currentWalletId);
  if (state.orderFilter === "ALL") return sellerOrders;
  if (state.orderFilter === "OPEN") return sellerOrders.filter((o) => ["PLACED", "LOCKED", "SHIPPED", "REFUND_REQUESTED"].includes(o.status));
  if (state.orderFilter === "CLOSED") return sellerOrders.filter((o) => ["COMPLETED", "CANCELED", "TIMED_OUT", "REFUNDED"].includes(o.status));
  if (state.orderFilter === "DISPUTED") return sellerOrders.filter((o) => ["DISPUTED", "DISPUTE"].includes(String(o.status || "").toUpperCase()));
  return [];
}

function isHistoricalOrderStatus(status = "") {
  return [
    "COMPLETED",
    "CANCELED",
    "TIMED_OUT",
    "REFUNDED",
  ].includes(String(status || "").toUpperCase());
}

function activeBuyerOrders() {
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  return (state.orders || []).filter((o) => String(o?.buyerWalletId || "") === currentWalletId && !isHistoricalOrderStatus(o?.status || ""));
}

function historicalBuyerOrders() {
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  return (state.orders || []).filter((o) => String(o?.buyerWalletId || "") === currentWalletId && isHistoricalOrderStatus(o?.status || ""));
}

function orderQuantity(order) {
  return Math.max(1, Number(order?.snapshot?.quantity || order?.quantity || 1));
}

function orderProductId(order) {
  const snapshot = order?.snapshot || {};
  return String(snapshot.product_id || snapshot.productId || order?.productId || "").trim();
}

function orderProductTitle(order) {
  const snapshot = order?.snapshot || {};
  return String(snapshot.title || snapshot.product_title || snapshot.productName || orderProductId(order) || "-");
}

function orderProductLine(order) {
  return orderProductTitle(order);
}

function orderChangeSignature(order = {}) {
  const chain = order?.chain || {};
  const funds = order?.funds || {};
  return JSON.stringify({
    id: String(order?.id || order?.orderId || ""),
    status: String(order?.status || ""),
    placeTxid: String(chain.placeTxid || chain.buyerLockTxid || ""),
    sellerLockTxid: String(chain.sellerLockTxid || ""),
    shipTxid: String(chain.shipTxid || ""),
    shipConfirmed: Boolean(chain.shipConfirmed),
    shipConfirmedHeight: Number(chain.shipConfirmedHeight || 0),
    shipmentInfo: String(chain.shipmentInfo || ""),
    refundRequestTxid: String(chain.refundRequestTxid || ""),
    settleTxid: String(chain.settleTxid || chain.settlementTxid || ""),
    cancelTxid: String(chain.cancelTxid || ""),
    buyerLockedSats: Number(funds.buyerLockedSats || 0),
    sellerLockedSats: Number(funds.sellerLockedSats || 0),
    sellerCreditSats: Number(funds.sellerCreditSats || funds.settlement?.sellerCreditSats || 0),
    buyerRefundSats: Number(funds.buyerRefundSats || funds.settlement?.buyerRefundSats || 0),
    sellerRefundSats: Number(funds.sellerRefundSats || funds.settlement?.sellerRefundSats || 0),
  });
}

function pruneLocalOrderNotificationSuppressions(now = Date.now()) {
  for (const [id, entry] of localOrderNotificationSuppressions.byId.entries()) {
    const until = Math.max(
      Number(entry?.wildcardUntil || 0),
      ...Object.values(entry?.signatures || {}).map((value) => Number(value || 0)),
    );
    if (!id || until <= now) localOrderNotificationSuppressions.byId.delete(id);
  }
  localOrderNotificationSuppressions.createIntents = (localOrderNotificationSuppressions.createIntents || [])
    .filter((item) => Number(item?.until || 0) > now);
}

function rememberLocalOrderMutation(orderOrId = "", options = {}) {
  const order = orderOrId && typeof orderOrId === "object" ? orderOrId : null;
  const id = String(order?.id || order?.orderId || orderOrId || "").trim();
  if (!id) return;
  const now = Date.now();
  pruneLocalOrderNotificationSuppressions(now);
  const entry = localOrderNotificationSuppressions.byId.get(id) || { wildcardUntil: 0, signatures: {} };
  entry.wildcardUntil = Math.max(Number(entry.wildcardUntil || 0), now + Math.max(1000, Number(options.ms || LOCAL_ORDER_NOTIFICATION_SUPPRESS_MS)));
  if (order) {
    entry.signatures = entry.signatures || {};
    entry.signatures[orderChangeSignature(order)] = entry.wildcardUntil;
  }
  localOrderNotificationSuppressions.byId.set(id, entry);
}

function rememberLocalOrderCreateIntent(productId = "", quantity = 1) {
  const safeProductId = String(productId || "").trim();
  if (!safeProductId) return;
  const now = Date.now();
  pruneLocalOrderNotificationSuppressions(now);
  localOrderNotificationSuppressions.createIntents.push({
    productId: safeProductId,
    quantity: Math.max(1, Math.floor(Number(quantity || 1))),
    buyerWalletId: walletIdByMerchant(state.currentMerchantId || ""),
    until: now + LOCAL_ORDER_NOTIFICATION_SUPPRESS_MS,
  });
}

function rememberLocalOrdersFromState(nextState = {}, options = {}) {
  const ids = new Set((Array.isArray(options.orderIds) ? options.orderIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean));
  const productId = String(options.productId || "").trim();
  const quantity = Math.max(1, Math.floor(Number(options.quantity || 1)));
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  for (const order of (Array.isArray(nextState?.orders) ? nextState.orders : [])) {
    const id = String(order?.id || order?.orderId || "").trim();
    if (ids.has(id)) rememberLocalOrderMutation(order);
    if (
      productId
      && currentWalletId
      && String(order?.buyerWalletId || "") === currentWalletId
      && orderProductId(order) === productId
      && orderQuantity(order) === quantity
    ) {
      rememberLocalOrderMutation(order);
    }
  }
}

function isLocalOrderNotificationSuppressed(order = {}) {
  const id = String(order?.id || order?.orderId || "").trim();
  const now = Date.now();
  pruneLocalOrderNotificationSuppressions(now);
  if (id) {
    const entry = localOrderNotificationSuppressions.byId.get(id);
    const signatureUntil = Number(entry?.signatures?.[orderChangeSignature(order)] || 0);
    if (Number(entry?.wildcardUntil || 0) > now || signatureUntil > now) return true;
  }
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  const productId = orderProductId(order);
  const quantity = orderQuantity(order);
  const status = String(order?.status || "").toUpperCase();
  return (localOrderNotificationSuppressions.createIntents || []).some((intent) => (
    Number(intent?.until || 0) > now
    && String(intent?.buyerWalletId || "") === currentWalletId
    && String(order?.buyerWalletId || "") === currentWalletId
    && (
      (
        String(intent?.productId || "") === productId
        && Number(intent?.quantity || 0) === quantity
      )
      || status === "PLACED"
    )
  ));
}

function orderRolesForNotification(order = {}) {
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  const roles = [];
  if (currentWalletId && String(order?.buyerWalletId || "") === currentWalletId) roles.push("buyer");
  if (currentWalletId && String(order?.sellerWalletId || "") === currentWalletId) roles.push("seller");
  return roles;
}

function renderOrderNotificationBadges() {
  const flags = state.ui.orderNotifications || {};
  document.querySelectorAll("[data-order-notify-role]").forEach((el) => {
    const role = String(el.getAttribute("data-order-notify-role") || "");
    el.classList.toggle("has-order-update", Boolean(flags[role]));
  });
}

function isOrderNotificationSuppressedForSync() {
  const sync = state.sync || {};
  const localHeight = Math.max(0, Number(sync.localHeight || 0), Number(sync.fixedSyncLastHeight || 0));
  const highestBlock = Math.max(0, Number(sync.highestBlock || sync.networkHeight || sync?.bhs?.tipHeight || 0));
  const lag = Math.max(0, Number(sync.lag ?? (highestBlock > 0 ? highestBlock - localHeight : 0)));
  if (highestBlock > 0 && localHeight < highestBlock) return true;
  if (lag > 0) return true;
  const independentPhase = String(sync.independentPhase || "");
  if (["round_running", "round_committing", "running"].includes(independentPhase)) return true;
  const activeSyncNodes = Math.max(
    0,
    Number(sync.activeSyncNodes || 0),
    Number(sync.syncWorkerNodes || 0),
  );
  if (activeSyncNodes > 0 && independentPhase && !["idle", "failed"].includes(independentPhase)) return true;
  const lagPolicyMode = String(state.runtime?.lagPolicy?.mode || "").toUpperCase();
  if (lagPolicyMode === "FULL_SYNC" || lagPolicyMode === "CATCHUP_SYNC") return true;
  if (state.ui?.resyncFlow?.active === true) return true;
  return false;
}

function orderNotificationStorageKey() {
  const scope = walletIdByMerchant(state.currentMerchantId || "") || String(state.currentMerchantId || "default");
  return `${ORDER_NOTIFICATION_SIGNATURE_STORAGE_KEY}.${encodeURIComponent(scope || "default")}`;
}

function loadStoredOrderNotificationSignatures() {
  try {
    const raw = globalThis.localStorage?.getItem(orderNotificationStorageKey()) || "";
    const parsed = raw ? JSON.parse(raw) : null;
    const signatures = parsed?.signatures && typeof parsed.signatures === "object" ? parsed.signatures : parsed;
    if (!signatures || typeof signatures !== "object") return {};
    return Object.fromEntries(Object.entries(signatures)
      .map(([id, sig]) => [String(id || "").trim(), String(sig || "")])
      .filter(([id, sig]) => id && sig));
  } catch (_) {
    return {};
  }
}

function saveOrderNotificationSignatures(signatures = {}) {
  try {
    globalThis.localStorage?.setItem(orderNotificationStorageKey(), JSON.stringify({
      signatures: signatures && typeof signatures === "object" ? signatures : {},
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
}

function hydrateOrderNotificationBaselineFromStorage() {
  state.ui.orderNotifications = state.ui.orderNotifications || { buyer: false, seller: false, signatures: {}, baselineReady: false };
  const current = state.ui.orderNotifications.signatures || {};
  if (state.ui.orderNotifications.baselineReady === true || Object.keys(current).length > 0) return true;
  const stored = loadStoredOrderNotificationSignatures();
  if (!Object.keys(stored).length) return false;
  state.ui.orderNotifications.signatures = stored;
  state.ui.orderNotifications.baselineReady = true;
  return true;
}

function clearOrderNotification(role = "") {
  const safeRole = role === "seller" ? "seller" : "buyer";
  state.ui.orderNotifications = state.ui.orderNotifications || { buyer: false, seller: false, signatures: {}, baselineReady: false };
  state.ui.orderNotifications[safeRole] = false;
  renderOrderNotificationBadges();
}

function trackOrderNotifications(nextOrders = [], options = {}) {
  const rows = Array.isArray(nextOrders) ? nextOrders : [];
  state.ui.orderNotifications = state.ui.orderNotifications || { buyer: false, seller: false, signatures: {}, baselineReady: false };
  if (options.forceBaseline !== true) hydrateOrderNotificationBaselineFromStorage();
  const previous = state.ui.orderNotifications.signatures || {};
  const nextSignatures = {};
  let hasKnownBaseline = state.ui.orderNotifications.baselineReady === true || Object.keys(previous).length > 0;
  if (options.forceBaseline === true) hasKnownBaseline = false;
  if (options.notifyWithoutBaseline === true) hasKnownBaseline = true;
  const suppressForSync = options.suppressForSync === true || isOrderNotificationSuppressedForSync();
  for (const order of rows) {
    const id = String(order?.id || order?.orderId || "").trim();
    if (!id) continue;
    const sig = orderChangeSignature(order);
    nextSignatures[id] = sig;
    if (suppressForSync) continue;
    if (!hasKnownBaseline) continue;
    if (previous[id] === sig) continue;
    if (isLocalOrderNotificationSuppressed(order)) continue;
    for (const role of orderRolesForNotification(order)) {
      if (role !== state.activeRole || !isDocumentActive()) {
        state.ui.orderNotifications[role] = true;
      }
    }
  }
  state.ui.orderNotifications.signatures = nextSignatures;
  state.ui.orderNotifications.baselineReady = true;
  saveOrderNotificationSignatures(nextSignatures);
  renderOrderNotificationBadges();
}

function maybeOpenBuyerShipNotice(previousOrder = null, nextOrder = null) {
  const next = nextOrder && typeof nextOrder === "object" ? nextOrder : null;
  if (!next) return;
  if (isOrderNotificationSuppressedForSync()) return;
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  if (!currentWalletId || String(next?.buyerWalletId || "") !== currentWalletId) return;
  if (String(next?.status || "") !== "SHIPPED") return;
  const nextShipTxid = String(next?.chain?.shipTxid || "").trim();
  if (!nextShipTxid) return;
  const prev = previousOrder && typeof previousOrder === "object" ? previousOrder : null;
  const prevStatus = String(prev?.status || "");
  const prevShipTxid = String(prev?.chain?.shipTxid || "").trim();
  if (prevStatus === "SHIPPED" && prevShipTxid === nextShipTxid) return;
  if (state.ui.orderDetail?.orderId === String(next.id || "") && state.ui.orderDetail?.role === "buyer") return;
  openOrderDetailModal(String(next.id || ""), "buyer");
  toast(tr("buyer_ship_notice_toast", "卖家已发货，已打开发货交易详情"));
}

function maybeOpenOrderUpdateNotice(previousOrder = null, nextOrder = null, options = {}) {
  const next = nextOrder && typeof nextOrder === "object" ? nextOrder : null;
  if (!next || !isDocumentActive()) return;
  if (isOrderNotificationSuppressedForSync()) return;
  if (state.ui?.orderNotifications?.baselineReady !== true && options.allowWithoutBaseline !== true) return;
  const id = String(next.id || next.orderId || "").trim();
  if (!id) return;
  if (state.ui.orderDetail?.orderId === id) return;
  if (isLocalOrderNotificationSuppressed(next)) return;
  const roles = orderRolesForNotification(next);
  if (!roles.length) return;
  const prev = previousOrder && typeof previousOrder === "object" ? previousOrder : null;
  const previousSignature = String(options?.previousSignature || "").trim();
  const nextSignature = orderChangeSignature(next);
  const isNew = !prev && !previousSignature;
  const statusChanged = prev && String(prev.status || "") !== String(next.status || "");
  const txChanged = prev
    ? orderChangeSignature(prev) !== nextSignature
    : Boolean(previousSignature && previousSignature !== nextSignature);
  if (!isNew && !statusChanged && !txChanged) return;
  const role = roles.includes(state.activeRole) ? state.activeRole : roles[0];
  openOrderDetailModal(id, role);
  toast(isNew
    ? tr("order_update_notice_new", "收到新订单，已打开订单处理窗口")
    : tr("order_update_notice_changed", "订单状态已更新，已打开订单处理窗口"));
}

function orderProductCategoryName(order) {
  const snapshot = order?.snapshot || {};
  const product = productById(orderProductId(order));
  const snapshotCategory = String(snapshot.category_name || snapshot.categoryName || "").trim();
  const categoryId = String(snapshot.category_id || snapshot.categoryId || "").trim();
  return productCategoryName(product, snapshotCategory) || (categoryId ? categoryNameById(categoryId) : "") || tr("uncategorized", "未分类");
}

function sellerOrderProductCardHtml(order) {
  const product = productById(orderProductId(order));
  const imageUrl = safeProductImageSrc(product?.imageUrl || product?.image_url || order?.snapshot?.imageUrl || order?.snapshot?.image_url || "");
  const imageHtml = imageUrl
    ? `<img class="product-card-image seller-order-product-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(tr("product_image_alt", "Product image"))}" />`
    : `<div class="product-card-image seller-order-product-image"></div>`;
  const priceText = fmtSatAsBsv(orderAmountSats(order));
  return `<div class="seller-order-product">
    ${imageHtml}
    <div class="seller-order-product-main">
      <strong class="product-card-title">${escapeHtml(orderProductTitle(order))}</strong>
      <div class="seller-order-product-meta">
        <span>${escapeHtml(tr("category_label", "分类"))}: ${escapeHtml(orderProductCategoryName(order))}</span>
        <span>${escapeHtml(tr("labelQuantity", "数量"))}: ${orderQuantity(order)}</span>
        <span>${escapeHtml(tr("order_amount_label", "商品金额"))}: ${escapeHtml(priceText)}</span>
      </div>
    </div>
  </div>`;
}

function orderAmountSats(order) {
  const funds = order?.funds || {};
  const snapshot = order?.snapshot || {};
  const direct = Number(funds.priceSats || funds.productAmountSats || funds.goodsSats || 0);
  if (direct > 0) return direct;
  const snapshotPrice = Number(snapshot.price_snapshot || snapshot.price || 0);
  if (snapshotPrice <= 0) return 0;
  return snapshotPrice < 1 ? Math.round(snapshotPrice * 100000000) : Math.round(snapshotPrice);
}

function orderDisplayTime(order) {
  const ms = orderTimeMs(order);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch (_) {
    return "-";
  }
}

function orderTimeMs(order) {
  const raw = order?.createdAt
    || order?.created_at
    || order?.placedAt
    || order?.placed_at
    || order?.createdTs
    || order?.created_ts
    || order?.chain?.placeTime
    || order?.chain?.placedAt
    || order?.chain?.createdAt
    || order?.timestamp
    || order?.time
    || order?.updatedAt
    || order?.updated_at
    || "";
  let ms = 0;
  if (typeof raw === "number") {
    ms = raw < 100000000000 ? raw * 1000 : raw;
  } else {
    const text = String(raw || "").trim();
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      ms = numeric < 100000000000 ? numeric * 1000 : numeric;
    } else {
      ms = Date.parse(text);
    }
  }
  return Number.isFinite(ms) ? ms : 0;
}

function compareOrdersByOrderTimeDesc(a, b) {
  const ta = orderTimeMs(a);
  const tb = orderTimeMs(b);
  if (ta !== tb) return tb - ta;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
}

function orderStatusBarHtml(order) {
  const status = String(order?.status || "").toUpperCase();
  const isAtLeastLocked = ["LOCKED", "SHIPPED", "REFUND_REQUESTED", "RETURNING", "RETURN_REQUESTED", "REFUNDED", "COMPLETED", "DISPUTED", "DISPUTE"].includes(status);
  const isAtLeastShipped = ["SHIPPED", "REFUND_REQUESTED", "RETURNING", "RETURN_REQUESTED", "REFUNDED", "COMPLETED", "DISPUTED", "DISPUTE"].includes(status);
  const isCanceled = status === "CANCELED";
  const isReturnFlow = ["REFUND_REQUESTED", "RETURNING", "RETURN_REQUESTED", "REFUNDED", "DISPUTED", "DISPUTE"].includes(status);
  const isCompleted = status === "COMPLETED";
  const isRefunded = status === "REFUNDED";
  const isDisputed = ["DISPUTED", "DISPUTE"].includes(status);
  const node = (key, label, extra = "") => `<span class="order-flow-node ${key} ${extra}"><span class="order-flow-dot"></span><span>${escapeHtml(label)}</span></span>`;
  const edge = (key, extra = "") => `<span class="order-flow-edge ${key} ${extra}" aria-hidden="true"></span>`;
  return `<div class="order-status-bar order-flow" aria-label="${escapeHtml(tr("order_status_bar_label", "订单状态"))}">
    ${node("created", tr("order_step_placed", "已下单"), "buyer")}
    ${edge("created-locked", isAtLeastLocked ? "seller" : "")}
    ${node("locked", tr("order_step_locked", "锁定"), isAtLeastLocked ? "seller" : "")}
    ${edge("locked-canceled", isCanceled ? "seller" : "")}
    ${node("canceled", tr("order_step_canceled", "取消"), isCanceled ? "seller" : "")}
    ${edge("locked-shipped", isAtLeastShipped ? "seller" : "")}
    ${node("shipped", tr("order_step_shipped", "已发货"), isAtLeastShipped ? "seller" : "")}
    ${edge("shipped-confirm", isCompleted ? "buyer" : "")}
    ${node("confirmed", tr("order_step_confirmed_receipt", "确认已收货"), isCompleted ? "buyer" : "")}
    ${edge("confirm-complete", isCompleted ? "buyer" : "")}
    ${node("complete", tr("order_step_complete", "完成"), isCompleted || isRefunded ? "buyer" : "")}
    ${edge("shipped-return", isReturnFlow ? "buyer" : "")}
    ${node("returning", tr("order_step_returning", "退货中"), isReturnFlow ? "buyer" : "")}
    ${edge("return-refunded", isRefunded ? "seller" : "")}
    ${node("refunded", tr("order_step_refunded", "已退货"), isRefunded ? "seller" : "")}
    ${edge("return-dispute", isDisputed ? "seller" : "")}
    ${node("dispute", tr("order_step_dispute", "争议"), isDisputed ? "seller" : "")}
  </div>`;
}

function orderSummaryMetaHtml(order) {
  const qty = orderQuantity(order);
  return `<div class="order-meta-line">
    <span><em>${escapeHtml(tr("order_time_label", "时间"))}</em>${escapeHtml(orderDisplayTime(order))}</span>
    <span><em>${escapeHtml(tr("labelQuantity", "数量"))}</em>${qty}</span>
    <span><em>${escapeHtml(tr("order_amount_label", "商品金额"))}</em>${escapeHtml(fmtSatAsBsv(orderAmountSats(order)))}</span>
  </div>`;
}

function renderOrderRow(order, role = "buyer") {
  const actionButton = orderDetailOpenButtonHtml(order, role);
  const productSummary = role === "seller"
    ? sellerOrderProductCardHtml(order)
    : `<strong>${escapeHtml(orderProductTitle(order))}</strong>`;
  return `<div class="row order-row clickable" data-open-order-detail data-order-role="${escapeHtml(role || "buyer")}" data-order-id="${escapeHtml(order.id || "")}">
    <div class="order-row-head">
      ${productSummary}
      ${actionButton}
    </div>
    <p class="order-id-line">${escapeHtml(order.id || "")}</p>
    ${orderSummaryMetaHtml(order)}
    ${role === "seller" ? orderShipWaitNoticeHtml(order) : ""}
    ${orderStatusBarHtml(order)}
  </div>`;
}

function lockedForRole(role) {
  const currentWalletId = walletIdByMerchant(state.currentMerchantId || "");
  const openBuyerStatuses = new Set(["PLACED", "LOCKED", "SHIPPED", "REFUND_REQUESTED"]);
  const openSellerStatuses = new Set(["LOCKED", "SHIPPED", "REFUND_REQUESTED"]);
  const totalSats = (state.orders || []).reduce((sum, o) => {
    const status = String(o?.status || "").toUpperCase();
    if (role === "buyer") {
      if (!openBuyerStatuses.has(status)) return sum;
      if (String(o?.buyerWalletId || "") !== currentWalletId) return sum;
      return sum + Math.max(0, Number(o?.funds?.buyerLockedSats || 0));
    }
    if (role === "seller") {
      if (!openSellerStatuses.has(status)) return sum;
      if (String(o?.sellerWalletId || "") !== currentWalletId) return sum;
      return sum + Math.max(0, Number(o?.funds?.sellerLockedSats || 0));
    }
    return sum;
  }, 0);
  return totalSats / 100000000;
}

function renderView() {
  const profile = state.view === "profile";
  state.ui.walletViewActive = profile;
  els.homeView.classList.toggle("hidden", profile);
  els.profileView.classList.toggle("hidden", !profile);
  els.btnProfile.textContent = profile
    ? tr("btnProfileHome", "Back to home")
    : tr("btnProfile", "Profile");
  els.btnProfile.classList.toggle("active", profile);
}

async function openProfileViewFromHome(source = "open_profile_view") {
  state.view = "profile";
  renderView();
  await refreshChatConfigCard();
  await ensureReceiveAddress();
  if (!state.ui.walletUiLoaded) {
    await refreshWalletUiFromEvent(source);
  }
  await refreshWalletHistory();
}

function renderHeader() {
  syncStewardFormFromState();
  const gate = walletSendGateStatus();
  const availability = walletAvailabilityGateStatus();
  els.myBalance.textContent = state.wallet.totalBsv === null ? "-" : fmt(state.wallet.totalBsv);
  els.myRoleTip.textContent = `${tr("wallet_state_prefix", "Wallet state")}: ${walletHeaderStatusLabel(gate)}`;
  els.lockedBalance.textContent = fmt(lockedForRole(state.activeRole));
  els.syncStatus.textContent = syncModeLabel(state.sync.mode || "-");
  const pendingUploads = Number(state.sync.pendingUploads || 0);
  const walletListenerNodes = Math.max(
    0,
    Number(
      state.sync.walletListenerNodes
      || state.sync.spvWorkingNodes
      || (Array.isArray(state.sync.walletListenerNodeList) ? state.sync.walletListenerNodeList.length : 0)
      || 0
    ),
  );
  const syncDownloadNodes = Math.max(
    0,
    Number(state.sync.activeSyncNodes || 0),
    Number(state.sync.syncWorkerNodes || 0),
    Array.isArray(state.sync.activeSyncNodeList) ? state.sync.activeSyncNodeList.length : 0,
    Array.isArray(state.sync.syncWorkerNodeList) ? state.sync.syncWorkerNodeList.length : 0,
  );
  const connectedNodeCount = Math.max(
    0,
    Number(state.sync.connectedNodes || 0),
    walletListenerNodes + syncDownloadNodes,
    Array.isArray(state.sync.onlineNodeList) ? state.sync.onlineNodeList.length : 0,
  );
  const candidateRaw = Number(state.sync.candidateNodes || 0);
  const candidateFallback = Array.isArray(state.sync.spvCandidates) ? state.sync.spvCandidates.length : 0;
  const candidate = candidateRaw > 0 ? candidateRaw : candidateFallback;
  const progress = syncProgressMeta();
  const displayLocalHeight = progress.localHeight;
  const displayHighestBlock = progress.highestBlock;
  const displayLag = progress.lag;
  els.syncTip.textContent = trf("sync_tip_line", {
    local: displayLocalHeight,
    network: displayHighestBlock,
    lag: displayLag,
  }, `Local ${displayLocalHeight} / Highest ${displayHighestBlock} / Lag ${displayLag}`);
  if (els.syncGate) els.syncGate.textContent = availability.label;
  if (els.syncGateTip) els.syncGateTip.textContent = availability.tip;
  if (els.syncProgressBar) {
    els.syncProgressBar.style.width = `${progress.percent}%`;
    els.syncProgressBar.style.background = progress.lag <= 3
      ? "linear-gradient(90deg, #1ca46c, #67db9b)"
      : (progress.percent >= 60
        ? "linear-gradient(90deg, #1769ff, #42c8ff)"
        : "linear-gradient(90deg, #f0a128, #ffd36a)");
  }
  if (els.syncProgressText) {
    const restoredPrefix = Number(progress.recoveredHeight || 0) > 0
      ? trf("sync_fast_restored_prefix", { height: Number(progress.recoveredHeight || 0) }, `Restored to ${Number(progress.recoveredHeight || 0)} · `)
      : "";
    els.syncProgressText.textContent = restoredPrefix + trf("sync_progress_percent", { percent: progress.percent.toFixed(2) }, `Progress ${progress.percent.toFixed(2)}%`);
  }
  if (els.btnShowConnectedNodes) els.btnShowConnectedNodes.textContent = trf("sync_connected_nodes", { count: connectedNodeCount }, `Connected ${connectedNodeCount}`);
  if (els.btnShowCandidateNodes) els.btnShowCandidateNodes.textContent = trf("sync_candidate_nodes", { count: candidate }, `Candidates ${candidate}`);
  if (els.btnPushChain) {
    els.btnPushChain.textContent = trf("push_chain_count", { count: pendingUploads }, `Publish (${pendingUploads})`);
    els.btnPushChain.disabled = pendingUploads <= 0 || syncInProgress();
    els.btnPushChain.title = syncInProgress() ? tr("push_chain_disabled_syncing", "Sync in progress. Publishing is temporarily disabled") : "";
  }
  if (els.btnRefreshMerchants) {
    els.btnRefreshMerchants.disabled = !catalogSyncEnabled();
    els.btnRefreshMerchants.title = catalogSyncEnabled()
      ? ""
      : tr("catalog_sync_disabled_hint", "商品同步已关闭。不会自动加载或手动同步商品市场数据。");
  }
  if (els.btnWalletSend) {
    const noBalance = !(Number(state.wallet.totalBsv || 0) > 0);
    els.btnWalletSend.disabled = noBalance || !gate.ready;
    els.btnWalletSend.title = noBalance
      ? tr("balance_insufficient_short", "Insufficient balance")
      : (gate.ready ? tr("wallet_ready_to_send", "Wallet ready to send") : trf("wallet_send_blocked", { reason: gate.reason || tr("wallet_need_sync_before_send_short", "finish chain sync first") }, `Cannot send now: ${gate.reason || "finish chain sync first"}`));
  }
  if (els.btnWalletDonate) {
    const noBalance = !(Number(state.wallet.totalBsv || 0) > 0);
    els.btnWalletDonate.disabled = noBalance || !gate.ready;
    els.btnWalletDonate.title = noBalance
      ? tr("balance_insufficient_short", "Insufficient balance")
      : (gate.ready ? tr("wallet_donate_ready", "Wallet ready to donate") : trf("wallet_send_blocked", { reason: gate.reason || tr("wallet_need_sync_before_send_short", "finish chain sync first") }, `Cannot send now: ${gate.reason || "finish chain sync first"}`));
  }
  els.orderTip.textContent = "";
  els.sellerHint.textContent = tr("seller_hint_runtime", "Product lists come from synced on-chain data. Local demo samples are no longer kept.");

  updateEditingInteractivity();
}

function currentCategoryEditorPayload() {
  return {
    name: String(els.editCategoryName?.value || "").trim(),
  };
}

function categoryPayloadFromItem(item = null) {
  if (!item) return null;
  return {
    id: String(item.id || ""),
    name: String(item.name || "").trim(),
  };
}

function categoryPayloadSignature(payload) {
  return JSON.stringify(payload || {});
}

function resetCategoryEditorState() {
  state.editingCategoryId = "";
  state.ui.categoryEditor = {
    id: "",
    baseSignature: "",
    latestSignature: "",
    conflictPending: false,
    latestMissing: false,
  };
  if (els.categoryEditTitle) els.categoryEditTitle.textContent = tr("edit_category_title", "修改分类");
  if (els.btnSubmitCategoryEdit) els.btnSubmitCategoryEdit.textContent = tr("btnSubmitCategoryEdit", "确认修改");
  if (els.editCategoryPreset) els.editCategoryPreset.value = "";
}

function applyCategoryPayloadToForm(payload = null) {
  if (els.editCategoryName) els.editCategoryName.value = String(payload?.name || "");
  if (els.editCategoryPreset) {
    const name = String(payload?.name || "");
    const hasPreset = getDefaultCategoryOptions().includes(name);
    els.editCategoryPreset.value = hasPreset ? name : "";
  }
}

function syncCategoryEditorFromServer() {
  const editor = state.ui.categoryEditor || {};
  const id = String(editor.id || state.editingCategoryId || "");
  if (!id) return;
  const item = sellerCategories().find((c) => String(c.id || "") === id) || null;
  const dirty = categoryPayloadSignature(currentCategoryEditorPayload()) !== String(editor.baseSignature || "");
  if (!item) {
    if (!dirty) {
      if (els.categoryEditModal) els.categoryEditModal.classList.add("hidden");
      resetCategoryEditorState();
      return;
    }
    state.ui.categoryEditor.latestMissing = true;
    state.ui.categoryEditor.conflictPending = true;
    return;
  }
  const latestSig = categoryPayloadSignature(categoryPayloadFromItem(item));
  state.ui.categoryEditor.id = id;
  state.ui.categoryEditor.latestSignature = latestSig;
  state.ui.categoryEditor.latestMissing = false;
  if (!dirty) {
    applyCategoryPayloadToForm(item);
    state.ui.categoryEditor.baseSignature = latestSig;
    state.ui.categoryEditor.latestSignature = latestSig;
    state.ui.categoryEditor.conflictPending = false;
    return;
  }
  if (latestSig !== String(editor.baseSignature || "")) {
    state.ui.categoryEditor.conflictPending = true;
  }
}

function currentProductEditorPayload() {
  return {
    categoryId: String(els.editProductCategory?.value || "").trim(),
    title: String(els.editProductTitle?.value || "").trim(),
    price: Number(els.editProductPrice?.value || 0),
    stock: Number(els.editProductStock?.value || 0),
    imageUrl: String(els.editProductImageUrl?.value || "").trim(),
    description: String(els.editProductDescription?.value || "").trim(),
  };
}

function productPayloadFromItem(item = null) {
  if (!item) return null;
  return {
    id: String(item.id || ""),
    categoryId: productCategoryId(item),
    title: String(item.title || "").trim(),
    price: Number(item.price || 0),
    stock: Number(item.stock || 0),
    imageUrl: String(item.imageUrl || "").trim(),
    description: String(item.description || "").trim(),
  };
}

function productPayloadSignature(payload) {
  return JSON.stringify(payload || {});
}

function resetProductEditorState() {
  state.editingProductId = "";
  state.ui.productEditor = {
    id: "",
    baseSignature: "",
    latestSignature: "",
    conflictPending: false,
    latestMissing: false,
  };
}

function applyProductPayloadToForm(payload = null) {
  if (!payload) return;
  fillCategorySelectOptions(els.editProductCategory, payload.categoryId);
  if (els.editProductTitle) els.editProductTitle.value = String(payload.title || "");
  if (els.editProductPrice) els.editProductPrice.value = String(Number(payload.price || 0));
  if (els.editProductStock) els.editProductStock.value = String(Number(payload.stock || 0));
  if (els.editProductImageUrl) els.editProductImageUrl.value = String(payload.imageUrl || "");
  if (els.editProductImageFile) els.editProductImageFile.value = "";
  setProductImagePreview(els.editProductImagePreview, payload.imageUrl || "");
  if (els.editProductDescription) els.editProductDescription.value = String(payload.description || "");
}

function syncProductEditorFromServer() {
  const editor = state.ui.productEditor || {};
  const id = String(editor.id || state.editingProductId || "");
  if (!id) return;
  const item = state.products.find((p) => String(p.id || "") === id && isOwnedProduct(p)) || null;
  const dirty = productPayloadSignature(currentProductEditorPayload()) !== String(editor.baseSignature || "");
  if (!item) {
    if (!dirty) {
      if (els.productEditModal) els.productEditModal.classList.add("hidden");
      resetProductEditorState();
      return;
    }
    state.ui.productEditor.latestMissing = true;
    state.ui.productEditor.conflictPending = true;
    return;
  }
  const latestSig = productPayloadSignature(productPayloadFromItem(item));
  state.ui.productEditor.id = id;
  state.ui.productEditor.latestSignature = latestSig;
  state.ui.productEditor.latestMissing = false;
  if (!dirty) {
    applyProductPayloadToForm(item);
    state.ui.productEditor.baseSignature = latestSig;
    state.ui.productEditor.latestSignature = latestSig;
    state.ui.productEditor.conflictPending = false;
    return;
  }
  if (latestSig !== String(editor.baseSignature || "")) {
    state.ui.productEditor.conflictPending = true;
  }
}

function updateEditingInteractivity() {
  const editable = editingAllowed();
  const profileEditable = profileEditingAllowed();
  [
    els.regionPriority,
    els.pollSec,
    els.replayWindow,
    els.catalogSyncEnabled,
    els.categoryName,
    els.editCategoryName,
    els.editProductTitle,
    els.editProductCategory,
    els.editProductPrice,
    els.editProductStock,
    els.editProductImageUrl,
    els.editProductDescription,
    els.addProductTitle,
    els.addProductCategory,
    els.addProductPrice,
    els.addProductStock,
    els.addProductImageUrl,
    els.addProductDescription,
  ].filter(Boolean).forEach((el) => {
    el.disabled = !editable;
  });
  [
    els.profileName,
    els.chatEnabled,
    els.chatListenPort,
    els.chatPublicHost,
    els.chatPublicPort,
    els.chatConnectMode,
    els.chatRelayUrl,
    els.chatAllowOnchainInvite,
    els.chatFallbackToOnchain,
    els.chatAutoPublishEndpoint,
  ].filter(Boolean).forEach((el) => {
    el.disabled = !profileEditable;
  });
  if (els.btnApplySteward) els.btnApplySteward.disabled = !editable;
  if (els.btnAddCategory) els.btnAddCategory.disabled = false;
  if (els.btnAddProduct) els.btnAddProduct.disabled = false;
  if (els.btnSubmitCategoryEdit) els.btnSubmitCategoryEdit.disabled = !editable;
  if (els.btnSubmitProductEdit) els.btnSubmitProductEdit.disabled = !editable;
  if (els.btnSubmitAddProduct) els.btnSubmitAddProduct.disabled = !editable;
  updateSaveProfileButtonState();
}

function spvNodeRowHtml(n) {
  const avail = n.available === false ? tr("node_disabled", "Disabled") : tr("node_available", "Available");
  const role = String(n.role || "").trim();
  const roleText = role === "wallet"
    ? tr("spv_role_wallet", "监听")
    : (role === "sync" ? tr("spv_role_sync", "同步") : "");
  const title = roleText
    ? `#${Number(n.rank) || 0} ${n.endpoint || ""} · ${roleText}`
    : `#${Number(n.rank) || 0} ${n.endpoint || ""}`;
  return `<div class="row"><p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(trf("node_score_line", { score: Number(n.score) || 0, success: Number(n.successCount) || 0, fail: Number(n.failCount) || 0, consecutive: Number(n.consecutiveFail) || 0, status: avail }, `Score: ${Number(n.score) || 0} | Success: ${Number(n.successCount) || 0} | Fail: ${Number(n.failCount) || 0} | Consecutive fail: ${Number(n.consecutiveFail) || 0} | ${avail}`))}</p></div>`;
}

function buildSpvNodeStatsMap() {
  const map = new Map();
  const addRows = (rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const endpoint = String(row?.endpoint || "").trim();
      if (!endpoint) return;
      const prev = map.get(endpoint) || {};
      map.set(endpoint, {
        ...prev,
        ...row,
        endpoint,
      });
    });
  };
  addRows(state.sync.candidateNodeList);
  addRows(state.sync.onlineNodeList);
  addRows(state.sync.spvCandidates);
  addRows(state.sync.spvConnected);
  return map;
}

function renderSpvNodesModalContent() {
  const nodeStatsMap = buildSpvNodeStatsMap();
  const walletConnectedList = [];
  const walletConnectedSeen = new Set();
  const effectiveWalletConnectedList = Array.isArray(state.sync.walletListenerNodeList) && state.sync.walletListenerNodeList.length
    ? state.sync.walletListenerNodeList
    : (Array.isArray(state.sync.spvConnected) ? state.sync.spvConnected : []);
  effectiveWalletConnectedList.forEach((row, idx) => {
    const endpoint = String(row?.endpoint || '').trim();
    if (!endpoint || walletConnectedSeen.has(endpoint)) return;
    walletConnectedSeen.add(endpoint);
    walletConnectedList.push({
      ...(nodeStatsMap.get(endpoint) || {}),
      endpoint,
      rank: idx + 1,
      available: true,
    });
  });
  const syncConnectedList = [];
  const syncConnectedSeen = new Set();
  const onlineSyncFallbackList = Array.isArray(state.sync.onlineNodeList)
    ? state.sync.onlineNodeList
        .filter((row) => Array.isArray(row?.roles) && row.roles.includes("sync_active"))
        .map((row) => String(row?.endpoint || "").trim())
        .filter(Boolean)
    : [];
  const effectiveSyncNodeList = Array.isArray(state.sync.activeSyncNodeList) && state.sync.activeSyncNodeList.length
    ? state.sync.activeSyncNodeList
    : (Array.isArray(state.sync.syncWorkerNodeList) && state.sync.syncWorkerNodeList.length
      ? state.sync.syncWorkerNodeList
      : onlineSyncFallbackList);
  effectiveSyncNodeList.forEach((endpoint) => {
    const value = String(endpoint || '').trim();
    if (!value || syncConnectedSeen.has(value)) return;
    syncConnectedSeen.add(value);
    syncConnectedList.push({
      ...(nodeStatsMap.get(value) || {}),
      endpoint: value,
      rank: syncConnectedList.length + 1,
      available: true,
    });
  });
  const candidateList = Array.isArray(state.sync.candidateNodeList) && state.sync.candidateNodeList.length
    ? state.sync.candidateNodeList.map((row, idx) => ({
      ...(row || {}),
      endpoint: String(row?.endpoint || row || '').trim(),
      rank: Number(row?.rank || (idx + 1)),
      available: row?.available !== false,
    })).filter((row) => row.endpoint)
    : (Array.isArray(state.sync.spvCandidates) ? state.sync.spvCandidates : []);
  const walletConnected = Math.max(
    0,
    Number(
      state.sync.walletListenerNodes
      || state.sync.spvWorkingNodes
      || walletConnectedList.length
      || 0
    ),
  );
  const syncConnected = Math.max(
    0,
    Number(state.sync.activeSyncNodes || 0),
    Number(state.sync.syncWorkerNodes || 0),
    syncConnectedList.length || 0,
  );
  const connected = Math.max(0, walletConnected + syncConnected);
  const candidate = Number(state.sync.candidateNodes || candidateList.length || 0);
  const total = Number(state.sync.spvTotalNodes || candidateList.length || 0);
  const showingConnected = state.spvModalView === "connected";
  els.tabSpvConnected.classList.toggle("active", showingConnected);
  els.tabSpvCandidates.classList.toggle("active", !showingConnected);

  if (showingConnected) {
    const connectedRows = [];
    walletConnectedList.forEach((n) => {
      connectedRows.push({ ...n, role: "wallet" });
    });
    syncConnectedList.forEach((n) => {
      connectedRows.push({ ...n, role: "sync" });
    });
    els.spvNodesSummary.textContent = trf(
      "spv_connected_summary",
      { count: connected, wallet: walletConnected, sync: syncConnected },
      `Connected: ${connected} nodes (wallet ${walletConnected} + sync ${syncConnected})`,
    );
    els.spvNodesList.innerHTML = connectedRows.length
      ? connectedRows.map((n, idx) => spvNodeRowHtml({ ...n, rank: idx + 1, available: true })).join("")
      : `<div class="row">${escapeHtml(tr("spv_connected_empty", "No connected nodes right now."))}</div>`;
    return;
  }
  els.spvNodesSummary.textContent = trf("spv_candidate_summary", { candidate, total }, `Candidate ${candidate}; local total ${total} (sorted by score)`);
  els.spvNodesList.innerHTML = candidateList.length
    ? candidateList.map((n, idx) => spvNodeRowHtml({ ...n, rank: idx + 1 })).join("")
    : `<div class="row">${escapeHtml(tr("spv_candidate_empty", "No candidate nodes"))}</div>`;
}

async function openSpvNodesModal(mode = "connected") {
  state.spvModalView = mode === "candidates" ? "candidates" : "connected";
  try {
    const [bootstrap, syncStatus] = await Promise.all([
      fetchBootstrapDomains(["sync"]).catch(() => null),
      api("/api/sync/status", { silent: true }).catch(() => null),
    ]);
    const stateLiteSync = bootstrap?.domains?.sync?.sync && typeof bootstrap.domains.sync.sync === "object" ? bootstrap.domains.sync.sync : null;
    if (stateLiteSync) state.sync = mergeServerSyncState(state.sync, stateLiteSync);
    const syncStatusSync = syncStatus?.sync && typeof syncStatus.sync === "object" ? syncStatus.sync : null;
    if (syncStatusSync) state.sync = mergeServerSyncState(state.sync, syncStatusSync);
  } catch (_) {}
  renderSpvNodesModalContent();
  renderHeader();
  els.spvNodesModal.classList.remove("hidden");
}

function renderMerchants() {
  if (!els.merchantList) return;
  if (!isDomainLoaded("catalog")) {
    els.merchantList.innerHTML = `<div class="row">${escapeHtml(tr("catalog_not_loaded", "Catalog not loaded yet. Click Refresh or switch roles to load it."))}</div>`;
    return;
  }
  const rows = buyerMerchants();
  if (state.buyerBrowseMode === "merchant" && (!state.selectedMerchantId || state.selectedMerchantId === BUYER_ALL_MERCHANTS)) {
    state.selectedMerchantId = String(rows[0]?.id || "");
  }
  els.merchantList.innerHTML = rows.length
    ? rows.map((m) => `<div class="row buyer-side-nav-item${state.selectedMerchantId === m.id ? " active" : ""}" data-merchant-id="${escapeHtml(m.id || "")}"><span class="buyer-side-nav-label">${escapeHtml(m.name || "")}</span><span class="buyer-side-nav-arrow" aria-hidden="true">›</span></div>`).join("")
    : `<div class="row">${escapeHtml(tr("merchant_empty", "No merchants available to browse"))}</div>`;
}

function renderBuyerMerchantCategories() {
  if (!els.buyerMerchantCategoryList) return;
  if (!isDomainLoaded("catalog")) {
    els.buyerMerchantCategoryList.innerHTML = `<div class="row">${escapeHtml(tr("catalog_not_loaded", "Catalog not loaded yet. Click Refresh or switch roles to load it."))}</div>`;
    return;
  }
  const rows = buyerMerchantCategories();
  const selected = String(state.selectedBuyerMerchantCategoryId || "ALL");
  els.buyerMerchantCategoryList.innerHTML = rows.length
    ? rows.map((item) => {
        const id = String(item.id || "ALL");
        return `<div class="row buyer-side-nav-item${selected === id ? " active" : ""}" data-buyer-merchant-category="${escapeHtml(id)}"><span class="buyer-side-nav-label">${escapeHtml(item.name || id)}</span><span class="buyer-side-nav-arrow" aria-hidden="true">›</span></div>`;
      }).join("")
    : `<div class="row">${escapeHtml(tr("categories_empty", "No categories yet"))}</div>`;
}

function renderBuyerProducts() {
  const listEl = state.buyerBrowseMode === "merchant" ? els.buyerMerchantProductList : els.productList;
  if (!listEl) return;
  if (!isDomainLoaded("catalog")) {
    listEl.innerHTML = `<div class="row">${escapeHtml(tr("catalog_not_loaded", "Catalog not loaded yet. Click Refresh or switch roles to load it."))}</div>`;
    return;
  }
  const items = filteredProductsForBuyer();
  const emptyText = state.buyerBrowseMode === "merchant"
    ? tr("buyer_products_empty_merchant", "This merchant has no products available right now")
    : tr("buyer_products_empty_all", "No products currently available across all merchants");
  const selectedPrimaryCategory = String(state.search.primaryCategory || "ALL");
  const selectedPrimaryLabel = selectedPrimaryCategory === "ALL" ? tr("all_categories", "所有") : defaultCategoryDisplayName(selectedPrimaryCategory);
  const selectedMerchant = buyerMerchants().find((m) => String(m.id || "") === String(state.selectedMerchantId || "")) || null;
  if (state.buyerBrowseMode === "merchant") {
    if (els.buyerMerchantHeadline) {
      els.buyerMerchantHeadline.textContent = selectedMerchant
        ? `${selectedMerchant.name || selectedMerchant.id}`
        : tr("merchant_goods_title", "商家商品");
    }
  } else {
    if (els.buyerResultHeadline) els.buyerResultHeadline.textContent = `${selectedPrimaryLabel} · ${tr("buyer_goods_title", "商品")}`;
  }
  listEl.innerHTML = items.length
    ? items
        .map((p) => {
          const deleting = p.deleted && p.deleteSync?.acked < p.deleteSync?.total;
          const imageUrl = safeProductImageSrc(p.imageUrl);
          const imageHtml = imageUrl ? `<img class="product-card-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(tr("product_image_alt", "Product image"))}" />` : `<div class="product-card-image"></div>`;
          const priceText = (Number(p.price) || 0).toFixed(4);
          return `<div class="row product-card taobao-product-card clickable${deleting ? " stale" : ""}" data-open-product="${escapeHtml(String(p.id || ""))}">
            ${imageHtml}
            <div class="taobao-product-price"><span class="taobao-product-currency">BSV</span><strong>${escapeHtml(priceText)}</strong></div>
            <div><strong class="product-card-title">${escapeHtml(p.title || "")}${localStatusBadge(p.localStatus)}</strong></div>
          </div>`;
        })
        .join("")
    : `<div class="row">${emptyText}</div>`;
  listEl.classList.toggle("product-card-grid", items.length > 0);
  if (state.buyerBrowseMode === "merchant" && els.productList) {
    els.productList.innerHTML = "";
    els.productList.classList.remove("product-card-grid");
  }
  if (state.buyerBrowseMode !== "merchant" && els.buyerMerchantProductList) {
    els.buyerMerchantProductList.innerHTML = "";
    els.buyerMerchantProductList.classList.remove("product-card-grid");
  }
}

function renderBuyerPrimaryCategories() {
  if (!els.buyerPrimaryCategoryList) return;
  const rows = buyerPrimaryCategories();
  els.buyerPrimaryCategoryList.innerHTML = rows.map((item) => {
    const active = String(state.search.primaryCategory || "ALL") === String(item.key || "ALL");
    return `<div class="row buyer-side-nav-item${active ? " active" : ""}" data-buyer-primary-category="${escapeHtml(String(item.key || ""))}"><span class="buyer-side-nav-label">${escapeHtml(String(item.name || ""))}</span><span class="buyer-side-nav-arrow" aria-hidden="true">›</span></div>`;
  }).join("");
}

function renderBuyerBrowseMode() {
  const byCategory = state.buyerBrowseMode !== "merchant";
  if (els.btnBuyerBrowseByCategory) els.btnBuyerBrowseByCategory.classList.toggle("active", byCategory);
  if (els.btnBuyerBrowseByMerchant) els.btnBuyerBrowseByMerchant.classList.toggle("active", !byCategory);
  if (els.buyerBrowseCategoryPane) els.buyerBrowseCategoryPane.classList.toggle("hidden", !byCategory);
  if (els.buyerBrowseMerchantPane) els.buyerBrowseMerchantPane.classList.toggle("hidden", byCategory);
}

function renderCategories() {
  if (!isDomainLoaded("catalog")) {
    els.categoryList.innerHTML = `<div class="row">${escapeHtml(tr("catalog_not_loaded", "Catalog not loaded yet. Click Refresh or switch roles to load it."))}</div>`;
    return;
  }
  const rows = sellerCategories();
  const editable = editingAllowed();
  els.categoryList.innerHTML = rows.length
    ? rows.map((c) => `<div class="row buyer-side-nav-item seller-category-item clickable${state.selectedCategoryId === c.id ? " active" : ""}" data-category-id="${escapeHtml(c.id || "")}"><span class="buyer-side-nav-label">${escapeHtml(c.name || "")}${localStatusBadge(c.localStatus)}</span><span class="seller-category-actions"><button data-category-action="rename" data-category-id="${escapeHtml(c.id || "")}">${escapeHtml(tr("rename_button", "Rename"))}</button><button data-category-action="delete" data-category-id="${escapeHtml(c.id || "")}">${escapeHtml(tr("delete_button", "Delete"))}</button></span></div>`).join("")
    : `<div class="row">${escapeHtml(tr("categories_empty", "No categories yet (waiting for on-chain sync)"))}</div>`;
}

function renderSellerProducts() {
  if (!isDomainLoaded("catalog")) {
    els.sellerProductList.innerHTML = `<div class="row">${escapeHtml(tr("catalog_not_loaded", "Catalog not loaded yet. Click Refresh or switch roles to load it."))}</div>`;
    return;
  }
  const items = filteredSellerProducts();
  const editable = editingAllowed();
  els.sellerProductList.innerHTML = items.length
    ? items.map((p) => {
      const imageUrl = safeProductImageSrc(p.imageUrl);
      const imageHtml = imageUrl ? `<img class="product-card-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(tr("product_image_alt", "Product image"))}" />` : `<div class="product-card-image"></div>`;
      const description = String(p.description || "").trim();
      const descriptionHtml = description ? `<p class="product-card-desc">${escapeHtml(description)}</p>` : "";
      const categoryText = productCategoryName(p) || tr("uncategorized", "未分类");
      return `<div class="row product-card taobao-product-card seller-product-card clickable${state.selectedSellerProductId === p.id ? " active" : ""}${p.deleted ? " stale" : ""}" data-seller-product-id="${escapeHtml(p.id || "")}">
        ${imageHtml}
        <div><strong class="product-card-title">${escapeHtml(p.title || "")}${localStatusBadge(p.localStatus)}</strong><p class="product-card-category">${escapeHtml(categoryText)}</p></div>
        ${descriptionHtml}
        <div class="taobao-product-price"><span class="taobao-product-currency">BSV</span><strong>${escapeHtml(String(Number(p.price) || 0))}</strong></div>
        <p class="seller-product-meta">${escapeHtml(trf("seller_product_meta_line", { price: Number(p.price) || 0, stock: Number(p.stock) || 0, sold: Number(p.soldCount) || 0, version: Number(p.version) || 0 }, `Stock: ${Number(p.stock) || 0} | Sold: ${Number(p.soldCount) || 0} | v${Number(p.version) || 0}`))}</p>
        <div class="actions seller-product-actions"><button data-product-action="edit" data-product-id="${escapeHtml(p.id || "")}">${escapeHtml(tr("edit_button", "Edit"))}</button><button data-product-action="delete" data-product-id="${escapeHtml(p.id || "")}">${escapeHtml(tr("delete_button", "Delete"))}</button></div>
      </div>`;
    }).join("")
    : `<div class="row">${escapeHtml(tr("seller_products_empty", "No products in the current category"))}</div>`;
  els.sellerProductList.classList.toggle("product-card-grid", items.length > 0);
}

function openCategoryEditModal(categoryId) {
  if (!requireEditingAllowed(tr("category_edit_action", "Edit category"))) return;
  renderDefaultCategoryPresetSelect();
  const item = sellerCategories().find((c) => c.id === categoryId);
  if (!item) return;
  const payload = categoryPayloadFromItem(item);
  const baseSignature = categoryPayloadSignature(payload);
  state.editingCategoryId = item.id;
  state.ui.categoryEditor = {
    id: String(item.id || ""),
    baseSignature,
    latestSignature: baseSignature,
    conflictPending: false,
    latestMissing: false,
  };
  applyCategoryPayloadToForm(payload);
  if (els.categoryEditTitle) els.categoryEditTitle.textContent = tr("edit_category_title", "修改分类");
  if (els.btnSubmitCategoryEdit) els.btnSubmitCategoryEdit.textContent = tr("btnSubmitCategoryEdit", "确认修改");
  if (els.categoryEditModal) els.categoryEditModal.classList.remove("hidden");
  updateEditingInteractivity();
}

function openCategoryCreateModal() {
  if (!requireEditingAllowed(tr("category_add_action", "Add category"))) return;
  renderDefaultCategoryPresetSelect();
  resetCategoryEditorState();
  if (els.categoryEditTitle) els.categoryEditTitle.textContent = tr("add_category_title", "添加分类");
  if (els.btnSubmitCategoryEdit) els.btnSubmitCategoryEdit.textContent = tr("btnAddCategory", "添加");
  applyCategoryPayloadToForm({ name: "" });
  if (els.categoryEditModal) els.categoryEditModal.classList.remove("hidden");
  updateEditingInteractivity();
  if (els.editCategoryName) {
    window.setTimeout(() => {
      try { els.editCategoryName.focus(); } catch (_) {}
    }, 0);
  }
}

function fillCategorySelectOptions(selectEl, selectedId = "") {
  if (!selectEl) return;
  const rows = sellerCategories();
  selectEl.innerHTML = rows.length
    ? rows.map((c) => `<option value="${escapeHtml(c.id || "")}">${escapeHtml(c.name || "")}</option>`).join("")
    : `<option value="">${escapeHtml(tr("category_empty_option", "No category available"))}</option>`;
  if (selectedId && rows.some((c) => c.id === selectedId)) {
    selectEl.value = selectedId;
  } else if (rows[0]?.id) {
    selectEl.value = rows[0].id;
  }
}

function openProductEditModal(productId) {
  if (!requireEditingAllowed(tr("product_edit_action", "Edit product"))) return;
  const item = state.products.find((p) => p.id === productId && isOwnedProduct(p));
  if (!item) return;
  const payload = productPayloadFromItem(item);
  const baseSignature = productPayloadSignature(payload);
  state.editingProductId = item.id;
  state.ui.productEditor = {
    id: String(item.id || ""),
    baseSignature,
    latestSignature: baseSignature,
    conflictPending: false,
    latestMissing: false,
  };
  applyProductPayloadToForm(payload);
  if (els.productEditModal) els.productEditModal.classList.remove("hidden");
  updateEditingInteractivity();
}

function orderDetailOpenButtonHtml(order, role = "buyer") {
  const safeOrderId = escapeHtml(order?.id || "");
  const safeRole = escapeHtml(role || "buyer");
  return `<button type="button" class="order-chat-unread-anchor" data-open-order-detail data-order-role="${safeRole}" data-order-id="${safeOrderId}">${escapeHtml(tr("order_detail_action", "详情/操作"))}${orderChatUnreadDotHtml(order?.id || "")}</button>`;
}

function buyerOrderActionButtonsHtml(order) {
  const shipped = order.status === "SHIPPED";
  const shipConfirmed = orderShipConfirmed(order);
  const confirmable = shipped && shipConfirmed;
  const returnable = shipped && shipConfirmed;
  const safeOrderId = escapeHtml(order.id || "");
  const waitMessage = tr("buyer_order_wait_ship_confirmed", "等待发货交易区块确认后才可确认收货");
  const confirmTitle = shipped && !shipConfirmed ? escapeHtml(waitMessage) : "";
  const waitTip = shipped && !shipConfirmed ? `<p class="hint order-confirm-wait-tip">${escapeHtml(waitMessage)}</p>` : "";
  return `${waitTip}<button data-order-action="confirmReceipt" data-order-id="${safeOrderId}" title="${confirmTitle}" ${confirmable ? "" : "disabled"}>${escapeHtml(tr("order_action_confirm", "Confirm receipt"))}</button><button data-order-action="requestRefund" data-order-id="${safeOrderId}" ${returnable ? "" : "disabled"}>${escapeHtml(tr("order_action_return", "Request return"))}</button><button class="order-chat-unread-anchor" data-order-action="chat" data-order-id="${safeOrderId}">${escapeHtml(tr("order_action_chat", "Chat"))}${orderChatUnreadDotHtml(order.id || "")}</button>`;
}

function orderPlaceConfirmed(order) {
  const txid = String(order?.chain?.placeTxid || order?.chain?.buyerLockTxid || "").trim().toLowerCase();
  if (!txid) return false;
  const recent = Array.isArray(state.recentRawtxs) ? state.recentRawtxs : [];
  const recentRow = recent.find((row) => String(row?.txid || "").trim().toLowerCase() === txid);
  if (recentRow?.confirmed === true) return true;
  return false;
}

function orderShipConfirmed(order) {
  const chain = order?.chain || {};
  if (chain.shipConfirmed === true) return true;
  if (Number(chain.shipConfirmedHeight || 0) > 0) return true;
  const txid = String(chain.shipTxid || "").trim().toLowerCase();
  if (!txid) return false;
  const recent = Array.isArray(state.recentRawtxs) ? state.recentRawtxs : [];
  const recentRow = recent.find((row) => String(row?.txid || "").trim().toLowerCase() === txid);
  return recentRow?.confirmed === true;
}

function orderPendingConfirmation(order) {
  if (String(order?.status || "") !== "PLACED") return false;
  // The order API validates transaction context before accepting. The order
  // bootstrap domain does not include recentRawtxs, so blocking here can leave
  // a valid visible place transaction stuck in the seller UI.
  return false;
}

function orderShipWaitState(order) {
  const acceptedAtHeight = Math.max(0, Number(order?.chain?.sellerLockAcceptedAtHeight || 0));
  const localHeight = Math.max(0, Number(state?.sync?.localHeight || 0));
  return {
    acceptedAtHeight,
    localHeight,
    waiting: String(order?.status || "") === "LOCKED" && acceptedAtHeight > 0 && localHeight <= acceptedAtHeight,
  };
}

function orderShipWaitNoticeHtml(order) {
  const shipWait = orderShipWaitState(order);
  if (!shipWait.waiting) return "";
  return `<p class="hint order-ship-wait-tip">${escapeHtml(trf("seller_order_wait_ship_block_tip", { current: shipWait.localHeight, accepted: shipWait.acceptedAtHeight }, `等待确认完成后才可发货。当前高度 ${shipWait.localHeight}，确认订单高度 ${shipWait.acceptedAtHeight}`))}</p>`;
}

function isStandardBuyerLockScriptHex(scriptHex = "") {
  return /^76a914[0-9a-f]{40}88ac$/i.test(String(scriptHex || "").trim());
}

function sellerCancelRequestText(order = null) {
  const scriptHex = String(order?.chain?.buyerLockRedeemScriptHex || "").trim();
  if (scriptHex && isStandardBuyerLockScriptHex(scriptHex)) {
    return tr(
      "seller_order_cancel_request_standard_lock",
      "当前订单使用标准买家锁脚本，将按协议广播卖家取消请求；买家钱包同步到请求后完成退款取消。",
    );
  }
  return tr(
    "seller_order_cancel_direct_notice",
    "将广播卖家取消请求；如订单脚本支持安全直接取消，系统会完成取消退款。",
  );
}

function sellerOrderActionButtonsHtml(order) {
  const pendingConfirmation = orderPendingConfirmation(order);
  const acceptable = order.status === "PLACED" && !pendingConfirmation;
  const cancelable = order.status === "PLACED";
  const shipWait = orderShipWaitState(order);
  const shippable = order.status === "LOCKED" && !shipWait.waiting;
  const acceptReturnable = order.status === "REFUND_REQUESTED";
  const safeOrderId = escapeHtml(order.id || "");
  let waitTip = "";
  if (pendingConfirmation) {
    waitTip = `<p class="hint">${escapeHtml(tr("seller_order_wait_confirm_tip", "下单交易未确认，请等待区块确认后再确认订单。当前仅允许取消。"))}</p>`;
  } else if (shipWait.waiting) {
    waitTip = orderShipWaitNoticeHtml(order);
  }
  const buttons = [];
  if (acceptable) {
    buttons.push(`<button data-seller-order-action="accept" data-order-id="${safeOrderId}">${escapeHtml(tr("seller_order_action_accept_order", "确认订单"))}</button>`);
  }
  if (cancelable) {
    buttons.push(`<button data-seller-order-action="sellerCancel" data-order-id="${safeOrderId}" title="${escapeHtml(sellerCancelRequestText(order))}">${escapeHtml(tr("seller_order_action_cancel", "取消订单"))}</button>`);
  }
  if (order.status === "LOCKED") {
    const shipTitle = shipWait.waiting
      ? escapeHtml(trf("seller_order_wait_ship_block_tip", { current: shipWait.localHeight, accepted: shipWait.acceptedAtHeight }, `等待确认完成后才可发货。当前高度 ${shipWait.localHeight}，确认订单高度 ${shipWait.acceptedAtHeight}`))
      : "";
    buttons.push(`<button data-seller-order-action="ship" data-order-id="${safeOrderId}" title="${shipTitle}" ${shippable ? "" : "disabled"}>${escapeHtml(tr("seller_order_action_ship", "Confirm shipment"))}</button>`);
  }
  if (acceptReturnable) {
    buttons.push(`<button data-seller-order-action="confirmRefund" data-order-id="${safeOrderId}">${escapeHtml(tr("seller_order_action_accept_return", "Confirm return"))}</button>`);
  }
  buttons.push(`<button class="order-chat-unread-anchor" data-seller-order-action="chat" data-order-id="${safeOrderId}">${escapeHtml(tr("order_action_chat", "Chat"))}${orderChatUnreadDotHtml(order.id || "")}</button>`);
  return `${waitTip}${buttons.join("")}`;
}

function orderLockRowsHtml(order) {
  const funds = order?.funds || {};
  const buyerLocked = Number(funds.buyerLockedSats || 0);
  const sellerLocked = Number(funds.sellerLockedSats || funds.sellerDepositSats || 0);
  const priceSats = orderAmountSats(order);
  const buyerDeposit = Math.max(0, buyerLocked - priceSats);
  const sellerDeposit = Number(funds.sellerDepositSats || sellerLocked || 0);
  const settlementFee = Math.max(0, Number(order?.chain?.sellerSettlementFeeSats || 0));
  const shipFee = Math.max(0, Number(order?.chain?.sellerShipAnchorFeeSats || 0));
  const feeRows = [
    settlementFee > 0
      ? `<div class="order-party-seller"><span>${escapeHtml(tr("seller_settlement_fee_reserve_label", "确认收货结算费预留"))}</span><strong>${escapeHtml(fmtSatAsBsv(settlementFee))}</strong></div>`
      : "",
    shipFee > 0
      ? `<div class="order-party-seller"><span>${escapeHtml(tr("seller_ship_fee_estimate_label", "预计发货上链费"))}</span><strong>${escapeHtml(fmtSatAsBsv(shipFee))}</strong></div>`
      : "",
  ].join("");
  return `<div class="order-detail-grid">
    <div><span>${escapeHtml(tr("order_time_label", "时间"))}</span><strong>${escapeHtml(orderDisplayTime(order))}</strong></div>
    <div><span>${escapeHtml(tr("labelQuantity", "数量"))}</span><strong>${orderQuantity(order)}</strong></div>
    <div><span>${escapeHtml(tr("order_amount_label", "商品金额"))}</span><strong>${escapeHtml(fmtSatAsBsv(priceSats))}</strong></div>
    <div class="order-party-buyer"><span>${escapeHtml(tr("buyer_locked_label", "买方锁定"))}</span><strong>${escapeHtml(fmtSatAsBsv(buyerLocked))}</strong></div>
    <div class="order-party-buyer"><span>${escapeHtml(tr("buyer_deposit_label", "买方保证金"))}</span><strong>${escapeHtml(fmtSatAsBsv(buyerDeposit))}</strong></div>
    <div class="order-party-seller"><span>${escapeHtml(tr("seller_locked_label", "卖方锁定"))}</span><strong>${escapeHtml(fmtSatAsBsv(sellerLocked))}</strong></div>
    <div class="order-party-seller"><span>${escapeHtml(tr("seller_deposit_label", "卖方保证金"))}</span><strong>${escapeHtml(fmtSatAsBsv(sellerDeposit))}</strong></div>
    ${feeRows}
  </div>`;
}

function orderShipmentRowsHtml(order) {
  const chain = order?.chain || {};
  const shipTxid = String(chain.shipTxid || "").trim();
  const shipmentInfoRaw = String(chain.shipmentInfo || "").trim();
  if (!shipTxid && !shipmentInfoRaw) return "";
  const shipmentInfo = shipmentInfoRaw || tr("order_shipment_info_empty", "未填写");
  const confirmed = orderShipConfirmed(order)
    ? tr("wallet_confirmed", "Confirmed")
    : tr("wallet_unconfirmed", "Unconfirmed");
  return `<div class="order-detail-grid order-shipment-grid">
    <div><span>${escapeHtml(tr("seller_ship_info_label", "发货信息"))}</span><strong>${escapeHtml(shipmentInfo)}</strong></div>
    <div><span>${escapeHtml(tr("order_ship_tx_label", "发货交易"))}</span><strong class="mono">${escapeHtml(shipTxid || "-")}</strong></div>
    <div><span>${escapeHtml(tr("wallet_status_label", "状态"))}</span><strong>${escapeHtml(confirmed)}</strong></div>
  </div>`;
}

function renderOrderDetailModal() {
  if (!els.orderDetailModal || !els.orderDetailBody || !els.orderDetailActions) return;
  const detail = state.ui.orderDetail || {};
  const order = findOrderById(detail.orderId);
  const role = detail.role === "seller" ? "seller" : "buyer";
  if (!order) {
    if (els.orderDetailTitle) els.orderDetailTitle.textContent = tr("order_detail_title", "订单详情");
    els.orderDetailBody.innerHTML = `<div class="row">${escapeHtml(tr("order_not_found", "订单不存在"))}</div>`;
    els.orderDetailActions.innerHTML = "";
    return;
  }
  const status = orderStatusLabel(order.status || "", order);
  if (els.orderDetailTitle) els.orderDetailTitle.textContent = tr("order_detail_title", "订单详情");
  const productLine = String(orderProductLine(order) || "").trim();
  const productTitle = String(orderProductTitle(order) || "").trim();
  const productLineHtml = productLine && productLine !== productTitle
    ? `<p class="hint">${escapeHtml(productLine)}</p>`
    : "";
  els.orderDetailBody.innerHTML = `<div class="order-detail-summary">
    <p><strong>${escapeHtml(orderProductTitle(order))}</strong></p>
    ${productLineHtml}
    <p class="hint">${escapeHtml(order.id || "")} / ${escapeHtml(status)}</p>
    ${orderLockRowsHtml(order)}
    ${orderShipmentRowsHtml(order)}
    ${orderStatusBarHtml(order)}
  </div>`;
  els.orderDetailActions.innerHTML = role === "seller" ? sellerOrderActionButtonsHtml(order) : buyerOrderActionButtonsHtml(order);
}

function openOrderDetailModal(orderId, role = "buyer") {
  state.ui.orderDetail = { orderId: String(orderId || ""), role: role === "seller" ? "seller" : "buyer" };
  clearOrderNotification(state.ui.orderDetail.role);
  renderOrderDetailModal();
  if (els.orderDetailModal) els.orderDetailModal.classList.remove("hidden");
}

function closeOrderDetailModal() {
  if (els.orderDetailModal) els.orderDetailModal.classList.add("hidden");
}

function renderOrders() {
  if (!isDomainLoaded("order")) {
    els.orderListBuyer.innerHTML = `<div class="row">${escapeHtml(tr("orders_not_loaded", "Orders not loaded yet. Switch roles or use an order action to load them."))}</div>`;
    els.orderListSeller.innerHTML = `<div class="row">${escapeHtml(tr("orders_not_loaded", "Orders not loaded yet. Switch roles or use an order action to load them."))}</div>`;
    renderOrderHistoryModal();
    return;
  }
  const buyerList = activeBuyerOrders().slice().sort(compareOrdersByOrderTimeDesc);
  const sellerList = filteredOrders().slice().sort(compareOrdersByOrderTimeDesc);
  if (!buyerList.length) {
    els.orderListBuyer.innerHTML = `<div class="row">${escapeHtml(tr("orders_empty", "No orders yet"))}</div>`;
  } else {
    els.orderListBuyer.innerHTML = buyerList.map((o) => renderOrderRow(o, "buyer")).join("");
  }
  if (!sellerList.length) {
    els.orderListSeller.innerHTML = `<div class="row">${escapeHtml(tr("orders_empty", "No orders yet"))}</div>`;
  } else {
    els.orderListSeller.innerHTML = sellerList.map((o) => renderOrderRow(o, "seller")).join("");
  }
  renderOrderHistoryModal();
  if (els.orderDetailModal && !els.orderDetailModal.classList.contains("hidden")) {
    renderOrderDetailModal();
  }
}

function renderOrderHistoryModal() {
  if (!els.orderHistoryList || !els.orderHistoryPageInfo) return;
  const rows = historicalBuyerOrders().slice().sort(compareOrdersByOrderTimeDesc);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.orderHistoryPage = Math.min(totalPages, Math.max(1, Number(state.orderHistoryPage || 1)));
  const start = (state.orderHistoryPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  els.orderHistoryList.innerHTML = pageRows.length
    ? pageRows.map((o) => renderOrderRow(o, "buyer")).join("")
    : `<div class="row">${escapeHtml(tr("orders_empty", "No orders yet"))}</div>`;
  els.orderHistoryPageInfo.textContent = `${state.orderHistoryPage} / ${totalPages}`;
  if (els.btnOrderHistoryPrev) els.btnOrderHistoryPrev.disabled = state.orderHistoryPage <= 1;
  if (els.btnOrderHistoryNext) els.btnOrderHistoryNext.disabled = state.orderHistoryPage >= totalPages;
}

function handleBuyerOrderActionButton(btn) {
  if (!btn) return;
  setDomainLoaded("order", true);
  const orderId = btn.dataset.orderId;
  const action = btn.dataset.orderAction;
  if (action === "chat") {
    closeOrderDetailModal();
    return openOrderChat(orderId).catch((err) => toast(err.message));
  }
  const map = { confirmReceipt: "confirmReceipt", requestRefund: "requestRefund" };
  const successTextMap = {
    confirmReceipt: tr("order_action_confirm_success", "确认收货成功"),
    requestRefund: tr("order_action_refund_success", "退款申请已提交"),
  };
  const progressTitleMap = {
    confirmReceipt: tr("order_confirm_progress_title", "确认收货并广播"),
    requestRefund: tr("order_refund_progress_title", "发起退款申请并广播"),
  };
  const progressSummaryMap = {
    confirmReceipt: tr("order_confirm_progress_summary", "正在生成确认收货交易并广播..."),
    requestRefund: tr("order_refund_progress_summary", "正在生成退款申请交易并广播..."),
  };
  if (!map[action]) return;
  const launchAction = () => runOrderChainActionWithProgress(orderId, map[action], {
    progressTitle: progressTitleMap[action],
    progressSummary: progressSummaryMap[action],
  });
  const runner = async () => {
    if (action === "confirmReceipt") {
      const order = findOrderById(orderId);
      if (!orderShipConfirmed(order)) {
        toast(tr("buyer_order_wait_ship_confirmed", "等待发货交易区块确认后才可确认收货"));
        return null;
      }
      const confirmed = await openConflictModal({
        title: tr("buyer_order_confirm_receipt_title", "确认收货"),
        message: `${tr("buyer_order_confirm_receipt_message", "确认已经收到商品？确认后将生成链上结算交易，商品金额转给卖家，双方保证金按协议退回。")}\n\n${tr("order_amount_label", "商品金额")}: ${fmtSatAsBsv(orderAmountSats(findOrderById(orderId)))}\n${tr("labelQuantity", "数量")}: ${orderQuantity(findOrderById(orderId) || {})}`,
        cancelLabel: tr("btnCancel", "取消"),
        confirmLabel: tr("order_action_confirm", "Confirm receipt"),
        closeValue: null,
        cancelValue: false,
        confirmValue: true,
      });
      if (confirmed !== true) return null;
    }
    if (action === "requestRefund") {
      const order = findOrderById(orderId);
      if (!orderShipConfirmed(order)) {
        toast(tr("buyer_order_wait_ship_confirmed", "等待发货交易区块确认后才可确认收货"));
        return null;
      }
      const confirmed = await openConflictModal({
        title: tr("buyer_order_request_return_title", "申请退货"),
        message: `${tr("buyer_order_request_return_message", "确认申请退货？申请后订单进入退货中，等待卖家确认退货并结算。")}\n\n${tr("order_amount_label", "商品金额")}: ${fmtSatAsBsv(orderAmountSats(findOrderById(orderId)))}\n${tr("labelQuantity", "数量")}: ${orderQuantity(findOrderById(orderId) || {})}`,
        cancelLabel: tr("btnCancel", "取消"),
        confirmLabel: tr("order_action_return", "Request return"),
        closeValue: null,
        cancelValue: false,
        confirmValue: true,
      });
      if (confirmed !== true) return null;
    }
    return launchAction();
  };
  runner()
    .then((result) => {
      if (result === null) return;
      const msg = successTextMap[action];
      if (msg) toast(msg);
      closeOrderDetailModal();
    })
    .catch(() => {});
}

function handleSellerOrderActionButton(btn) {
  if (!btn) return;
  setDomainLoaded("order", true);
  const orderId = btn.dataset.orderId;
  const action = btn.dataset.sellerOrderAction;
  if (action === "chat") {
    closeOrderDetailModal();
    return openOrderChat(orderId).catch((err) => toast(err.message));
  }
  const order = state.orders.find((item) => String(item?.id || "") === String(orderId || ""));
  const map = { accept: "accept", ship: "ship", confirmRefund: "confirmRefund", sellerCancel: "sellerCancel" };
  const successTextMap = {
    accept: tr("seller_order_action_accept_success", "订单确认成功"),
    ship: tr("seller_order_action_ship_success", "发货成功"),
    confirmRefund: tr("seller_order_action_refund_success", "退款确认成功"),
    sellerCancel: tr("seller_order_action_cancel_success", "取消请求已广播，等待买家钱包完成退款取消"),
  };
  const progressTitleMap = {
    accept: tr("seller_order_accept_progress_title", "确认订单并广播"),
    ship: tr("seller_order_ship_progress_title", "发货并广播"),
    confirmRefund: tr("seller_order_refund_progress_title", "确认退款并广播"),
    sellerCancel: tr("seller_order_cancel_progress_title", "广播取消请求"),
  };
  const progressSummaryMap = {
    accept: tr("seller_order_accept_progress_summary", "正在生成确认订单交易并广播..."),
    ship: tr("seller_order_ship_progress_summary", "正在生成发货状态交易并广播..."),
    confirmRefund: tr("seller_order_refund_progress_summary", "正在生成退款结算交易并广播..."),
    sellerCancel: tr("seller_order_cancel_progress_summary", "正在广播卖家取消请求，买家钱包同步后完成退款取消..."),
  };
  let executedAction = action;
  const launchAction = (resolvedAction, extraBody = null) => {
    executedAction = resolvedAction;
    return runOrderChainActionWithProgress(orderId, map[resolvedAction], {
      order,
      progressTitle: progressTitleMap[resolvedAction],
      progressSummary: progressSummaryMap[resolvedAction],
      extraBody,
    });
  };
  const runner = async () => {
    if (action === "accept" && order) {
      const confirmed = await openSellerAcceptConfirmModal(order);
      if (confirmed === true) return launchAction("accept");
      if (confirmed === false) return launchAction("sellerCancel");
      return null;
    }
    if (action === "sellerCancel") {
      const confirmed = await openConflictModal({
        title: tr("seller_order_cancel_confirm_title", "确认取消订单"),
        message: sellerCancelRequestText(order),
        cancelLabel: tr("btnKeepOrder", "保留订单"),
        confirmLabel: tr("seller_order_cancel_confirm_button", "广播取消请求"),
        closeValue: null,
        cancelValue: false,
        confirmValue: true,
      });
      if (confirmed !== true) return null;
    }
    if (action === "ship") {
      const shipmentInfo = await openShipmentInfoModal(order);
      if (shipmentInfo === null) return null;
      return launchAction("ship", { shipmentInfo });
    }
    return launchAction(action);
  };
  runner()
    .then(() => {
      const msg = successTextMap[executedAction];
      if (msg) toast(msg);
      closeOrderDetailModal();
    })
    .catch(() => {});
}

function renderRolePanels() {
  document.querySelectorAll(".tabs .tab[data-role]").forEach((t) => t.classList.toggle("active", t.dataset.role === state.activeRole));
  els.buyerPanel.classList.toggle("hidden", state.activeRole !== "buyer");
  if (els.buyerOrdersSection) els.buyerOrdersSection.classList.toggle("hidden", state.activeRole !== "buyer");
  els.sellerPanel.classList.toggle("hidden", state.activeRole !== "seller");
  renderOrderNotificationBadges();
}

async function fetchChatMessages(options = {}) {
  const walletId = String(options.walletId ?? state.chat.activeWalletId ?? "").trim();
  if (!walletId) return [];
  const mode = String(options.mode ?? state.chat.mode ?? "global").trim() || "global";
  const orderId = mode === "order" ? String(options.orderId ?? state.chat.activeOrderId ?? "").trim() : "";
  const currentPage = Math.max(1, Number(options.page ?? state.chat.messagePage ?? 1));
  const cached = getChatThreadCacheEntry(walletId, mode, orderId);
  if (currentPage === 1 && cached?.loaded === true) {
    if (walletId === String(state.chat.activeWalletId || "") && mode === String(state.chat.mode || "global")) {
      state.chat.lastFetchedMessageCount = Math.max(0, Number(cached.lastFetchedCount || cached.messages.length));
    }
    return mergeChatMessagesSorted(cached.messages || []);
  }
  const q = new URLSearchParams({
    walletId,
    pageSize: String(currentChatPageSize()),
    page: String(currentPage),
  });
  if (mode === "order") q.set("orderId", orderId);
  setChatThreadLoading(walletId, mode, orderId, true);
  updateChatComposeState();
  let r = null;
  try {
    r = await api(`/api/chat/thread?${q.toString()}`);
  } catch (err) {
    setChatThreadBackendReady(walletId, mode, orderId, false);
    throw err;
  } finally {
    setChatThreadLoading(walletId, mode, orderId, false);
  }
  const rows = Array.isArray(r.messages) ? r.messages : [];
  if (walletId === String(state.chat.activeWalletId || "") && mode === String(state.chat.mode || "global")) {
    state.chat.lastFetchedMessageCount = rows.length;
  }
  const pending = (state.chat.pendingLocalMessages || []).filter((m) => {
    if (String(m?.walletId || "") !== walletId) return false;
    if (mode === "order") return String(m?.orderId || "") === orderId;
    return !m?.orderId;
  });
  const filtered = mode === "order"
    ? rows.filter((m) => String(m.orderId || "") === orderId)
    : rows.filter((m) => !m.orderId);
  const seenMsgIds = new Set(filtered.map((m) => String(m?.msgId || "")).filter(Boolean));
  if (seenMsgIds.size > 0) {
    state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((m) => {
      const msgId = String(m?.msgId || "");
      if (!msgId) return true;
      return !seenMsgIds.has(msgId);
    });
  }
  const current = getChatThreadCacheEntry(walletId, mode, orderId);
  const mergedRows = currentPage > 1
    ? mergeChatMessagesSorted(resequenceChatMessagesForPrepend(filtered, Array.isArray(current?.messages) ? current.messages : []))
    : mergeChatMessagesSorted(filtered);
  setChatThreadCacheEntry(mergedRows, {
    walletId,
    mode,
    orderId: mode === "order" ? orderId : null,
    page: currentPage,
    loaded: true,
    lastFetchedCount: rows.length,
  });
  setChatThreadBackendReady(walletId, mode, orderId, true);
  updateChatComposeState();
  upsertChatPair(walletId, {
    inList: true,
    summaryLoaded: true,
  });
  if (walletId === String(state.chat.activeWalletId || "") && mode === String(state.chat.mode || "global")) {
    return buildRenderableChatMessages();
  }
  return mergeChatMessagesSorted(mergedRows.concat(pending));
}

function renderChatUsers() {
  const renderStartedAt = performance.now();
  if (state.chat.mode === "order") {
    els.chatUserPane.innerHTML = "";
    state.chat.searchResults = [];
    renderChatStatusBar();
    debugChatOpenPerf("users_render_done", {
      renderMs: Math.round(performance.now() - renderStartedAt),
      mode: "order",
    });
    return;
  }
  const mergeUniqueThreads = (...groups) => {
    const out = [];
    const seen = new Set();
    groups.flat().forEach((row) => {
      const walletId = String(row?.walletId || "").trim();
      if (!walletId || seen.has(walletId)) return;
      seen.add(walletId);
      out.push(row);
    });
    return out;
  };
  const renderDrawer = (title, rows, options = {}) => {
    const list = Array.isArray(rows) ? rows : [];
    const openAttr = options.open === false ? "" : " open";
    const emptyText = String(options.emptyText || tr("chat_group_empty", "暂无用户"));
    const body = list.length ? list.map((thread) => renderChatUserRow(thread)).join("") : `<div class="chat-user-drawer-empty">${escapeHtml(emptyText)}</div>`;
    return `<details class="chat-user-drawer"${openAttr}><summary><span>${escapeHtml(title)}</span><span class="chat-user-drawer-count">${list.length}</span></summary><div class="chat-user-drawer-body">${body}</div></details>`;
  };
  const friends = Array.isArray(state.chat.friends) ? state.chat.friends : [];
  const allPeopleSource = String(state.chat.searchQuery || "").trim()
    ? (Array.isArray(state.chat.searchResults) ? state.chat.searchResults : [])
    : (Array.isArray(state.chat.people) ? state.chat.people : []);
  const allPeopleBase = mergeUniqueThreads(allPeopleSource).filter((row) => row?.isFriend !== true);
  els.chatUserPane.innerHTML = [
    renderDrawer(tr("chat_friends_group_title", "我的好友"), friends, {
      open: true,
      emptyText: tr("chat_friends_empty", "暂无好友"),
    }),
    renderDrawer(tr("chat_all_people_group_title", "所有人"), allPeopleBase, {
      open: true,
      emptyText: tr("chat_all_people_empty", "暂无可见用户"),
    }),
  ].join("");
  renderChatStatusBar();
  debugChatOpenPerf("users_render_done", {
    renderMs: Math.round(performance.now() - renderStartedAt),
    peopleCount: allPeopleBase.length,
    friendCount: friends.length,
  });
}

function renderChatUserRow(thread) {
  const uiThread = applyChatConnectStateToThread(thread);
  const walletId = String(uiThread?.walletId || "").trim();
  const unread = Number(uiThread?.unreadCount || 0);
  const statusText = currentChatStatusLabel(uiThread);
  const unreadDot = unread > 0 ? `<span class="chat-user-unread-dot" aria-hidden="true"></span>` : "";
  const direct = uiThread?.directConnected === true;
  const p2pLabel = direct ? tr("chat_p2p_disconnect_btn", "断开") : tr("chat_p2p_connect_btn", "P2P");
  const p2pTitle = direct
    ? tr("chat_p2p_disconnect_title", "断开当前 P2P 直连状态")
    : tr("chat_p2p_check_title", "检查非 HTTP P2P 直连状态");
  const p2pAction = direct ? `data-chat-disconnect="${escapeHtml(walletId)}"` : `data-chat-connect-test="${escapeHtml(walletId)}"`;
  const p2pClass = direct ? "chat-user-test connected" : "chat-user-test";
  const displayName = localizeDisplayName(uiThread?.displayName) || walletId || "";
  return `<div class="chat-user-row" data-chat-user-row="${escapeHtml(walletId)}" data-chat-user-context="${escapeHtml(walletId)}"><button class="chat-user${state.chat.activeWalletId === walletId ? " active" : ""}" data-chat-wallet="${escapeHtml(walletId)}">${unreadDot}<span>${escapeHtml(displayName)}</span><span class="chat-user-meta">${escapeHtml(statusText)}</span></button><button class="${p2pClass}" type="button" title="${escapeHtml(p2pTitle)}" ${p2pAction}>${escapeHtml(p2pLabel)}</button></div>`;
}

function updateChatUserRow(walletId) {
  const id = String(walletId || "").trim();
  if (!id || !els.chatUserPane) return false;
  const thread = threadByWalletId(id);
  if (!thread) return false;
  const selector = `[data-chat-user-row="${cssEscape(id)}"]`;
  const rows = Array.from(els.chatUserPane.querySelectorAll(selector));
  if (!rows.length) return false;
  const html = renderChatUserRow(thread);
  rows.forEach((row) => {
    row.outerHTML = html;
  });
  return true;
}

function renderChatMessageContent(rawText = "") {
  const parsed = parseChatAttachmentPayload(rawText);
  const text = parsed.isPayload ? parsed.text : String(rawText || "");
  const attachments = parsed.isPayload ? parsed.attachments : [];
  const textHtml = String(text || "").trim()
    ? `<div class="chat-message-text">${escapeHtml(text)}</div>`
    : "";
  const attachmentHtml = attachments.length
    ? `<div class="chat-message-attachments">${attachments.map((item) => {
      const name = escapeHtml(String(item?.fileName || "attachment").trim() || "attachment");
      const url = escapeHtml(String(item?.url || "").trim());
      const downloadUrl = escapeHtml(String(item?.downloadUrl || item?.url || "").trim());
      if (item?.isImage && url) {
        return `<a href="${downloadUrl || url}" target="_blank" rel="noopener"><img class="chat-image-attachment" src="${url}" alt="${name}" loading="lazy" /></a>`;
      }
      if (downloadUrl || url) {
        return `<a class="chat-file-attachment" href="${downloadUrl || url}" target="_blank" rel="noopener" download><span>📎</span><span>${name}</span></a>`;
      }
      return `<span class="chat-file-attachment"><span>📎</span><span>${name}</span></span>`;
    }).join("")}</div>`
    : "";
  return textHtml || attachmentHtml
    ? `${textHtml}${attachmentHtml}`
    : escapeHtml(tr("chat_message_content_unavailable", "[内容暂不可见]"));
}

function paintChatMessages(messages = [], options = {}) {
  const stickToBottom = options.stickToBottom !== false;
  const forceScrollBottom = options.forceScrollBottom === true;
  const chatBox = els.chatBox;
  if (!chatBox) return;
  const paintSignature = currentChatPaintSignature(messages);
  if (options.force !== true && !forceScrollBottom && state.chat.lastPaintSignature === paintSignature) return;
  state.chat.lastPaintSignature = paintSignature;
  const wasNearBottom = stickToBottom
    ? (chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight) < 80
    : false;
  if (!state.chat.activeWalletId) {
    chatBox.innerHTML = `<div class="log-item">${escapeHtml(tr("chat_select_contact_hint", "请选择左侧联系人以查看聊天记录"))}</div>`;
    return;
  }
  if (!messages.length) {
    chatBox.innerHTML = `<div class="log-item">${escapeHtml(tr("chat_messages_empty", "No messages yet"))}</div>`;
    return;
  }
  chatBox.innerHTML = messages.map((m) => {
    const transport = String(m.transport || "onchain") === "p2p" ? tr("chat_transport_p2p", "P2P") : tr("chat_transport_onchain_short", "链上");
    const statusMap = {
      draft: tr("chat_status_draft", "Draft"),
      sending: tr("chat_status_sending", "Sending"),
      broadcasted: tr("chat_status_broadcasted", "已广播"),
      visible: tr("chat_status_visible", "Visible"),
      delivered: tr("chat_status_delivered", "Delivered"),
      failed: tr("chat_status_failed", "Failed"),
    };
    const statusText = statusMap[String(m.status || "")] || String(m.status || "");
    const who = m.direction === "out" ? (localizeDisplayName(state.profile.name) || tr("chat_self_label", "我")) : (localizeDisplayName(currentChatThread()?.displayName) || tr("chat_other_party", "对方"));
    const sideClass = m.direction === "out" ? " chat-out" : " chat-in";
    const visibleMeta = m.direction === "out"
      ? (state.chat.messageMetaVisible?.self || {})
      : (state.chat.messageMetaVisible?.peer || {});
    const timeText = escapeHtml(new Date(m.ts).toLocaleTimeString());
    const contentHtml = renderChatMessageContent(m.text || "");
    const metaPartsOut = [];
    if (visibleMeta?.who) metaPartsOut.push(`&lt;${escapeHtml(who)}&gt;`);
    if (visibleMeta?.transport) metaPartsOut.push(`&lt;${escapeHtml(transport)}&gt;`);
    if (visibleMeta?.time) metaPartsOut.push(`&lt;${timeText}&gt;`);
    if (visibleMeta?.status) metaPartsOut.push(`&lt;${escapeHtml(statusText)}&gt;`);
    const metaPartsIn = [];
    if (visibleMeta?.status) metaPartsIn.push(`&lt;${escapeHtml(statusText)}&gt;`);
    if (visibleMeta?.time) metaPartsIn.push(`&lt;${timeText}&gt;`);
    if (visibleMeta?.transport) metaPartsIn.push(`&lt;${escapeHtml(transport)}&gt;`);
    if (visibleMeta?.who) metaPartsIn.push(`&lt;${escapeHtml(who)}&gt;`);
    const inlineText = m.direction === "in"
      ? `${metaPartsIn.join("")}${metaPartsIn.length ? "：" : ""}${contentHtml}`
      : `${contentHtml}${metaPartsOut.length ? `: ${metaPartsOut.join("")}` : ""}`;
    return `<div class="log-item${sideClass}"><div class="chat-msg-inline">${inlineText}</div></div>`;
  }).join("");
  if (forceScrollBottom || (stickToBottom && wasNearBottom)) {
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

async function renderChatMessages(options = {}) {
  const walletIdAtStart = String(state.chat.activeWalletId || "");
  const modeAtStart = String(state.chat.mode || "global");
  const orderIdAtStart = modeAtStart === "order" ? String(state.chat.activeOrderId || "") : "";
  const switchSeq = Number(options.switchSeq || state.chat.activeSwitchSeq || 0);
  if (!walletIdAtStart) {
    paintChatMessages([]);
    updateChatComposeState();
    return [];
  }
  const ensureLoaded = options?.ensureLoaded !== false;
  const cached = getChatThreadCacheEntry(walletIdAtStart, modeAtStart, orderIdAtStart);
  if (options.loadingIfEmpty === true && ensureLoaded && cached?.loaded !== true) {
    paintChatMessages([]);
  }
  const messages = ensureLoaded
    ? await fetchChatMessages({ walletId: walletIdAtStart, mode: modeAtStart, orderId: orderIdAtStart })
    : buildRenderableChatMessages();
  if (
    options.guardActive !== false
    && (
      String(state.chat.activeWalletId || "") !== walletIdAtStart
      || String(state.chat.mode || "global") !== modeAtStart
      || (modeAtStart === "order" && String(state.chat.activeOrderId || "") !== orderIdAtStart)
      || Number(state.chat.activeSwitchSeq || 0) !== switchSeq
    )
  ) {
    return;
  }
  paintChatMessages(messages, {
    stickToBottom: options.stickToBottom,
  });
  updateChatLoadMoreState();
  updateChatComposeState();
  return messages;
}

function syncChatDisplayMenu() {
  if (els.chatMetaSelfWho) els.chatMetaSelfWho.checked = state.chat.messageMetaVisible?.self?.who === true;
  if (els.chatMetaSelfTransport) els.chatMetaSelfTransport.checked = state.chat.messageMetaVisible?.self?.transport !== false;
  if (els.chatMetaSelfTime) els.chatMetaSelfTime.checked = state.chat.messageMetaVisible?.self?.time !== false;
  if (els.chatMetaSelfStatus) els.chatMetaSelfStatus.checked = state.chat.messageMetaVisible?.self?.status === true;
  if (els.chatMetaPeerWho) els.chatMetaPeerWho.checked = state.chat.messageMetaVisible?.peer?.who === true;
  if (els.chatMetaPeerTransport) els.chatMetaPeerTransport.checked = state.chat.messageMetaVisible?.peer?.transport !== false;
  if (els.chatMetaPeerTime) els.chatMetaPeerTime.checked = state.chat.messageMetaVisible?.peer?.time !== false;
  if (els.chatMetaPeerStatus) els.chatMetaPeerStatus.checked = state.chat.messageMetaVisible?.peer?.status === true;
}

function closeChatDisplayMenu() {
  if (els.chatDisplayMenuDropdown) els.chatDisplayMenuDropdown.classList.add("hidden");
}

function debugChatOpenPerf(stage, extra = {}) {
  const base = Number(state.chat?.openPerfStartedAt || 0);
  const elapsedMs = base ? Math.round(performance.now() - base) : 0;
  try {
    console.info("[chat-open-perf]", {
      stage: String(stage || ""),
      elapsedMs,
      ...extra,
    });
  } catch (_) {}
}

function toggleChatDisplayMenu() {
  if (!els.chatDisplayMenuDropdown) return;
  syncChatDisplayMenu();
  els.chatDisplayMenuDropdown.classList.toggle("hidden");
}

async function openGlobalChat(options = {}) {
  state.chat.openPerfStartedAt = performance.now();
  debugChatOpenPerf("click");
  state.chat.mode = "global";
  state.chat.activeOrderId = null;
  if (options.keepActiveWallet !== true) setActiveChatWallet("");
  setChatSurfaceMode("full");
  els.chatModal.classList.remove("hidden");
  renderChatUsers();
  debugChatOpenPerf("modal_first_paint", {
    pairCount: Object.keys(state.chat.pairs || {}).length,
  });
  renderChatMessages({ ensureLoaded: false }).catch((err) => toast(err.message));
  const openSeq = Number(state.chat.activeSwitchSeq || 0);
  (async () => {
    const domainPromise = ensureDomainLoaded("chat", { render: false })
      .then(() => {
        debugChatOpenPerf("domain_loaded");
        if (state.chat.needsProfilePublish) {
          toast(localizeChatNotice(state.chat.migrationNotice) || tr("chat_publish_required", "To chat, save the chat profile and publish it on-chain first."));
        }
      });
    await refreshChatThreads();
    if (els.chatModal && !els.chatModal.classList.contains("hidden")) {
      renderChatUsers();
      debugChatOpenPerf("list_visible", {
        pairCount: Object.keys(state.chat.pairs || {}).length,
      });
      renderChatStatusBar();
      if (Number(state.chat.activeSwitchSeq || 0) === openSeq) {
        renderChatMessages({ ensureLoaded: false }).catch((err) => toast(err.message));
      }
    }
    await domainPromise;
  })().catch((err) => toast(err.message));
}

async function openChatThreadWindow(options = {}) {
  const walletId = String(options.walletId || "").trim();
  if (!walletId) return;
  state.chat.mode = String(options.mode || "global").trim() || "global";
  state.chat.activeOrderId = state.chat.mode === "order" ? String(options.orderId || "") : null;
  setActiveChatWallet(walletId);
  setChatSurfaceMode("thread", {
    title: String(options.title || "").trim(),
    productId: String(options.productId || "").trim(),
    orderId: String(options.orderId || "").trim(),
    source: String(options.source || "").trim(),
  });
  els.chatModal.classList.remove("hidden");
  upsertChatPair(walletId, {
    inList: true,
    summaryLoaded: Boolean(threadByWalletId(walletId)?.summaryLoaded),
    displayName: String(options.displayName || ""),
  });
  rebuildChatPairCollections();
  renderChatUsers();
  renderChatStatusBar();
  renderChatMessages({ ensureLoaded: false, loadingIfEmpty: true }).catch((err) => toast(err.message));
  const switchSeq = Number(state.chat.activeSwitchSeq || 0);
  (async () => {
    await ensureDomainLoaded("chat", { render: false });
    if (state.chat.needsProfilePublish) {
      toast(localizeChatNotice(state.chat.migrationNotice) || tr("chat_publish_required", "To chat, save the chat profile and publish it on-chain first."));
      return;
    }
    if (!threadByWalletId(walletId)?.summaryLoaded) {
      await refreshChatThreads();
    } else {
      rebuildChatPairCollections();
    }
    if (
      els.chatModal
      && !els.chatModal.classList.contains("hidden")
      && String(state.chat.activeWalletId || "") === walletId
      && Number(state.chat.activeSwitchSeq || 0) === switchSeq
    ) {
      renderChatUsers();
      renderChatStatusBar();
      await renderChatMessages({ ensureLoaded: true, switchSeq, loadingIfEmpty: true });
      refreshCurrentChatDirectStatus()
        .then(() => renderChatUsers())
        .catch(() => {});
      scheduleMarkActiveChatThreadRead(250);
    }
  })().catch((err) => toast(err.message));
}

async function openOrderChat(orderId) {
  await ensureDomainLoaded("order", { render: false });
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const product = state.products.find((p) => p.id === order.snapshot.product_id);
  const walletId = await resolveOrderChatWalletIdWithPubKeyFallback(order, resolveOrderChatWalletId(order));
  if (!walletId || walletId === currentChatWalletId()) {
    toast(tr("chat_product_peer_missing", "没有找到这个商品对应的聊天用户"));
    return;
  }
  await openChatThreadWindow({
    walletId,
    mode: "order",
    orderId,
    productId: String(product?.id || order.snapshot?.product_id || ""),
    title: trf("chat_order_title", { orderId: String(orderId || "") }, `Order chat ${String(orderId || "")}`),
    source: "order",
  });
  clearOrderChatUnread(orderId);
}

async function openProductChat(productId, options = {}) {
  const product = options.product && typeof options.product === "object"
    ? options.product
    : state.products.find((p) => String(p?.id || "") === String(productId || "")) || null;
  const walletId = String(options.walletId || resolveProductChatWalletId(product || productId) || "").trim();
  if (!walletId) {
    toast(tr("chat_product_peer_missing", "没有找到这个商品对应的聊天用户"));
    return;
  }
  const title = String(options.title || "").trim()
    || trf("chat_product_title", { title: String(product?.title || productId || "") }, `商品聊天 ${String(product?.title || productId || "")}`);
  await openChatThreadWindow({
    walletId,
    mode: String(options.mode || "global"),
    productId: String(product?.id || productId || ""),
    title,
    displayName: String(options.displayName || ""),
    source: "product",
  });
}

globalThis.BsvMarketChat = {
  openThread: openChatThreadWindow,
  openFull: openGlobalChat,
  openOrder: openOrderChat,
  openProduct: openProductChat,
};

function buildP2PMsgId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildP2PSignature(userId, text, msgId) {
  return btoa(unescape(encodeURIComponent(`${userId}|${msgId}|${text}`))).slice(0, 80);
}

function closeChatFeeModal(confirmed = false) {
  if (els.chatFeeModal) els.chatFeeModal.classList.add("hidden");
  const resolver = state.ui.chatFeeResolver;
  state.ui.chatFeeResolver = null;
  if (typeof resolver === "function") resolver(Boolean(confirmed));
}

function openChatFeeModal(preview = {}) {
  return new Promise((resolve) => {
    state.ui.chatFeeResolver = resolve;
    pushWalletLog(tr("chat_fee_confirm_log", "Chat fee confirmation"), {
      walletId: state.chat.activeWalletId || "",
      feeSat: Number(preview.feeSat || 0),
      directConnected: Boolean(preview.directConnected),
      transport: String(preview.transport || ""),
    });
    if (els.chatFeeMessage) {
      els.chatFeeMessage.textContent = trf("chat_fee_message_dynamic", { feeSat: Number(preview.feeSat || 0) }, `No direct P2P link is available. This message will be sent on-chain. Estimated fee ${Number(preview.feeSat || 0)} sat. Continue?`);
    }
    if (els.chatFeeModal) els.chatFeeModal.classList.remove("hidden");
    if (els.btnConfirmChatFee) {
      setTimeout(() => els.btnConfirmChatFee.focus(), 0);
    }
  });
}

async function sendChat() {
  const text = els.chatInput.value.trim();
  const attachments = Array.isArray(state.chat.pendingAttachments) ? state.chat.pendingAttachments.slice() : [];
  if ((!text && !attachments.length) || !state.chat.activeWalletId) return;
  if (!isChatThreadBackendReady(state.chat.activeWalletId, state.chat.mode, state.chat.activeOrderId)) {
    updateChatComposeState();
    toast(tr("chat_thread_not_ready", "聊天后台状态未就绪"));
    return;
  }
  const perfStart = performance.now();
  const activeWalletId = String(state.chat.activeWalletId || "");
  const activeMode = String(state.chat.mode || "global");
  const activeOrderId = activeMode === "order" ? String(state.chat.activeOrderId || "") : null;
  const messageText = encodeChatAttachmentPayload(text, attachments);
  const tempMsgId = `local:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const tempTs = new Date().toISOString();
  const optimisticMessage = {
    msgId: tempMsgId,
    clientMsgId: tempMsgId,
    walletId: activeWalletId,
    orderId: activeMode === "order" ? activeOrderId : null,
    transport: "pending",
    direction: "out",
    text: messageText,
    ts: tempTs,
    status: "sending",
    __sortTs: tempTs,
    __orderSeq: allocateChatMessageSequence(),
  };
  state.chat.pendingLocalMessages.push(optimisticMessage);
  upsertChatMessageInCache(optimisticMessage, {
    walletId: activeWalletId,
    mode: activeMode,
    orderId: activeOrderId,
  });
  els.chatInput.value = "";
  state.chat.pendingAttachments = [];
  renderChatAttachmentPreview();
  paintChatMessages(buildRenderableChatMessages(), { forceScrollBottom: true });
  updateChatComposeState();
  let forceOnchain = false;
  let directStatus = getCachedChatDirectStatus(activeWalletId);
  if (directStatus?.directConnected === true) {
    refreshCurrentChatDirectStatus().catch(() => null);
  } else {
    directStatus = await refreshCurrentChatDirectStatus();
  }
  if (directStatus?.directConnected !== true) {
    if (attachments.length) {
      state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((m) => String(m?.msgId || "") !== tempMsgId);
      removeChatMessageFromCache(tempMsgId, {
        walletId: activeWalletId,
        mode: activeMode,
        orderId: activeOrderId,
      });
      if (!String(els.chatInput.value || "").trim()) els.chatInput.value = text;
      state.chat.pendingAttachments = attachments;
      renderChatAttachmentPreview();
      paintChatMessages(buildRenderableChatMessages());
      updateChatComposeState();
      toast(tr("chat_attachment_requires_p2p", "附件只能在 P2P 直连后发送，请先连接对方"));
      return;
    }
    state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).map((m) => (
      m.msgId === tempMsgId ? { ...m, transport: "onchain", status: "pending_confirm" } : m
    ));
    const confirmPendingMessage = (state.chat.pendingLocalMessages || []).find((m) => m.msgId === tempMsgId);
    if (confirmPendingMessage) {
      upsertChatMessageInCache(confirmPendingMessage, {
        walletId: activeWalletId,
        mode: activeMode,
        orderId: activeOrderId,
      });
      paintChatMessages(buildRenderableChatMessages(), { forceScrollBottom: true });
    }
    const confirmed = await openChatFeeModal({
      ...(directStatus && typeof directStatus === "object" ? directStatus : {}),
      walletId: activeWalletId,
      transport: "onchain",
      directConnected: false,
      feeSat: Number(directStatus?.feeSat || 12),
    });
    if (!confirmed) {
      state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((m) => String(m?.msgId || "") !== tempMsgId);
      removeChatMessageFromCache(tempMsgId, {
        walletId: activeWalletId,
        mode: activeMode,
        orderId: activeOrderId,
      });
      if (!String(els.chatInput.value || "").trim()) els.chatInput.value = text;
      paintChatMessages(buildRenderableChatMessages());
      updateChatComposeState();
      return;
    }
    forceOnchain = true;
  }
  pushWalletLog(tr("chat_send_start_log", "Chat send started"), {
    trigger: "sendChat",
    walletId: activeWalletId,
    mode: activeMode,
    textBytes: text.length,
    forceOnchain,
    statusSource: String(directStatus?.source || ""),
    prepMs: Math.round(performance.now() - perfStart),
  });
  state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).map((m) => (
    m.msgId === tempMsgId
      ? { ...m, transport: forceOnchain ? "onchain" : "p2p" }
      : m
  ));
  const pendingMessage = (state.chat.pendingLocalMessages || []).find((m) => m.msgId === tempMsgId);
  if (pendingMessage) {
    upsertChatMessageInCache(pendingMessage, {
      walletId: pendingMessage.walletId,
      mode: activeMode,
      orderId: activeOrderId,
    });
  }
  paintChatMessages(buildRenderableChatMessages(), { forceScrollBottom: true });
  try {
    pushWalletLog(tr("chat_send_request_log", "Chat send request"), {
      walletId: activeWalletId,
      mode: activeMode,
      orderId: activeOrderId,
      forceOnchain,
    });
    const submitChatSend = () => api("/api/chat/send", {
      method: "POST",
      silent: true,
      timeoutMs: forceOnchain ? WALLET_OP_TIMEOUT_MS : 30000,
      body: {
        walletId: activeWalletId,
        text,
        clientMsgId: tempMsgId,
        attachmentIds: attachments.map((item) => String(item?.attachmentId || "").trim()).filter(Boolean),
        orderId: activeOrderId,
        forceOnchain,
      },
    });
    const sendResult = forceOnchain
      ? await runSynchronousChainAction(
          tr("chat_onchain_send_progress_title", "发送链上消息"),
          submitChatSend,
          { summary: tr("chat_onchain_send_progress_summary", "正在广播链上聊天消息...") },
        )
      : await submitChatSend();
    pushWalletLog(tr("chat_send_success_log", "Chat send succeeded"), {
      walletId: state.chat.activeWalletId,
      mode: activeMode,
    });
    const serverMessage = sendResult?.message && typeof sendResult.message === "object"
      ? sendResult.message
      : null;
    state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).map((m) => {
      if (m.msgId !== tempMsgId) return m;
      return {
        ...m,
        ...(serverMessage || {}),
        msgId: String(serverMessage?.msgId || m.msgId || tempMsgId),
        transport: String(serverMessage?.transport || m.transport || ""),
        direction: String(serverMessage?.direction || m.direction || "out"),
        text: String(serverMessage?.text || m.text || messageText),
        txid: String(serverMessage?.txid || m.txid || ""),
        status: String(serverMessage?.status || "broadcasted"),
        ts: String(serverMessage?.ts || m.ts || new Date().toISOString()),
        walletId: String(serverMessage?.walletId || m.walletId || activeWalletId || ""),
        orderId: serverMessage?.orderId ?? m.orderId ?? activeOrderId,
      };
    });
    if (serverMessage) {
      const serverMsgId = String(serverMessage.msgId || "").trim();
      upsertChatPair(String(serverMessage.walletId || activeWalletId || ""), {
        inList: true,
        summaryLoaded: true,
        lastMessage: chatMessagePreviewText(String(serverMessage.text || messageText)),
        lastTs: String(serverMessage.ts || new Date().toISOString()),
        lastMessageAt: String(serverMessage.ts || new Date().toISOString()),
        lastTransport: String(serverMessage.transport || ""),
        unreadCount: 0,
      });
      replaceChatMessageInCache(tempMsgId, {
        ...serverMessage,
        walletId: String(serverMessage.walletId || activeWalletId || ""),
        clientMsgId: String(serverMessage.clientMsgId || serverMessage.clientMessageId || tempMsgId),
      }, {
        walletId: String(serverMessage.walletId || activeWalletId || ""),
        mode: activeMode,
        orderId: activeOrderId,
      });
      state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).filter((m) => {
        const rowMsgId = String(m?.msgId || "").trim();
        const rowClientMsgId = String(m?.clientMsgId || m?.clientMessageId || rowMsgId || "").trim();
        return rowMsgId !== tempMsgId
          && (!serverMsgId || rowMsgId !== serverMsgId)
          && rowClientMsgId !== tempMsgId;
      });
    }
    rebuildChatPairCollections();
    renderChatUsers();
    paintChatMessages(buildRenderableChatMessages(), { forceScrollBottom: true });
  } catch (err) {
    if (attachments.length && !(state.chat.pendingAttachments || []).length) {
      state.chat.pendingAttachments = attachments;
      renderChatAttachmentPreview();
    }
    state.chat.pendingLocalMessages = (state.chat.pendingLocalMessages || []).map((m) => (
      m.msgId === tempMsgId ? { ...m, status: "failed" } : m
    ));
    const failed = (state.chat.pendingLocalMessages || []).find((m) => m.msgId === tempMsgId);
    if (failed) {
      upsertChatMessageInCache(failed, {
        walletId: failed.walletId,
        mode: activeMode,
        orderId: activeOrderId,
      });
    }
    pushWalletLog(tr("chat_send_failed_log", "Chat send failed"), {
      walletId: state.chat.activeWalletId,
      mode: activeMode,
      message: String(err?.message || err || ""),
    });
    paintChatMessages(buildRenderableChatMessages(), { forceScrollBottom: true });
    throw err;
  }
}

function maybeSubmitChatFromEnter(e) {
  if (!els.chatInput) return;
  if (e.key !== "Enter" || e.shiftKey) return;
  if (els.chatFeeModal && !els.chatFeeModal.classList.contains("hidden")) return;
  const now = Date.now();
  const isKeydown = e.type === "keydown";
  const composing = Boolean(e.isComposing);
  pushWalletLog(tr("chat_enter_trigger_log", "Chat Enter key triggered"), {
    eventType: e.type,
    isKeydown,
    composing,
    walletId: state.chat.activeWalletId || "",
    mode: state.chat.mode,
    textBytes: String(els.chatInput.value || "").trim().length,
  });
  e.preventDefault();
  if (isKeydown && composing) {
    state.ui.chatEnterSubmitLockUntil = now + 800;
    return;
  }
  if (!isKeydown && composing) return;
  if (Number(state.ui.chatEnterSubmitLockUntil || 0) > now) {
    if (isKeydown) return;
  }
  state.ui.chatEnterSubmitLockUntil = now + 300;
  sendChat().catch((err) => toast(err.message));
}

function insertChatEmoji(value) {
  const input = els.chatInput;
  const emoji = String(value || "");
  if (!input || !emoji || input.disabled) return;
  const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
  input.value = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  const nextPos = start + emoji.length;
  input.focus();
  if (typeof input.setSelectionRange === "function") {
    input.setSelectionRange(nextPos, nextPos);
  }
}

function renderChatAttachmentPreview() {
  const box = els.chatAttachmentPreview;
  if (!box) return;
  const list = Array.isArray(state.chat.pendingAttachments) ? state.chat.pendingAttachments : [];
  box.classList.toggle("hidden", list.length === 0);
  box.innerHTML = list.map((item) => {
    const id = escapeHtml(String(item?.attachmentId || ""));
    const name = escapeHtml(String(item?.fileName || "attachment").trim() || "attachment");
    const thumb = item?.isImage && item?.url
      ? `<img class="chat-attachment-thumb" src="${escapeHtml(String(item.url))}" alt="${name}" />`
      : `<span>📎</span>`;
    return `<span class="chat-attachment-chip" data-chat-attachment-chip="${id}">${thumb}<span class="chat-attachment-chip-name">${name}</span><button class="chat-attachment-remove" type="button" data-chat-attachment-remove="${id}" aria-label="${escapeHtml(tr("chat_attachment_remove", "Remove attachment"))}">✕</button></span>`;
  }).join("");
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",").pop() : raw);
    };
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

async function uploadChatAttachmentFile(file) {
  if (!file) return null;
  const dataBase64 = await readFileAsBase64(file);
  const result = await api("/api/chat/attachment/upload", {
    method: "POST",
    silent: true,
    timeoutMs: 60000,
    body: {
      fileName: String(file.name || "attachment"),
      mimeType: String(file.type || "application/octet-stream"),
      dataBase64,
    },
  });
  return result?.attachment || null;
}

async function handleChatAttachmentInputChange() {
  const files = Array.from(els.chatAttachmentInput?.files || []);
  if (!files.length) return;
  const remainingSlots = Math.max(0, 4 - Math.max(0, Number(state.chat.pendingAttachments?.length || 0)));
  const selected = files.slice(0, remainingSlots);
  if (!selected.length) {
    toast(tr("chat_attachment_limit", "一次最多发送 4 个附件"));
    return;
  }
  for (const file of selected) {
    const attachment = await uploadChatAttachmentFile(file);
    if (attachment) {
      state.chat.pendingAttachments = [...(state.chat.pendingAttachments || []), attachment];
      renderChatAttachmentPreview();
    }
  }
  if (els.chatAttachmentInput) els.chatAttachmentInput.value = "";
}

async function triggerChatConnectTest(walletId) {
  const targetWalletId = String(walletId || state.chat.activeWalletId || "").trim();
  if (!targetWalletId) return toast(tr("chat_select_contact_first", "请先选择一个联系人"));
  beginChatConnectCountdown(targetWalletId);
  const result = await api("/api/chat/connect/test", {
    method: "POST",
    silent: true,
    timeoutMs: 80000,
    body: { walletId: targetWalletId },
  });
  const status = result && typeof result === "object" ? result : await refreshChatDirectStatusForWallet(targetWalletId, { render: true, silent: true });
  if (status?.directConnected === true || result?.directConnected === true) {
    removeChatConnectState(targetWalletId);
    upsertChatPair(targetWalletId, {
      __forceConnectionStatus: true,
      directConnected: true,
      connecting: false,
      presenceStatus: String(status?.presenceStatus || "chatable"),
      statusLabel: String(status?.statusLabel || tr("chat_status_direct", "已连接")),
      activeSessionId: String(status?.activeSessionId || ""),
    });
    rebuildChatPairCollections();
    updateChatUserRow(targetWalletId) || renderChatUsers();
    renderChatStatusBar(status);
    toast(tr("chat_p2p_connected", "P2P 直连已连接"));
    return;
  }
  failChatConnectCountdown(targetWalletId, tr("chat_status_connect_failed", "连接失败"));
  toast(tr("chat_status_connect_failed", "连接失败"));
}

async function triggerChatDisconnect(walletId) {
  const targetWalletId = String(walletId || state.chat.activeWalletId || "");
  if (!targetWalletId) return toast(tr("chat_select_contact_first", "请先选择一个联系人"));
  removeChatConnectState(targetWalletId);
  await api("/api/chat/disconnect", { method: "POST", silent: true, body: { walletId: targetWalletId } });
  upsertChatPair(targetWalletId, {
    __forceConnectionStatus: true,
    directConnected: false,
    connecting: false,
    presenceStatus: "",
    statusLabel: "",
    activeSessionId: "",
  });
  rebuildChatPairCollections();
  updateChatUserRow(targetWalletId) || renderChatUsers();
  await refreshCurrentChatDirectStatus();
  updateChatUserRow(targetWalletId) || renderChatUsers();
  if (els.chatConfigStatus) els.chatConfigStatus.textContent = tr("chat_disconnected", "已断开");
}

async function toggleChatOnlineState() {
  const nextOnline = !(state.chat.selfState?.online !== false);
  if (els.btnChatToggleOnline) els.btnChatToggleOnline.disabled = true;
  try {
    await api("/api/chat/self-state", {
      method: "POST",
      body: { online: nextOnline },
    });
  } catch (err) {
    throw err;
  } finally {
    if (els.btnChatToggleOnline) els.btnChatToggleOnline.disabled = false;
  }
}

async function runChatFriendAction() {
  closeChatMenu();
  openChatFriendConfirmModal();
}

function collectChatFriendRows() {
  const rows = []
    .concat(Object.values(state.chat.pairs || {}))
    .concat(Array.isArray(state.chat.threads) ? state.chat.threads : [])
    .concat(Array.isArray(state.chat.people) ? state.chat.people : [])
    .concat(Array.isArray(state.chat.friends) ? state.chat.friends : [])
    .concat(Array.isArray(state.chat.searchResults) ? state.chat.searchResults : []);
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const walletId = String(row?.walletId || "").trim();
    if (!walletId || walletId === String(state.chat.selfWalletId || "") || seen.has(walletId)) return;
    seen.add(walletId);
    const merged = threadByWalletId(walletId) || row;
    const friendStatus = String(merged?.friendStatus || "none");
    if (merged?.isFriend === true || friendStatus === "incoming_pending" || friendStatus === "outgoing_pending" || friendStatus === "rejected") {
      out.push(merged);
    }
  });
  return out;
}

function renderChatFriendConfirmList() {
  if (!els.chatFriendConfirmList) return;
  const rows = collectChatFriendRows();
  if (!rows.length) {
    els.chatFriendConfirmList.innerHTML = `<div class="row">${escapeHtml(tr("chat_friend_confirm_empty", "暂无好友确认记录"))}</div>`;
    return;
  }
  els.chatFriendConfirmList.innerHTML = rows.map((row) => {
    const walletId = String(row?.walletId || "").trim();
    const status = String(row?.friendStatus || "none");
    const name = localizeDisplayName(row?.displayName) || walletId || "";
    const statusText = row?.isFriend === true
      ? tr("chat_friend_status_friend", "已是好友")
      : currentChatStatusLabel(row);
    const actions = status === "incoming_pending"
      ? `<button type="button" data-chat-friend-accept="${escapeHtml(walletId)}">${escapeHtml(tr("chat_friend_action_accept", "同意"))}</button><button type="button" class="ghost" data-chat-friend-reject="${escapeHtml(walletId)}">${escapeHtml(tr("chat_friend_action_reject", "拒绝"))}</button>`
      : "";
    return `<div class="chat-friend-confirm-row"><div><strong>${escapeHtml(name)}</strong><p class="hint mono">${escapeHtml(walletId)}</p><p class="hint">${escapeHtml(statusText)}</p></div><div class="actions inline">${actions}</div></div>`;
  }).join("");
}

function openChatFriendConfirmModal() {
  renderChatFriendConfirmList();
  if (els.chatFriendConfirmModal) els.chatFriendConfirmModal.classList.remove("hidden");
}

function closeChatFriendConfirmModal() {
  if (els.chatFriendConfirmModal) els.chatFriendConfirmModal.classList.add("hidden");
}

function refreshChatThreadsInBackground() {
  refreshChatThreads()
    .then(() => {
      renderChatUsers();
      renderChatFriendConfirmList();
    })
    .catch((err) => toast(err.message));
}

async function sendChatFriendRequest(walletId) {
  const id = String(walletId || "").trim();
  if (!id) return;
  const thread = threadByWalletId(id);
  const friendStatus = String(thread?.friendStatus || "none");
  if (thread?.isFriend === true || friendStatus === "incoming_pending" || friendStatus === "outgoing_pending" || friendStatus === "rejected") return;
  const result = await runSynchronousChainAction(
    tr("chat_friend_request_progress_title", "发送好友请求"),
    () => api("/api/chat/friend/request", { method: "POST", body: { walletId: id }, timeoutMs: WALLET_OP_TIMEOUT_MS }),
    { summary: tr("chat_friend_request_progress_summary", "正在发送好友请求上链交易...") },
  );
  upsertChatPair(id, { friendStatus: "outgoing_pending", isFriend: false, inList: true });
  rebuildChatPairCollections();
  renderChatUsers();
  renderChatFriendConfirmList();
  if (result?.warning) pushNotice(String(result.warning), "warn");
  refreshChatThreadsInBackground();
}

async function acceptChatFriendRequest(walletId) {
  const id = String(walletId || "").trim();
  if (!id) return;
  const result = await runSynchronousChainAction(
    tr("chat_friend_accept_progress_title", "确认好友"),
    () => api("/api/chat/friend/accept", { method: "POST", body: { walletId: id }, timeoutMs: WALLET_OP_TIMEOUT_MS }),
    { summary: tr("chat_friend_accept_progress_summary", "正在确认好友并发送上链交易...") },
  );
  upsertChatPair(id, { friendStatus: "friend", isFriend: true, inList: true });
  rebuildChatPairCollections();
  renderChatUsers();
  renderChatFriendConfirmList();
  if (result?.warning) pushNotice(String(result.warning), "warn");
  refreshChatThreadsInBackground();
}

async function rejectChatFriendRequest(walletId) {
  const id = String(walletId || "").trim();
  if (!id) return;
  const result = await runSynchronousChainAction(
    tr("chat_friend_reject_progress_title", "处理好友请求"),
    () => api("/api/chat/friend/reject", { method: "POST", body: { walletId: id }, timeoutMs: WALLET_OP_TIMEOUT_MS }),
    { summary: tr("chat_friend_reject_progress_summary", "正在提交好友请求处理交易...") },
  );
  upsertChatPair(id, { friendStatus: "none", isFriend: false, inList: true });
  rebuildChatPairCollections();
  renderChatUsers();
  renderChatFriendConfirmList();
  if (result?.warning) pushNotice(String(result.warning), "warn");
  refreshChatThreadsInBackground();
}

async function runChatBlockAction() {
  closeChatMenu();
  const thread = currentChatThread();
  if (!thread) return;
  if (thread.blocked) {
    await api("/api/chat/unblock", { method: "POST", body: { walletId: thread.walletId } });
  } else {
    await api("/api/chat/block", { method: "POST", body: { walletId: thread.walletId } });
    if (state.chat.activeWalletId === thread.walletId) {
      state.chat.activeWalletId = "";
    }
  }
  await refreshChatThreads();
  renderChatUsers();
  await renderChatMessages();
}

function closeChatMenu() {
  if (els.chatMenuDropdown) els.chatMenuDropdown.classList.add("hidden");
}

function toggleChatMenu() {
  if (!els.chatMenuDropdown) return;
  els.chatMenuDropdown.classList.toggle("hidden");
}

function closeChatUserContextMenu() {
  if (!els.chatUserContextMenu) return;
  els.chatUserContextMenu.classList.add("hidden");
  els.chatUserContextMenu.removeAttribute("data-chat-context-wallet");
}

function openChatUserContextMenu(walletId, x, y) {
  const id = String(walletId || "").trim();
  const thread = threadByWalletId(id);
  if (!id || !thread || thread.isFriend === true || !els.chatUserContextMenu || !els.btnChatContextAddFriend) {
    closeChatUserContextMenu();
    return;
  }
  const friendStatus = String(thread.friendStatus || "none");
  const rejected = friendStatus === "rejected";
  const incoming = friendStatus === "incoming_pending";
  const outgoing = friendStatus === "outgoing_pending";
  els.btnChatContextAddFriend.textContent = tr("chat_friend_action_default", "添加好友");
  els.btnChatContextAddFriend.disabled = rejected || incoming || outgoing;
  els.btnChatContextAddFriend.title = rejected
    ? tr("chat_friend_rejected_disabled", "对方已拒绝，不能再次发起")
    : incoming
      ? tr("chat_friend_incoming_disabled", "已收到好友请求，请到好友确认处理")
      : outgoing
        ? tr("chat_friend_outgoing_disabled", "好友请求已发送")
        : "";
  els.chatUserContextMenu.dataset.chatContextWallet = id;
  els.chatUserContextMenu.style.left = `${Math.max(8, Number(x || 0))}px`;
  els.chatUserContextMenu.style.top = `${Math.max(8, Number(y || 0))}px`;
  els.chatUserContextMenu.classList.remove("hidden");
}

function runChatCreateGroup() {
  closeChatMenu();
  toast(tr("chat_group_create_todo", "创建群将在后续版本开放"));
}

async function loadMoreChatMessages() {
  if (!state.chat.activeWalletId || !currentChatHasMore() || state.chat.loadingOlderMessages === true) return;
  if (isChatThreadLoading(state.chat.activeWalletId, state.chat.mode, state.chat.activeOrderId)) return;
  const chatBox = els.chatBox;
  const previousHeight = chatBox ? chatBox.scrollHeight : 0;
  const previousTop = chatBox ? chatBox.scrollTop : 0;
  state.chat.loadingOlderMessages = true;
  updateChatLoadMoreState();
  try {
    state.chat.messagePage = Math.max(1, Number(state.chat.messagePage || 1)) + 1;
    await renderChatMessages({ stickToBottom: false });
    if (chatBox) {
      const delta = Math.max(0, chatBox.scrollHeight - previousHeight);
      chatBox.scrollTop = previousTop + delta;
    }
  } finally {
    state.chat.loadingOlderMessages = false;
    updateChatLoadMoreState();
  }
}

async function saveProfileAndChatSettings() {
  if (!requireProfileEditingAllowed(tr("profile_edit_action", "编辑个人信息"))) return;
  const name = String(els.profileName?.value || "").trim();
  if (!name) return toast(tr("profile_name_required", "请输入名字"));
  const currentSignature = currentProfileFormSignature();
  const baseSignature = String(state.ui.profileFormSignature || "");
  const latestSignature = String(state.ui.profileLatestSignature || baseSignature);
  if (state.ui.profileConflictPending && currentSignature !== baseSignature && latestSignature !== baseSignature) {
    const useCurrentDraft = await openConflictModal({
      title: tr("profile_conflict_title", "Profile has new data"),
      message: tr("profile_conflict_message", "The profile in the database was updated by another device or by on-chain sync. You can use the latest data or keep your current edits and write them locally as a pending on-chain change."),
      cancelLabel: tr("profile_conflict_use_latest", "Use latest data"),
      confirmLabel: tr("profile_conflict_keep_mine", "Keep my changes"),
    });
    if (!useCurrentDraft) {
      const latestPayload = profilePayloadFromStateSnapshot(state);
      applyProfilePayloadToForm(latestPayload);
      state.ui.profileFormSignature = latestSignature;
      state.ui.profileLatestSignature = latestSignature;
      state.ui.profileConflictPending = false;
      updateSaveProfileButtonState();
      toast(tr("profile_conflict_discarded", "Latest profile data applied. Your current edits were discarded."));
      return;
    }
  }
  const profileReq = api("/api/profile", {
    method: "POST",
    body: { name },
  });
  const configReq = api("/api/chat/config", {
    method: "POST",
    body: {
      enabled: els.chatEnabled?.value !== "0",
      listenPort: Number(els.chatListenPort?.value || 8787),
      publicHost: String(els.chatPublicHost?.value || "").trim(),
      publicPort: Number(els.chatPublicPort?.value || 8787),
      allowOnchainInvite: els.chatAllowOnchainInvite?.value !== "0",
      autoPublishEndpoint: els.chatAutoPublishEndpoint?.value !== "0",
    },
  });
  const [profileRes, configRes] = await Promise.all([profileReq, configReq]);
  if (profileRes?.state) {
    const token = issueServerStateToken();
    applyServerState(profileRes.state, { token });
  }
  state.chatConfig = configRes.config || state.chatConfig;
  api("/api/chat/identity", { silent: true })
    .then((identity) => {
      if (els.chatPubKey) els.chatPubKey.value = identity.identity?.chatPubKey || "";
    })
    .catch(() => {});
  state.chat.legacyProfileReanchorQueued = false;
  applyChatConfigForm();
  state.ui.profileFormSignature = currentProfileFormSignature();
  state.ui.profileLatestSignature = state.ui.profileFormSignature;
  state.ui.profileConflictPending = false;
  updateSaveProfileButtonState();
  if (els.chatConfigStatus) {
    els.chatConfigStatus.textContent = tr("profile_saved", "Profile saved");
  }
  toast(tr("profile_saved", "Profile saved"));
  renderAll();
}

function renderAll() {
  renderView();
  renderRolePanels();
  renderBuyerBrowseMode();
  renderHeader();
  renderDriveExplorer();
  renderWalletHistoryItems(Array.isArray(state.wallet.historyItems) ? state.wallet.historyItems : []);
  renderMerchants();
  renderBuyerPrimaryCategories();
  renderBuyerProducts();
  renderCategories();
  renderSellerProducts();
  renderOrders();
  renderDefaultCategoryOptions();
  renderDefaultCategoryPresetSelect();
}

function driveStatusLabel(downloaded, onchainStatus = "anchored") {
  if (String(onchainStatus || "") === "deleting") return tr("drive_deleting_status", "删除中");
  if (String(onchainStatus || "") === "preparing") return tr("drive_preparing_status", "Preparing");
  if (String(onchainStatus || "") === "reading") return tr("drive_reading_status", "Reading");
  if (String(onchainStatus || "") === "compressing") return tr("drive_compressing_status", "Compressing");
  if (String(onchainStatus || "") === "encrypting") return tr("drive_encrypting_status", "Encrypting chunks");
  if (String(onchainStatus || "") === "estimating") return tr("drive_estimating_status", "Estimating fee");
  if (String(onchainStatus || "") === "awaiting_confirm") return tr("drive_awaiting_confirm_status", "Awaiting confirmation");
  if (String(onchainStatus || "") === "queued") return tr("drive_queued_status", "Queued");
  if (String(onchainStatus || "") === "paused") return tr("drive_paused_status", "Interrupted, can resume");
  if (String(onchainStatus || "") === "failed") return tr("drive_failed_status", "Failed");
  if (String(onchainStatus || "") === "anchoring") return tr("drive_anchoring_status", "上链中");
  if (String(onchainStatus || "") === "retrying") return tr("drive_retrying_status", "补发中");
  if (String(onchainStatus || "") === "renaming") return tr("drive_renaming_status", "改名中");
  if (String(onchainStatus || "") === "uploading") return tr("drive_uploading_status", "上传中");
  if (String(onchainStatus || "") === "not_onchain") return tr("drive_not_onchain_status", "未上链");
  return downloaded ? tr("drive_downloaded_status", "已下载") : tr("drive_not_downloaded_status", "未下载");
}

function driveUploadStageLabel(status = "") {
  const labels = {
    preparing: tr("drive_upload_stage_preparing", "Preparing file"),
    receiving: tr("drive_upload_stage_preparing", "Preparing file"),
    uploading: tr("drive_upload_stage_preparing", "Preparing file"),
    reading: tr("drive_upload_stage_reading", "Reading file"),
    compressing: tr("drive_upload_stage_compressing", "Compressing file"),
    encrypting: tr("drive_upload_stage_encrypting", "Encrypting and splitting"),
    estimating: tr("drive_upload_stage_estimating", "Estimating on-chain fee"),
  };
  return labels[String(status || "").trim()] || "";
}

function makeOptimisticDriveDirId() {
  return `pending-dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function upsertDriveDirLocal(entry = {}, options = {}) {
  const dirId = String(entry.dirId || "").trim();
  if (!dirId) return;
  const nextEntry = { ...entry };
  const replaceById = (rows) => {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const index = list.findIndex((row) => String(row.dirId || "") === dirId);
    if (index >= 0) list[index] = { ...list[index], ...nextEntry };
    else list.push(nextEntry);
    return list;
  };
  if (options.listing !== false) state.drive.dirs = replaceById(state.drive.dirs);
  state.drive.tree = replaceById(state.drive.tree);
}

function rememberPendingDriveDir(entry = {}) {
  const path = normalizeDrivePath(entry?.path || "");
  if (!path) return;
  state.drive.pendingDirs = {
    ...(state.drive.pendingDirs || {}),
    [path]: { ...entry, path, pending: true, onchainStatus: String(entry?.onchainStatus || "anchoring") },
  };
}

function forgetPendingDriveDir(pathText = "") {
  const path = normalizeDrivePath(pathText || "");
  if (!path || !state.drive.pendingDirs) return;
  delete state.drive.pendingDirs[path];
  state.drive.pendingDirs = { ...state.drive.pendingDirs };
}

function mergePendingDriveDirsIntoState() {
  const pendingRows = Object.values(state.drive.pendingDirs || {})
    .filter((entry) => entry && typeof entry === "object");
  if (!pendingRows.length) return;
  const existingTreePaths = new Set((Array.isArray(state.drive.tree) ? state.drive.tree : [])
    .map((entry) => normalizeDrivePath(entry?.path || "")));
  const currentPath = normalizeDrivePath(state.drive.currentPath || "/");
  const existingListingPaths = new Set((Array.isArray(state.drive.dirs) ? state.drive.dirs : [])
    .map((entry) => normalizeDrivePath(entry?.path || "")));
  for (const row of pendingRows) {
    const path = normalizeDrivePath(row.path || "");
    if (!path || existingTreePaths.has(path)) continue;
    upsertDriveDirLocal(row, { listing: false });
    existingTreePaths.add(path);
  }
  for (const row of pendingRows) {
    const path = normalizeDrivePath(row.path || "");
    if (!path || driveParentPath(path) !== currentPath || existingListingPaths.has(path)) continue;
    state.drive.dirs = (Array.isArray(state.drive.dirs) ? state.drive.dirs : []).concat([{ ...row }]);
    existingListingPaths.add(path);
  }
}

function replaceOptimisticDriveDir(tempDirId, realDir = {}, options = {}) {
  const safeTemp = String(tempDirId || "").trim();
  const safeReal = String(realDir.dirId || "").trim();
  if (!safeTemp || !safeReal) return;
  const replaceRow = (row) => {
    if (String(row.dirId || "") !== safeTemp) return row;
    return {
      ...row,
      ...realDir,
      dirId: safeReal,
      pending: false,
      onchainStatus: "anchored",
    };
  };
  if (options.listing !== false) state.drive.dirs = (Array.isArray(state.drive.dirs) ? state.drive.dirs : []).map(replaceRow);
  state.drive.tree = (Array.isArray(state.drive.tree) ? state.drive.tree : []).map(replaceRow);
  forgetPendingDriveDir(realDir.path || realDir.localRelativePath || "");
}

function removeDriveDirLocal(dirId, options = {}) {
  const safeDirId = String(dirId || "").trim();
  if (!safeDirId) return;
  if (options.listing !== false) state.drive.dirs = (Array.isArray(state.drive.dirs) ? state.drive.dirs : []).filter((row) => String(row.dirId || "") !== safeDirId);
  const removed = (Array.isArray(state.drive.tree) ? state.drive.tree : []).find((row) => String(row.dirId || "") === safeDirId);
  state.drive.tree = (Array.isArray(state.drive.tree) ? state.drive.tree : []).filter((row) => String(row.dirId || "") !== safeDirId);
  if (removed?.path) forgetPendingDriveDir(removed.path);
}

function renameDriveDirLocal(dirId, nextName, options = {}) {
  const safeDirId = String(dirId || "").trim();
  const safeName = String(nextName || "").trim();
  if (!safeDirId || !safeName) return null;
  let oldPath = "";
  let newPath = "";
  const renameRow = (row) => {
    if (!row || typeof row !== "object") return row;
    if (String(row.dirId || "") !== safeDirId) return row;
    oldPath = oldPath || String(row.path || "/");
    const parentPath = driveParentPath(oldPath) || "/";
    newPath = `${parentPath === "/" ? "" : parentPath}/${safeName}`;
    return {
      ...row,
      name: safeName,
      path: newPath,
      localRelativePath: newPath,
      pending: options.pending === true,
      onchainStatus: options.pending === true ? "renaming" : String(options.onchainStatus || "anchored"),
    };
  };
  const rewriteDescendant = (row) => {
    if (!oldPath || !newPath || !row || typeof row !== "object") return row;
    const rowPath = String(row.path || "");
    if (!rowPath.startsWith(`${oldPath}/`)) return row;
    const nextPath = `${newPath}${rowPath.slice(oldPath.length)}`;
    return {
      ...row,
      path: nextPath,
      localRelativePath: nextPath,
    };
  };
  const updateRows = (rows) => (Array.isArray(rows) ? rows.map(renameRow).map(rewriteDescendant) : []);
  if (options.listing !== false) state.drive.dirs = updateRows(state.drive.dirs);
  state.drive.tree = updateRows(state.drive.tree);
  return { oldPath, newPath };
}

function driveDeleteKey(targetType, targetId) {
  return `${String(targetType || "").trim()}:${String(targetId || "").trim()}`;
}

function getDriveDeletePending(targetType, targetId) {
  return state.drive.pendingDeletes?.[driveDeleteKey(targetType, targetId)] || null;
}

function isDriveEntryDeleting(targetType, targetId) {
  return Boolean(getDriveDeletePending(targetType, targetId));
}

function setDriveDeletePending(targetType, targetId, entry = {}) {
  const safeType = String(targetType || "").trim();
  const safeId = String(targetId || "").trim();
  if (!safeType || !safeId) return;
  state.drive.pendingDeletes = {
    ...(state.drive.pendingDeletes || {}),
    [driveDeleteKey(safeType, safeId)]: {
      ...entry,
      targetType: safeType,
      targetId: safeId,
      startedAt: Date.now(),
    },
  };
}

function clearDriveDeletePending(targetType, targetId) {
  const key = driveDeleteKey(targetType, targetId);
  if (!key || !state.drive.pendingDeletes?.[key]) return;
  const next = { ...(state.drive.pendingDeletes || {}) };
  delete next[key];
  state.drive.pendingDeletes = next;
}

function driveUploadUiPercent(upload = {}) {
  const status = String(upload.status || "").trim();
  const rawProgress = Math.max(0, Math.min(1, Number(upload.progress || 0)));
  if (status === "completed") return 100;
  if (["preparing", "reading", "compressing", "encrypting", "estimating", "awaiting_confirm"].includes(status)) {
    return Math.max(0, Math.min(95, rawProgress * 100));
  }
  if (status === "anchoring" || status === "retrying" || status === "queued" || status === "paused") {
    return Math.max(0, Math.min(99, rawProgress * 100));
  }
  if (status === "failed") {
    return Math.max(0, Math.min(99, rawProgress * 100));
  }
  return Math.max(0, Math.min(95, rawProgress * 100));
}

function isDriveUploadActive(upload = {}) {
  const status = String(upload?.status || "").trim();
  return Boolean(status) && !["completed", "cancelled", "failed"].includes(status);
}

function hasActiveDriveUploads() {
  const activeLocal = Object.values(state.drive.uploadProgress || {}).some(isDriveUploadActive);
  const activePersisted = (Array.isArray(state.drive.uploads) ? state.drive.uploads : []).some(isDriveUploadActive);
  return activeLocal || activePersisted;
}

async function refreshDriveUploadTasksForCurrentDir() {
  const payload = await api("/api/drive/upload/tasks", { silent: true });
  const currentPath = String(state.drive.currentPath || "/");
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  state.drive.uploads = tasks.filter((entry) => String(entry?.dirPath || "/") === currentPath);
  const allProgress = { ...(state.drive.uploadProgress || {}) };
  for (const upload of state.drive.uploads) {
    const taskId = String(upload?.taskId || "").trim();
    if (!taskId) continue;
    const previous = allProgress[taskId] || {};
    const incomingProgress = Math.max(0, Math.min(1, Number(upload.progress || upload.completedBatchCount / Math.max(1, Number(upload.batchCount || 1)) || 0)));
    allProgress[taskId] = {
      ...previous,
      ...upload,
      taskId,
      status: String(upload.status || previous.status || "queued"),
      progress: String(upload.status || "") === "completed" ? 1 : Math.max(Number(previous.progress || 0), incomingProgress),
      updatedAt: Date.now(),
    };
  }
  state.drive.uploadProgress = allProgress;
  renderDriveExplorer({ tree: false });
}

function scheduleDriveUploadPoll(delayMs = 2500) {
  if (state.drive.uploadPollTimer) return;
  state.drive.uploadPollTimer = window.setTimeout(() => {
    state.drive.uploadPollTimer = null;
    const modalOpen = els.driveModal && !els.driveModal.classList.contains("hidden");
    if (!modalOpen || !hasActiveDriveUploads()) return;
    refreshDriveUploadTasksForCurrentDir()
      .catch(() => {})
      .finally(() => {
        if (hasActiveDriveUploads()) scheduleDriveUploadPoll(2500);
      });
  }, Math.max(1000, Number(delayMs || 2500)));
}

function formatDriveUploadInlineStatus(upload = {}, fallbackPercent = 0) {
  const status = String(upload.status || "").trim();
  const stage = String(upload.stage || "").trim();
  const activeBatchStatus = String(upload.activeBatchStatus || "").trim();
  const batchIndex = Math.max(0, Number(upload.batchIndex || upload.completedBatchCount || 0));
  const batchCount = Math.max(0, Number(upload.batchCount || 0));
  const feeSat = Math.max(0, Number(upload.estimatedFeeSat || upload.preview?.estimatedFeeSat || 0));
  const feeText = feeSat > 0 ? trf("drive_upload_fee_suffix", { fee: fmtSatAsBsv(feeSat) }, `, estimated ${fmtSatAsBsv(feeSat)}`) : "";
  if (status === "anchoring" || status === "retrying") {
    const batchText = batchCount > 0
      ? trf("drive_upload_batch_count", { current: Math.min(batchCount, Math.max(1, batchIndex)), total: batchCount }, `${Math.min(batchCount, Math.max(1, batchIndex))}/${batchCount} batches`)
      : `${fallbackPercent.toFixed(0)}%`;
    if (activeBatchStatus === "broadcasting" || stage.includes("broadcast")) return trf("drive_upload_broadcasting_inline", { batch: batchText, fee: feeText }, `Broadcasting on-chain ${batchText}${feeText}`);
    if (stage.includes("signed")) return trf("drive_upload_signed_inline", { batch: batchText, fee: feeText }, `Transaction signed ${batchText}${feeText}`);
    return trf("drive_upload_anchoring_inline", { batch: batchText, fee: feeText }, `Publishing on-chain ${batchText}${feeText}`);
  }
  if (status === "queued") return trf("drive_upload_queued_inline", { fee: feeText }, `Queued${feeText}`);
  if (status === "paused") {
    const errorText = String(upload.error || upload.lastError || "").trim();
    const batchText = batchCount > 0 ? trf("drive_upload_batch_count_prefix", { current: batchIndex, total: batchCount }, ` ${batchIndex}/${batchCount} batches`) : "";
    return errorText
      ? trf("drive_upload_paused_with_error_inline", { batch: batchText, error: errorText }, `Publishing interrupted${batchText}: ${errorText}`)
      : trf("drive_upload_paused_inline", { batch: batchText, fee: feeText }, `Publishing interrupted${batchText}, can resume${feeText}`);
  }
  if (status === "awaiting_confirm" || status === "previewed") return trf("drive_upload_awaiting_fee_inline", { fee: feeText }, `Awaiting fee confirmation${feeText}`);
  if (status === "failed") return trf("drive_upload_failed_inline", { error: String(upload.error || upload.lastError || "") }, `Failed: ${String(upload.error || upload.lastError || "")}`);
  if (["preparing", "reading", "compressing", "encrypting", "estimating", "receiving", "uploading"].includes(status)) return tr("drive_upload_preparing_inline", "Preparing...");
  return `${fallbackPercent.toFixed(0)}%`;
}

function renderDriveUploadActions(upload = {}) {
  const taskId = String(upload.taskId || "").trim();
  const status = String(upload.status || "");
  if (!taskId) return "";
  const buttons = [];
  if (status === "awaiting_confirm" || status === "previewed") {
    buttons.push(`<button type="button" data-drive-confirm-upload="${escapeHtml(taskId)}">${escapeHtml(tr("drive_confirm_upload_button", "Confirm publish"))}</button>`);
  }
  if (status === "paused" || status === "failed") {
    buttons.push(`<button type="button" data-drive-resume-upload="${escapeHtml(taskId)}">${escapeHtml(tr("drive_resume_upload_button", "Resume publish"))}</button>`);
  }
  if (!["completed", "cancelled", "anchoring"].includes(status)) {
    buttons.push(`<button type="button" data-drive-cancel-upload="${escapeHtml(taskId)}">${escapeHtml(tr("btnCancel", "Cancel"))}</button>`);
  }
  return buttons.join("");
}

function upsertDriveUploadProgress(payload = {}) {
  const taskId = String(payload?.taskId || "").trim();
  if (!taskId) return;
  const previous = state.drive.uploadProgress?.[taskId] || {};
  const previousStatus = String(previous.status || "");
  const nextStatus = String(payload?.status || previous.status || "uploading");
  const incomingProgress = Math.max(0, Math.min(1, Number(payload?.progress || 0)));
  const next = {
    ...previous,
    ...payload,
    taskId,
    status: nextStatus,
    fileName: String(payload?.fileName || previous.fileName || ""),
    dirPath: String(payload?.dirPath || previous.dirPath || state.drive.currentPath || "/"),
    progress: nextStatus === previousStatus ? Math.max(Number(previous.progress || 0), incomingProgress) : incomingProgress,
    updatedAt: Date.now(),
  };
  state.drive.uploadProgress = {
    ...(state.drive.uploadProgress || {}),
    [taskId]: next,
  };
  updateDriveUploadEstimatingModal(next);
  if (next.status === "cancelled" || next.status === "completed") {
    setTimeout(() => {
      const current = state.drive.uploadProgress?.[taskId];
      if (!current || String(current.status || "") !== next.status) return;
      const all = { ...(state.drive.uploadProgress || {}) };
      delete all[taskId];
      state.drive.uploadProgress = all;
      if (next.status === "completed" && els.driveModal && !els.driveModal.classList.contains("hidden")) {
        fetchDriveTree(state.drive.currentPath || "/", { tree: false })
          .catch(() => renderDriveExplorer({ tree: false }));
        return;
      }
      renderDriveExplorer({ tree: false });
    }, next.status === "completed" ? 1200 : 200);
  }
  renderDriveExplorer({ tree: false });
}

function updateDriveUploadEstimatingModal(upload = {}) {
  if (!els.driveUploadConfirmModal || els.driveUploadConfirmModal.classList.contains("hidden")) return;
  if (state.drive.uploadConfirmResolver) return;
  const status = String(upload.status || "");
  const stage = driveUploadStageLabel(status);
  if (!stage) return;
  const percent = driveUploadUiPercent(upload);
  const chunkCount = Number(upload.chunkCount || 0);
  const chunkIndex = Number(upload.chunkIndex || 0);
  if (els.driveUploadConfirmMessage) {
    els.driveUploadConfirmMessage.textContent = trf("drive_upload_stage_wait_message", { stage }, `${stage}, please wait...`);
  }
  if (els.driveUploadConfirmDetails) {
    const rows = [
      [tr("drive_detail_file", "File"), String(upload.fileName || "")],
      [tr("drive_detail_stage", "Stage"), stage],
      [tr("drive_detail_progress", "Progress"), `${percent.toFixed(0)}%`],
    ];
    if (chunkCount > 0) rows.push([tr("drive_detail_chunks", "Chunks"), `${chunkIndex}/${chunkCount}`]);
    els.driveUploadConfirmDetails.innerHTML = rows.map(([label, value]) => `
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    `).join("");
  }
}

function driveFileIcon(name) {
  const fileName = String(name || "").trim().toLowerCase();
  const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
  if (!ext) return { type: "generic", label: "FILE", ext: "" };
  const exact = {
    pdf: ["pdf", "PDF"],
    doc: ["word", "DOC"],
    docx: ["word", "DOCX"],
    docm: ["word", "DOCM"],
    dot: ["word", "DOT"],
    dotx: ["word", "DOTX"],
    rtf: ["word", "RTF"],
    xls: ["excel", "XLS"],
    xlsx: ["excel", "XLSX"],
    xlsm: ["excel", "XLSM"],
    xlsb: ["excel", "XLSB"],
    xlt: ["excel", "XLT"],
    xltx: ["excel", "XLTX"],
    csv: ["excel", "CSV"],
    ppt: ["powerpoint", "PPT"],
    pptx: ["powerpoint", "PPTX"],
    pptm: ["powerpoint", "PPTM"],
    pot: ["powerpoint", "POT"],
    potx: ["powerpoint", "POTX"],
    pps: ["powerpoint", "PPS"],
    ppsx: ["powerpoint", "PPSX"],
    one: ["onenote", "ONE"],
    pub: ["publisher", "PUB"],
    accdb: ["access", "ACCDB"],
    mdb: ["access", "MDB"],
    exe: ["app", "EXE"],
    msi: ["installer", "MSI"],
    bat: ["script", "BAT"],
    cmd: ["script", "CMD"],
    ps1: ["script", "PS1"],
    lnk: ["shortcut", "LNK"],
    url: ["shortcut", "URL"],
    iso: ["disc", "ISO"],
    img: ["disc", "IMG"],
    vhd: ["disc", "VHD"],
    vhdx: ["disc", "VHDX"],
    dll: ["system", "DLL"],
    sys: ["system", "SYS"],
    ini: ["settings", "INI"],
    cfg: ["settings", "CFG"],
    conf: ["settings", "CONF"],
    reg: ["settings", "REG"],
    txt: ["text", "TXT"],
    log: ["text", "LOG"],
    md: ["text", "MD"],
    json: ["code", "JSON"],
    xml: ["code", "XML"],
    html: ["web", "HTML"],
    htm: ["web", "HTM"],
    css: ["web", "CSS"],
    js: ["code", "JS"],
    mjs: ["code", "MJS"],
    cjs: ["code", "CJS"],
    ts: ["code", "TS"],
    tsx: ["code", "TSX"],
    jsx: ["code", "JSX"],
    py: ["code", "PY"],
    java: ["code", "JAVA"],
    c: ["code", "C"],
    h: ["code", "H"],
    cpp: ["code", "CPP"],
    cs: ["code", "CS"],
    go: ["code", "GO"],
    rs: ["code", "RS"],
    php: ["code", "PHP"],
    rb: ["code", "RB"],
    sh: ["script", "SH"],
    sql: ["database", "SQL"],
    db: ["database", "DB"],
    sqlite: ["database", "SQLITE"],
    bak: ["archive", "BAK"],
  };
  const categorySets = [
    ["image", "IMG", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "dib", "tif", "tiff", "heic", "heif", "avif", "ico", "svg", "raw", "psd", "ai"]],
    ["video", "VID", ["mp4", "m4v", "mkv", "mov", "avi", "wmv", "webm", "flv", "mpeg", "mpg", "3gp", "ts"]],
    ["audio", "AUD", ["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "wma", "opus", "mid", "midi"]],
    ["archive", "ZIP", ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "cab", "arj", "z", "lz", "lzma"]],
    ["font", "FONT", ["ttf", "otf", "woff", "woff2", "eot"]],
    ["ebook", "BOOK", ["epub", "mobi", "azw", "azw3", "fb2"]],
  ];
  const found = exact[ext] || categorySets.find(([, , values]) => values.includes(ext));
  if (Array.isArray(found)) return { type: found[0], label: found[1], ext };
  return { type: "generic", label: ext.slice(0, 4).toUpperCase(), ext };
}

function renderDriveFileIcon(name) {
  const meta = driveFileIcon(name);
  return `<span class="drive-file-type-icon ${escapeHtml(meta.type)}" title="${escapeHtml(meta.ext || meta.label)}"><span>${escapeHtml(meta.label)}</span></span>`;
}

function formatDriveFileSize(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(size)} ${units[unitIndex]}`;
  const decimals = size >= 100 ? 0 : (size >= 10 ? 1 : 2);
  return `${size.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")} ${units[unitIndex]}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function scrollActiveDriveTreeNodeIntoView() {
  const active = els.driveTreePane?.querySelector?.(".drive-tree-node.active");
  if (active && typeof active.scrollIntoView === "function") {
    active.scrollIntoView({ block: "nearest" });
  }
}

function driveParentPath(pathText) {
  const safePath = normalizeDrivePath(pathText);
  if (safePath === "/") return "";
  const parts = safePath.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function normalizeDrivePath(pathText) {
  const raw = String(pathText || "/").trim().replace(/\\/g, "/");
  const parts = raw.split("/").filter((part) => part && part !== ".");
  const normalized = [];
  for (const part of parts) {
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.length ? `/${normalized.join("/")}` : "/";
}

function hasDriveTreePath(pathText) {
  const safePath = normalizeDrivePath(pathText);
  return (Array.isArray(state.drive.tree) ? state.drive.tree : [])
    .some((entry) => normalizeDrivePath(entry.path || "/") === safePath);
}

function suppressDriveTreeUpdatedEvent(pathText, ttlMs = DRIVE_CHAIN_OP_TIMEOUT_MS) {
  const safePath = normalizeDrivePath(pathText);
  const until = Date.now() + Math.max(1000, Number(ttlMs || 0));
  state.drive.localTreeUpdateSkips = {
    ...(state.drive.localTreeUpdateSkips || {}),
    [safePath]: until,
  };
}

function shouldSkipDriveTreeUpdatedEvent(payload = {}) {
  const rawDirPath = String(payload?.dirPath || "").trim();
  if (!rawDirPath) return false;
  const skips = state.drive.localTreeUpdateSkips || {};
  const now = Date.now();
  let changed = false;
  for (const [pathText, until] of Object.entries(skips)) {
    if (now <= Number(until || 0)) continue;
    delete skips[pathText];
    changed = true;
  }
  const dirPath = normalizeDrivePath(rawDirPath);
  const skipUntil = Number(skips[dirPath] || 0);
  const shouldSkip = Boolean(skipUntil && now <= skipUntil && hasDriveTreePath(dirPath));
  if (shouldSkip) {
    delete skips[dirPath];
    changed = true;
  }
  if (changed) state.drive.localTreeUpdateSkips = { ...skips };
  return shouldSkip;
}

function ensureDriveTreeExpandedForPath(pathText) {
  const safePath = normalizeDrivePath(pathText);
  const expanded = new Set(Array.isArray(state.drive.expandedDirIds) ? state.drive.expandedDirIds : []);
  expanded.add("/");
  const parts = safePath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}` || "/";
    expanded.add(current || "/");
  }
  state.drive.expandedDirIds = Array.from(expanded);
}

function findDriveTreeNodeByDirId(dirId) {
  const safeDirId = String(dirId || "").trim();
  if (!safeDirId) return null;
  return (Array.isArray(state.drive.tree) ? state.drive.tree : [])
    .find((entry) => String(entry.dirId || "") === safeDirId) || null;
}

function ensureDriveTreeContextMenu() {
  let menu = document.getElementById("driveTreeContextMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "driveTreeContextMenu";
  menu.className = "drive-tree-context-menu hidden";
  menu.innerHTML = `
    <button type="button" data-drive-menu-new-dir>${escapeHtml(tr("drive_context_new_dir", "新建目录"))}</button>
    <button type="button" data-drive-menu-rename-dir>${escapeHtml(tr("drive_context_rename_dir", "改名目录"))}</button>
  `;
  document.body.appendChild(menu);
  menu.addEventListener("click", (event) => {
    const newDirBtn = event.target.closest("[data-drive-menu-new-dir]");
    if (newDirBtn) {
      const node = findDriveTreeNodeByDirId(state.drive.treeContextDirId);
      hideDriveTreeContextMenu();
      if (node && !node.pending) openDriveMkdirModal(String(node.path || "/"));
      return;
    }
    const renameBtn = event.target.closest("[data-drive-menu-rename-dir]");
    if (renameBtn) {
      const node = findDriveTreeNodeByDirId(state.drive.treeContextDirId);
      hideDriveTreeContextMenu();
      if (node && !renameBtn.disabled) openDriveRenameDirModal(node);
    }
  });
  return menu;
}

function hideDriveTreeContextMenu() {
  const menu = document.getElementById("driveTreeContextMenu");
  if (menu) menu.classList.add("hidden");
  state.drive.treeContextDirId = "";
}

function openDriveTreeContextMenu(event, node) {
  if (!node || node.pending) return;
  event.preventDefault();
  event.stopPropagation();
  state.drive.treeContextDirId = String(node.dirId || "");
  const menu = ensureDriveTreeContextMenu();
  const renameBtn = menu.querySelector("[data-drive-menu-rename-dir]");
  const isRoot = String(node.path || "/") === "/";
  if (renameBtn) renameBtn.disabled = isRoot;
  menu.classList.remove("hidden");
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - menuRect.width - 8));
  const top = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - menuRect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function buildVisibleDriveTreeNodes() {
  const nodes = Array.isArray(state.drive.tree) ? state.drive.tree : [];
  if (!nodes.length) return [];
  const byParent = new Map();
  for (const node of nodes) {
    const parent = String(node.parentDirId || "");
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  for (const rows of byParent.values()) {
    rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }
  const expanded = new Set(Array.isArray(state.drive.expandedDirIds) ? state.drive.expandedDirIds : []);
  const rootNode = nodes.find((node) => String(node.path || "/") === "/") || nodes[0];
  if (!rootNode) return [];
  const visible = [];
  function visit(node, depth) {
    const nodePath = String(node.path || "/") || "/";
    const children = byParent.get(String(node.dirId || "")) || [];
    const isExpanded = nodePath === "/" || expanded.has(nodePath);
    visible.push({
      ...node,
      depth,
      hasChildren: children.length > 0,
      expanded: isExpanded,
    });
    if (!isExpanded) return;
    for (const child of children) visit(child, depth + 1);
  }
  visit(rootNode, 0);
  return visible;
}

function renderDriveExplorer(options = {}) {
  const renderTree = options.tree !== false;
  const renderListing = options.listing !== false;
  if (els.btnDriveViewList) els.btnDriveViewList.classList.toggle("active", state.drive.viewMode !== "grid");
  if (els.btnDriveViewGrid) els.btnDriveViewGrid.classList.toggle("active", state.drive.viewMode === "grid");
  if (els.driveRootDirInput) els.driveRootDirInput.value = String(state.drive.rootLocalDir || "");
  if (els.driveCurrentPath) els.driveCurrentPath.textContent = String(state.drive.currentPath || "/");
  if (renderTree && els.driveTreePane) {
    const nodes = buildVisibleDriveTreeNodes();
    els.driveTreePane.innerHTML = nodes.length ? nodes.map((node) => {
      const depth = Math.max(0, Number(node.depth || 0));
      const active = String(state.drive.currentDirId || "") === String(node.dirId || "")
        || (!state.drive.currentDirId && String(node.path || "/") === String(state.drive.currentPath || "/"));
      const title = String(node.name || "/") || "/";
      return `<div class="drive-tree-row${active ? " active" : ""}" style="--drive-tree-depth:${depth}">
        <button class="drive-tree-expander${node.hasChildren ? "" : " empty"}" type="button" ${node.hasChildren ? `data-drive-toggle-dir="${escapeHtml(node.path || "/")}"` : 'tabindex="-1"'}>${node.hasChildren ? (node.expanded ? "▾" : "▸") : ""}</button>
        <button class="drive-tree-node${active ? " active" : ""}${isDriveEntryDeleting("dir", node.dirId) ? " deleting" : ""}${node.pending ? " pending" : ""}" type="button" data-drive-dir="${escapeHtml(node.dirId || "")}" style="--drive-tree-depth:${depth}" ${isDriveEntryDeleting("dir", node.dirId) || node.pending ? "disabled" : ""}><span class="drive-tree-node-glyph" aria-hidden="true"></span><span class="drive-tree-node-icon" aria-hidden="true">${title === "/" ? "🖴" : "📁"}</span><span class="drive-tree-node-name">${escapeHtml(title === "/" ? "/" : title)}</span></button>
      </div>`;
    }).join("") : `<div class="drive-empty">${escapeHtml(state.drive.loading ? tr("drive_loading", "正在加载...") : tr("drive_tree_empty", "暂无目录"))}</div>`;
    scrollActiveDriveTreeNodeIntoView();
  }
  if (renderListing && els.driveListingPane) {
    els.driveListingPane.classList.toggle("grid", state.drive.viewMode === "grid");
    const liveUploads = Object.values(state.drive.uploadProgress || {});
    const persistedUploads = (Array.isArray(state.drive.uploads) ? state.drive.uploads : [])
      .filter((entry) => !liveUploads.some((live) => String(live.taskId || "") === String(entry.taskId || "")));
    const transientUploads = liveUploads.concat(persistedUploads)
      .filter((entry) => {
        const status = String(entry?.status || "");
        if (status === "completed" || status === "cancelled") return false;
        return String(entry?.dirPath || "/") === String(state.drive.currentPath || "/");
      })
      .map((entry) => ({
        kind: "file",
        transientUpload: true,
        fileId: `upload:${String(entry.taskId || "")}`,
        name: String(entry.fileName || ""),
        originalSize: Number(entry.totalBytes || 0),
        downloaded: true,
        onchainStatus: String(entry.status || "preparing"),
        upload: entry,
      }));
    if (transientUploads.some((entry) => isDriveUploadActive(entry.upload || {}))) {
      scheduleDriveUploadPoll(2500);
    }
    const existingUploadNames = new Set((Array.isArray(state.drive.files) ? state.drive.files : []).map((entry) => String(entry.name || "")));
    const mixedEntries = []
      .concat((Array.isArray(state.drive.dirs) ? state.drive.dirs : []).map((entry) => ({ kind: "dir", ...entry })))
      .concat((Array.isArray(state.drive.files) ? state.drive.files : []).map((entry) => ({ kind: "file", ...entry })))
      .concat(transientUploads.filter((entry) => !existingUploadNames.has(String(entry.name || ""))));
    mixedEntries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    const parentPath = driveParentPath(state.drive.currentPath || "/");
    const prefix = parentPath ? `
      <div class="drive-entry drive-entry-up" data-drive-entry-kind="up" data-drive-entry-id="${escapeHtml(parentPath)}">
        <div class="drive-entry-main">
          <div class="drive-entry-title">
            <span class="drive-entry-icon" aria-hidden="true">↩</span>
            <strong>${escapeHtml(tr("drive_go_parent", "返回上层"))}</strong>
          </div>
          <div class="drive-entry-meta mono">${escapeHtml(parentPath)}</div>
        </div>
      </div>` : "";
    const emptyListing = state.drive.loading ? tr("drive_loading", "正在加载...") : tr("drive_listing_empty", "当前目录为空");
    els.driveListingPane.innerHTML = prefix + (mixedEntries.length ? mixedEntries.map((entry) => {
      if (entry.kind === "dir") {
        const deleting = isDriveEntryDeleting("dir", entry.dirId);
        return `
      <div class="drive-entry${deleting ? " deleting" : ""}${entry.pending ? " pending" : ""}" data-drive-entry-kind="dir" data-drive-entry-id="${escapeHtml(entry.dirId || "")}" ${deleting || entry.pending ? 'aria-disabled="true"' : ""}>
        <div class="drive-entry-main">
          <div class="drive-entry-title">
            <span class="drive-entry-icon" aria-hidden="true">📁</span>
            <strong>${escapeHtml(String(entry.name || ""))}</strong>
            <span class="drive-status-chip${entry.downloaded ? " ready" : ""}${deleting ? " deleting" : ""}">${escapeHtml(driveStatusLabel(entry.downloaded, deleting ? "deleting" : (entry.pending ? "anchoring" : entry.onchainStatus)))}</span>
          </div>
          <div class="drive-entry-meta mono">${escapeHtml(String(entry.path || ""))}</div>
        </div>
        <div class="drive-entry-actions">
          <button type="button" data-drive-download-dir="${escapeHtml(entry.dirId || "")}" ${state.drive.rootLocalDir && !deleting && !entry.pending ? "" : "disabled"}>${escapeHtml(tr("drive_download_dir_button", "下载目录"))}</button>
          <button type="button" data-drive-delete-dir="${escapeHtml(entry.dirId || "")}" ${deleting || entry.pending ? "disabled" : ""}>${escapeHtml(deleting ? tr("drive_deleting_status", "删除中") : tr("delete_button", "删除"))}</button>
        </div>
      </div>`;
      }
      const deleting = isDriveEntryDeleting("file", entry.fileId);
      const uploadPercent = entry.transientUpload ? driveUploadUiPercent(entry.upload || {}) : 0;
      return `
      <div class="drive-entry${entry.transientUpload ? " uploading" : ""}${deleting ? " deleting" : ""}" data-drive-entry-kind="file" data-drive-entry-id="${escapeHtml(entry.fileId || "")}" ${deleting ? 'aria-disabled="true"' : ""}>
        <div class="drive-entry-main">
          <div class="drive-entry-title">
            <span class="drive-entry-icon" aria-hidden="true">${renderDriveFileIcon(entry.name)}</span>
            <strong class="drive-file-name${entry.downloaded && !entry.transientUpload && !deleting ? " downloadable" : ""}" ${entry.downloaded && !entry.transientUpload && !deleting ? `data-drive-file-name-download="${escapeHtml(entry.fileId || "")}" title="${escapeHtml(tr("drive_click_file_download_title", "点击下载到浏览器"))}"` : ""}>${escapeHtml(String(entry.name || ""))}</strong>
            <span class="drive-status-chip${entry.downloaded ? " ready" : ""}${deleting ? " deleting" : ""}">${escapeHtml(driveStatusLabel(entry.downloaded, deleting ? "deleting" : entry.onchainStatus))}</span>
          </div>
          <div class="drive-entry-meta">${escapeHtml(trf("drive_file_meta_line", { size: formatDriveFileSize(entry.originalSize || entry.size || 0) }, `大小 ${formatDriveFileSize(entry.originalSize || entry.size || 0)}`))}</div>
          ${entry.transientUpload ? `<div class="drive-upload-progress"><div class="drive-upload-progress-bar" style="width:${uploadPercent.toFixed(1)}%"></div></div><div class="drive-entry-meta">${escapeHtml(formatDriveUploadInlineStatus(entry.upload || {}, uploadPercent))}</div>` : ""}
        </div>
        <div class="drive-entry-actions">
          ${entry.transientUpload ? renderDriveUploadActions(entry.upload || {}) : `
          ${String(entry.onchainStatus || "anchored") === "not_onchain" ? `<button type="button" data-drive-anchor-file="${escapeHtml(entry.fileId || "")}" ${deleting ? "disabled" : ""}>${escapeHtml(tr("drive_anchor_file_button", "手动上链"))}</button>` : ""}
          ${entry.downloaded ? "" : `<button type="button" data-drive-download-file="${escapeHtml(entry.fileId || "")}" ${state.drive.rootLocalDir && !deleting ? "" : "disabled"}>${escapeHtml(tr("drive_download_file_button", "下载到服务器"))}</button>`}
          <button type="button" data-drive-delete-file="${escapeHtml(entry.fileId || "")}" ${deleting ? "disabled" : ""}>${escapeHtml(deleting ? tr("drive_deleting_status", "删除中") : tr("delete_button", "删除"))}</button>
          `}
        </div>
      </div>`;
    }).join("") : `<div class="drive-empty">${escapeHtml(emptyListing)}</div>`);
  }
}

async function fetchDriveTree(dirPath = null, options = {}) {
  const safePath = String(dirPath || state.drive.currentPath || "/").trim() || "/";
  const updateTree = options.tree !== false;
  const q = new URLSearchParams({ path: safePath });
  try {
    const payload = await api(`/api/drive/tree?${q.toString()}`, { silent: true });
    state.drive.currentPath = String(payload?.path || safePath || "/");
    state.drive.currentDirId = String(payload?.dirId || "");
    state.drive.rootLocalDir = String(payload?.rootLocalDir || "");
  if (updateTree) {
      const incomingTree = Array.isArray(payload?.tree) ? payload.tree : [];
      if (incomingTree.length || !hasActiveDriveUploads() || !state.drive.tree.length) {
        state.drive.tree = incomingTree;
      }
    }
    state.drive.dirs = Array.isArray(payload?.dirs) ? payload.dirs : [];
    state.drive.files = Array.isArray(payload?.files) ? payload.files : [];
    state.drive.uploads = Array.isArray(payload?.uploads) ? payload.uploads : [];
    for (const row of (Array.isArray(state.drive.tree) ? state.drive.tree : []).concat(state.drive.dirs || [])) {
      const path = normalizeDrivePath(row?.path || "");
      if (path && state.drive.pendingDirs?.[path] && row?.pending !== true) forgetPendingDriveDir(path);
    }
    const allProgress = { ...(state.drive.uploadProgress || {}) };
    const currentUploadIds = new Set(state.drive.uploads.map((upload) => String(upload?.taskId || "").trim()).filter(Boolean));
    const currentFileNames = new Set(state.drive.files.map((file) => String(file?.name || "")));
    for (const upload of state.drive.uploads) {
      const taskId = String(upload?.taskId || "").trim();
      if (!taskId || !isDriveUploadActive(upload)) continue;
      const previous = allProgress[taskId] || {};
      const incomingProgress = Math.max(0, Math.min(1, Number(upload.progress || upload.completedBatchCount / Math.max(1, Number(upload.batchCount || 1)) || 0)));
      allProgress[taskId] = {
        ...previous,
        ...upload,
        taskId,
        status: String(upload.status || previous.status || "queued"),
        progress: Math.max(Number(previous.progress || 0), incomingProgress),
        updatedAt: Date.now(),
      };
    }
    for (const [taskId, upload] of Object.entries(allProgress)) {
      const sameDir = String(upload?.dirPath || "/") === String(state.drive.currentPath || "/");
      if (!sameDir || currentUploadIds.has(taskId)) continue;
      if (currentFileNames.has(String(upload?.fileName || ""))) delete allProgress[taskId];
    }
    state.drive.uploadProgress = allProgress;
    mergePendingDriveDirsIntoState();
    ensureDriveTreeExpandedForPath(state.drive.currentPath || "/");
    state.drive.loading = false;
    renderDriveExplorer({ tree: updateTree });
    return payload;
  } catch (error) {
    state.drive.loading = false;
    renderDriveExplorer({ tree: updateTree });
    throw error;
  }
}

async function saveDriveRootLocalDir() {
  const rootLocalDir = String(state.drive.pickerPath || els.driveRootDirInput?.value || "").trim();
  if (!rootLocalDir) {
    toast(tr("drive_root_dir_required", "请先填写服务器本地根目录"));
    return;
  }
  const payload = await api("/api/drive/root-dir", {
    method: "POST",
    body: { rootLocalDir },
  });
  state.drive.rootLocalDir = String(payload?.rootLocalDir || rootLocalDir);
  await fetchDriveTree(state.drive.currentPath || "/");
  toast(tr("drive_root_dir_saved", "网盘根目录已保存"));
}

async function openDriveExplorer() {
  if (els.driveModal) els.driveModal.classList.remove("hidden");
  state.drive.loading = true;
  renderDriveExplorer();
  try {
    await fetchDriveTree(state.drive.currentPath || "/");
    if (!state.drive.rootLocalDir && els.driveRootDirInput) {
      els.driveRootDirInput.focus();
      toast(tr("drive_root_dir_first_use", "首次使用请先设置服务器本地根目录"));
    }
  } catch (error) {
    toast(error.message);
  }
}

function renderDriveDirPicker() {
  if (els.driveDirPickerPath) els.driveDirPickerPath.value = String(state.drive.pickerPath || "");
  if (els.btnDriveDirGoUp) els.btnDriveDirGoUp.disabled = !state.drive.pickerParentPath;
  if (els.driveDirRoots) {
    const roots = Array.isArray(state.drive.pickerRoots) ? state.drive.pickerRoots : [];
    els.driveDirRoots.innerHTML = roots.map((root) => `<button type="button" class="chip${String(root) === String(state.drive.pickerPath) ? " active" : ""}" data-drive-picker-root="${escapeHtml(root)}">${escapeHtml(root)}</button>`).join("");
  }
  if (els.driveDirPickerList) {
    const rows = Array.isArray(state.drive.pickerDirs) ? state.drive.pickerDirs : [];
    const parentRow = state.drive.pickerParentPath ? `
      <div class="drive-picker-row parent" data-drive-picker-path="${escapeHtml(state.drive.pickerParentPath)}">
        <span aria-hidden="true">↩</span>
        <strong>${escapeHtml(tr("drive_picker_parent_dir", "上层目录"))}</strong>
      </div>
    ` : "";
    const childRows = rows.length ? rows.map((entry) => `
      <div class="drive-picker-row" data-drive-picker-path="${escapeHtml(entry.path || "")}">
        <span aria-hidden="true">🗂️</span>
        <strong>${escapeHtml(String(entry.name || ""))}</strong>
      </div>
    `).join("") : `<div class="drive-empty">${escapeHtml(tr("drive_picker_empty", "当前目录下没有子目录"))}</div>`;
    els.driveDirPickerList.innerHTML = parentRow + childRows;
  }
}

async function fetchServerDirListing(dirPath = "") {
  const q = new URLSearchParams();
  if (dirPath) q.set("path", dirPath);
  const payload = await api(`/api/drive/server-dirs${q.toString() ? `?${q.toString()}` : ""}`, { silent: true });
  state.drive.pickerPath = String(payload?.currentPath || "");
  state.drive.pickerParentPath = String(payload?.parentPath || "");
  state.drive.pickerRoots = Array.isArray(payload?.roots) ? payload.roots : [];
  state.drive.pickerDirs = Array.isArray(payload?.dirs) ? payload.dirs : [];
  renderDriveDirPicker();
  return payload;
}

async function openDriveDirPicker() {
  await fetchServerDirListing(state.drive.rootLocalDir || "");
  if (els.driveDirPickerModal) els.driveDirPickerModal.classList.remove("hidden");
}

function openDriveMkdirModal(parentPath = "") {
  const safeParentPath = String(parentPath || state.drive.currentPath || "/").trim() || "/";
  state.drive.mkdirParentPath = safeParentPath;
  if (els.driveMkdirCurrentPath) els.driveMkdirCurrentPath.textContent = safeParentPath;
  if (els.driveMkdirName) els.driveMkdirName.value = "";
  if (els.driveMkdirModal) els.driveMkdirModal.classList.remove("hidden");
  setTimeout(() => els.driveMkdirName?.focus(), 0);
}

function closeDriveMkdirModal() {
  if (els.driveMkdirModal) els.driveMkdirModal.classList.add("hidden");
  state.drive.mkdirParentPath = "";
}

function openDriveRenameDirModal(node = {}) {
  const dirId = String(node.dirId || "").trim();
  if (!dirId || String(node.path || "/") === "/") return;
  state.drive.pendingRenameDir = { ...node };
  if (els.driveRenameDirCurrentPath) els.driveRenameDirCurrentPath.textContent = String(node.path || "/");
  if (els.driveRenameDirName) {
    els.driveRenameDirName.value = String(node.name || "");
    els.driveRenameDirName.select?.();
  }
  if (els.driveRenameDirModal) els.driveRenameDirModal.classList.remove("hidden");
  setTimeout(() => els.driveRenameDirName?.focus(), 0);
}

function closeDriveRenameDirModal() {
  if (els.driveRenameDirModal) els.driveRenameDirModal.classList.add("hidden");
  if (els.btnConfirmDriveRenameDir) {
    els.btnConfirmDriveRenameDir.disabled = false;
    els.btnConfirmDriveRenameDir.textContent = tr("drive_rename_dir_confirm", "确认改名");
  }
  state.drive.pendingRenameDir = null;
}

function closeDriveUploadConfirmModal(confirmed = false) {
  if (els.driveUploadConfirmModal) els.driveUploadConfirmModal.classList.add("hidden");
  if (els.btnCloseDriveUploadConfirm) els.btnCloseDriveUploadConfirm.disabled = false;
  if (els.btnCancelDriveUploadConfirm) els.btnCancelDriveUploadConfirm.disabled = false;
  if (els.btnConfirmDriveUploadConfirm) {
    els.btnConfirmDriveUploadConfirm.disabled = false;
    els.btnConfirmDriveUploadConfirm.textContent = tr("drive_upload_continue_button", "Continue upload");
  }
  const resolver = state.drive.uploadConfirmResolver;
  const preview = state.drive.pendingUploadPreview;
  state.drive.uploadConfirmResolver = null;
  state.drive.pendingUploadPreview = null;
  if (typeof resolver === "function") resolver({ confirmed: Boolean(confirmed), preview });
}

function openDriveUploadEstimatingModal(file = {}) {
  state.drive.uploadConfirmResolver = null;
  state.drive.pendingUploadPreview = null;
  if (els.driveUploadConfirmMessage) {
    els.driveUploadConfirmMessage.textContent = trf("drive_upload_estimating_message", {
      file: String(file?.name || ""),
    }, `Selected file: ${String(file?.name || "")}. Preparing and estimating on-chain fee, please wait...`);
  }
  if (els.driveUploadConfirmDetails) {
    const rows = [
      [tr("drive_detail_file", "File"), String(file?.name || "")],
      [tr("drive_detail_size", "Size"), formatDriveFileSize(file?.size || 0)],
      [tr("drive_detail_status", "Status"), tr("drive_estimating_status", "Estimating fee")],
    ];
    els.driveUploadConfirmDetails.innerHTML = rows.map(([label, value]) => `
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    `).join("");
  }
  if (els.btnCloseDriveUploadConfirm) els.btnCloseDriveUploadConfirm.disabled = true;
  if (els.btnCancelDriveUploadConfirm) els.btnCancelDriveUploadConfirm.disabled = true;
  if (els.btnConfirmDriveUploadConfirm) {
    els.btnConfirmDriveUploadConfirm.disabled = true;
    els.btnConfirmDriveUploadConfirm.textContent = tr("drive_estimating_button", "Estimating...");
  }
  if (els.driveUploadConfirmModal) els.driveUploadConfirmModal.classList.remove("hidden");
}

function openDriveUploadConfirmModal(preview = {}) {
  return new Promise((resolve) => {
    state.drive.uploadConfirmResolver = resolve;
    state.drive.pendingUploadPreview = preview;
    const filePreviews = Array.isArray(preview?.filePreviews) ? preview.filePreviews : [];
    const insufficient = preview?.insufficientBalance === true || preview?.canAfford === false;
    if (els.driveUploadConfirmMessage) {
      if (filePreviews.length > 1) {
        els.driveUploadConfirmMessage.textContent = insufficient
          ? trf("drive_upload_batch_insufficient_message", { fee: fmtSatAsBsv(preview.estimatedFeeSat), available: fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat), shortfall: fmtSatAsBsv(preview.shortfallSat) }, `Insufficient balance for this batch upload. Estimated total fee ${fmtSatAsBsv(preview.estimatedFeeSat)}, available ${fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat)}, shortfall ${fmtSatAsBsv(preview.shortfallSat)}.`)
          : trf("drive_upload_batch_preview_message", { count: filePreviews.length, fee: fmtSatAsBsv(preview.estimatedFeeSat) }, `${filePreviews.length} files estimated. Total fee about ${fmtSatAsBsv(preview.estimatedFeeSat)}.`);
      } else {
        els.driveUploadConfirmMessage.textContent = insufficient
          ? trf("drive_upload_file_insufficient_message", { fee: fmtSatAsBsv(preview.estimatedFeeSat), available: fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat), shortfall: fmtSatAsBsv(preview.shortfallSat) }, `Insufficient balance for publishing this file. Estimated ${fmtSatAsBsv(preview.estimatedFeeSat)}, available ${fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat)}, shortfall ${fmtSatAsBsv(preview.shortfallSat)}.`)
          : trf("drive_upload_file_preview_message", { count: Number(preview.anchorCount || 0), fee: fmtSatAsBsv(preview.estimatedFeeSat) }, `File chunk estimate completed. It will write ${Number(preview.anchorCount || 0)} chain events and cost about ${fmtSatAsBsv(preview.estimatedFeeSat)}.`);
      }
    }
    if (els.driveUploadConfirmDetails) {
      const rows = filePreviews.length > 1 ? [
        [tr("drive_detail_file_count", "File count"), String(filePreviews.length)],
        [tr("drive_detail_dir", "Folder"), String(preview.dirPath || "/")],
        [tr("drive_detail_total_fee", "Total fee"), fmtSatAsBsv(preview.estimatedFeeSat)],
        [tr("drive_detail_available_balance", "Available balance"), fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat)],
        [tr("drive_detail_balance_shortfall", "Balance shortfall"), fmtSatAsBsv(preview.shortfallSat)],
        ...filePreviews.map((row) => [String(row.fileName || ""), trf("drive_upload_file_row_summary", { fee: fmtSatAsBsv(row.estimatedFeeSat), chunks: Number(row.chunkCount || 0), batches: Number(row.batchCount || 0) }, `${fmtSatAsBsv(row.estimatedFeeSat)}, ${Number(row.chunkCount || 0)} chunks, ${Number(row.batchCount || 0)} batches`)]),
      ] : [
        [tr("drive_detail_file", "File"), String(preview.fileName || "")],
        [tr("drive_detail_dir", "Folder"), String(preview.dirPath || "/")],
        [tr("drive_detail_original_size", "Original size"), formatDriveFileSize(preview.originalSize || 0)],
        [tr("drive_detail_compressed_size", "Compressed size"), formatDriveFileSize(preview.compressedSize || 0)],
        [tr("drive_detail_chunk_count", "Chunk count"), String(Number(preview.chunkCount || 0))],
        [tr("drive_detail_chunk_size", "Chunk size"), formatDriveFileSize(preview.chunkSize || 0)],
        [tr("drive_detail_missing_dirs", "Folders to add"), String(Number(preview.missingDirCount || 0))],
        [tr("drive_detail_estimated_fee", "Estimated fee"), fmtSatAsBsv(preview.estimatedFeeSat)],
        [tr("drive_detail_available_balance", "Available balance"), fmtSatAsBsv(preview.walletSpendableSat || preview.walletConfirmedSat)],
        [tr("drive_detail_balance_shortfall", "Balance shortfall"), fmtSatAsBsv(preview.shortfallSat)],
      ];
      els.driveUploadConfirmDetails.innerHTML = rows.map(([label, value]) => `
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
      `).join("");
    }
    if (els.btnConfirmDriveUploadConfirm) {
      els.btnConfirmDriveUploadConfirm.disabled = false;
      els.btnConfirmDriveUploadConfirm.textContent = insufficient ? tr("drive_save_not_onchain_button", "Save as not on-chain") : tr("drive_upload_continue_button", "Continue upload");
    }
    if (els.btnCloseDriveUploadConfirm) els.btnCloseDriveUploadConfirm.disabled = false;
    if (els.btnCancelDriveUploadConfirm) els.btnCancelDriveUploadConfirm.disabled = false;
    if (els.driveUploadConfirmModal) els.driveUploadConfirmModal.classList.remove("hidden");
    if (els.btnConfirmDriveUploadConfirm) {
      setTimeout(() => els.btnConfirmDriveUploadConfirm.focus(), 0);
    }
  });
}

function closeDriveBrowserDownloadModal(confirmed = false) {
  if (els.driveBrowserDownloadModal) els.driveBrowserDownloadModal.classList.add("hidden");
  const resolver = state.drive.browserDownloadResolver;
  const file = state.drive.pendingBrowserDownloadFile;
  state.drive.browserDownloadResolver = null;
  state.drive.pendingBrowserDownloadFile = null;
  if (typeof resolver === "function") resolver({ confirmed: Boolean(confirmed), file });
}

function openDriveBrowserDownloadModal(file = {}) {
  return new Promise((resolve) => {
    state.drive.browserDownloadResolver = resolve;
    state.drive.pendingBrowserDownloadFile = file;
    const name = String(file?.name || "");
    if (els.driveBrowserDownloadMessage) {
      els.driveBrowserDownloadMessage.textContent = tr("drive_browser_download_message", "Download this file to the browser?");
    }
    if (els.driveBrowserDownloadName) {
      els.driveBrowserDownloadName.textContent = name;
    }
    if (els.driveBrowserDownloadModal) els.driveBrowserDownloadModal.classList.remove("hidden");
    setTimeout(() => els.btnConfirmDriveBrowserDownload?.focus(), 0);
  });
}

function closeDriveDeleteConfirmModal(confirmed = false) {
  if (els.driveDeleteConfirmModal) els.driveDeleteConfirmModal.classList.add("hidden");
  if (els.btnConfirmDriveDeleteConfirm) {
    els.btnConfirmDriveDeleteConfirm.disabled = false;
    els.btnConfirmDriveDeleteConfirm.textContent = tr("delete_button", "删除");
  }
  const resolver = state.drive.deleteConfirmResolver;
  const entry = state.drive.pendingDeleteEntry;
  state.drive.deleteConfirmResolver = null;
  state.drive.pendingDeleteEntry = null;
  if (typeof resolver === "function") resolver({ confirmed: Boolean(confirmed), entry });
}

function openDriveDeleteConfirmModal(entry = {}) {
  return new Promise((resolve) => {
    state.drive.deleteConfirmResolver = resolve;
    state.drive.pendingDeleteEntry = entry;
    const name = String(entry?.name || entry?.targetId || "");
    const typeLabel = String(entry?.targetType || "") === "dir" ? tr("drive_entry_type_dir", "folder") : tr("drive_entry_type_file", "file");
    const preview = entry?.preview || {};
    const insufficient = preview?.insufficientBalance === true || preview?.canAfford === false;
    const costSat = Math.max(0, Number(preview?.estimatedCostSat || 0));
    const feeSat = Math.max(0, Number(preview?.estimatedFeeSat || 0));
    const spendableSat = Math.max(0, Number(preview?.walletSpendableSat || 0));
    if (els.driveDeleteConfirmMessage) {
      els.driveDeleteConfirmMessage.textContent = insufficient
        ? trf("drive_delete_insufficient_message", { type: typeLabel, cost: fmtSatAsBsv(costSat), fee: fmtSatAsBsv(feeSat), available: fmtSatAsBsv(spendableSat), shortfall: fmtSatAsBsv(preview?.shortfallSat) }, `Insufficient balance to delete this ${typeLabel}. Estimated cost ${fmtSatAsBsv(costSat)} (fee about ${fmtSatAsBsv(feeSat)}), available ${fmtSatAsBsv(spendableSat)}, shortfall ${fmtSatAsBsv(preview?.shortfallSat)}.`)
        : trf("drive_delete_confirm_message", { type: typeLabel, cost: fmtSatAsBsv(costSat), fee: fmtSatAsBsv(feeSat) }, `Delete this ${typeLabel}? Estimated cost ${fmtSatAsBsv(costSat)} (fee about ${fmtSatAsBsv(feeSat)}). It will be marked deleting first and removed after the on-chain update succeeds.`);
    }
    if (els.driveDeleteConfirmName) els.driveDeleteConfirmName.textContent = name;
    if (els.btnConfirmDriveDeleteConfirm) {
      els.btnConfirmDriveDeleteConfirm.disabled = insufficient;
      els.btnConfirmDriveDeleteConfirm.textContent = insufficient ? tr("wallet_balance_insufficient", "Insufficient balance") : tr("drive_delete_confirm_button", "Confirm delete");
    }
    if (els.driveDeleteConfirmModal) els.driveDeleteConfirmModal.classList.remove("hidden");
    setTimeout(() => (insufficient ? els.btnCancelDriveDeleteConfirm : els.btnConfirmDriveDeleteConfirm)?.focus(), 0);
  });
}

async function downloadDriveFileToServer(fileId) {
  const result = await api("/api/drive/download/server", {
    method: "POST",
    body: { fileId },
  });
  await fetchDriveTree(state.drive.currentPath || "/");
  const outputPath = String(result?.restoredFiles?.[0]?.outputPath || "");
  toast(outputPath
    ? trf("drive_downloaded_to_server", { path: outputPath }, `文件已下载到 ${outputPath}`)
    : tr("drive_download_complete", "下载完成"));
}

async function downloadDriveDirToServer(dirId) {
  const result = await api("/api/drive/download/server", {
    method: "POST",
    body: { dirId },
  });
  await fetchDriveTree(state.drive.currentPath || "/");
  const count = Array.isArray(result?.restoredFiles) ? result.restoredFiles.length : 0;
  toast(trf("drive_dir_download_complete", { count }, `目录下载完成，共 ${count} 个文件`));
}

async function anchorDriveFile(fileId) {
  const result = await api(`/api/drive/file/${encodeURIComponent(String(fileId || ""))}/anchor`, {
    method: "POST",
    body: {},
  });
  await fetchDriveTree(state.drive.currentPath || "/");
  toast(result?.alreadyAnchored
    ? tr("drive_file_already_anchored", "文件已经上链")
    : tr("drive_file_anchor_complete", "文件已上链"));
}

function downloadDriveFileInBrowser(fileId) {
  const anchor = document.createElement("a");
  anchor.href = `/api/drive/download/browser?fileId=${encodeURIComponent(String(fileId || ""))}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function maybeDownloadDriveFileFromClick(fileId) {
  const safeFileId = String(fileId || "").trim();
  if (!safeFileId || safeFileId.startsWith("upload:")) return;
  const file = (Array.isArray(state.drive.files) ? state.drive.files : [])
    .find((entry) => String(entry.fileId || "") === safeFileId);
  if (!file || file.downloaded !== true) return;
  const decision = await openDriveBrowserDownloadModal(file);
  if (!decision?.confirmed) return;
  downloadDriveFileInBrowser(safeFileId);
}

async function createDriveDirectory() {
  const name = String(els.driveMkdirName?.value || "").trim();
  if (!name) return;
  const basePath = normalizeDrivePath(state.drive.mkdirParentPath || state.drive.currentPath || "/");
  const updatesCurrentListing = basePath === normalizeDrivePath(state.drive.currentPath || "/");
  const targetPath = normalizeDrivePath(`${basePath === "/" ? "" : basePath}/${name}`);
  const tempDirId = makeOptimisticDriveDirId();
  const parentNode = (Array.isArray(state.drive.tree) ? state.drive.tree : [])
    .find((entry) => normalizeDrivePath(entry.path || "/") === basePath);
  const parentDirId = String(parentNode?.dirId || (updatesCurrentListing ? state.drive.currentDirId : "") || "");
  const optimistic = {
    dirId: tempDirId,
    parentDirId,
    name,
    path: targetPath,
    localRelativePath: targetPath,
    downloaded: Boolean(state.drive.rootLocalDir),
    pending: true,
    onchainStatus: "anchoring",
  };
  suppressDriveTreeUpdatedEvent(targetPath);
  rememberPendingDriveDir(optimistic);
  upsertDriveDirLocal(optimistic, { listing: updatesCurrentListing });
  ensureDriveTreeExpandedForPath(basePath);
  closeDriveMkdirModal();
  renderDriveExplorer({ listing: updatesCurrentListing });
  api("/api/drive/mkdir", {
    method: "POST",
    silent: true,
    timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    body: { path: targetPath },
  }).then((result) => {
    replaceOptimisticDriveDir(tempDirId, {
      ...optimistic,
      dirId: String(result?.dirId || tempDirId),
      path: normalizeDrivePath(result?.path || targetPath),
      localRelativePath: normalizeDrivePath(result?.path || targetPath),
      onchainStatus: "anchored",
      pending: false,
    }, { listing: updatesCurrentListing });
    forgetPendingDriveDir(targetPath);
    suppressDriveTreeUpdatedEvent(result?.path || targetPath, 15000);
    renderDriveExplorer({ listing: updatesCurrentListing });
    toast(trf("drive_dir_created_notice", { name }, `目录已创建：${name}`));
  }).catch((err) => {
    removeDriveDirLocal(tempDirId, { listing: updatesCurrentListing });
    forgetPendingDriveDir(targetPath);
    delete state.drive.localTreeUpdateSkips?.[targetPath];
    renderDriveExplorer({ listing: updatesCurrentListing });
    toast(err.message);
  });
}

function isDriveSpendableUtxoError(error) {
  return /No local SPV UTXOs found|missing \d+ spendable input/i.test(String(error?.message || error || ""));
}

function driveSpendableUtxoMessage() {
  return tr("drive_no_spendable_utxo", "钱包没有可用余额/UTXO，不能写入链上；请先充值或等待钱包同步完成");
}

function driveSpendableUtxoDetailMessage(error) {
  const payload = error?.payload && typeof error.payload === "object" ? error.payload : {};
  const balance = payload.wallet || payload.balance || {};
  const availableSat = Number(balance.availableSat ?? balance.spendableSat ?? NaN);
  const confirmedSat = Number(balance.confirmedSat ?? NaN);
  const selfChangePendingSat = Number(balance.selfChangePendingSat ?? NaN);
  const parts = [];
  if (Number.isFinite(availableSat)) parts.push(trf("drive_balance_available_sat", { sat: availableSat }, `available ${availableSat} sat`));
  if (Number.isFinite(confirmedSat)) parts.push(trf("drive_balance_confirmed_sat", { sat: confirmedSat }, `confirmed ${confirmedSat} sat`));
  if (Number.isFinite(selfChangePendingSat)) parts.push(trf("drive_balance_pending_change_sat", { sat: selfChangePendingSat }, `pending change ${selfChangePendingSat} sat`));
  const suffix = parts.length ? `（${parts.join("，")}）` : "";
  return `${driveSpendableUtxoMessage()}${suffix}`;
}

async function renameDriveDirectory(node = {}, nextNameRaw = "") {
  const dirId = String(node.dirId || "").trim();
  const oldName = String(node.name || "").trim();
  if (!dirId || String(node.path || "/") === "/") return;
  const nextName = String(nextNameRaw || "").trim();
  if (!nextName || nextName === oldName) return;
  if (/[\\/]/.test(nextName) || nextName === "." || nextName === "..") {
    toast(tr("drive_invalid_dir_name", "目录名称不能包含斜杠"));
    return;
  }
  const oldPath = String(node.path || "/");
  const oldCurrentPath = String(state.drive.currentPath || "/");
  const updatesCurrentListing = (Array.isArray(state.drive.dirs) ? state.drive.dirs : [])
    .some((entry) => String(entry.dirId || "") === dirId);
  const optimisticPaths = renameDriveDirLocal(dirId, nextName, { pending: true, listing: updatesCurrentListing });
  const optimisticNewPath = String(optimisticPaths?.newPath || oldPath);
  let optimisticCurrentPath = oldCurrentPath;
  if (optimisticCurrentPath === oldPath) optimisticCurrentPath = optimisticNewPath;
  else if (optimisticCurrentPath.startsWith(`${oldPath}/`)) optimisticCurrentPath = `${optimisticNewPath}${optimisticCurrentPath.slice(oldPath.length)}`;
  state.drive.currentPath = optimisticCurrentPath;
  state.drive.suppressTreeRefreshUntil = Date.now() + DRIVE_CHAIN_OP_TIMEOUT_MS;
  ensureDriveTreeExpandedForPath(optimisticNewPath);
  renderDriveExplorer();
  const result = await api(`/api/drive/dir/${encodeURIComponent(dirId)}/rename`, {
    method: "POST",
    silent: true,
    timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    body: { name: nextName },
  }).catch((error) => {
    renameDriveDirLocal(dirId, oldName, { pending: false, listing: updatesCurrentListing });
    state.drive.currentPath = oldCurrentPath;
    state.drive.suppressTreeRefreshUntil = 0;
    renderDriveExplorer();
    if (isDriveSpendableUtxoError(error)) throw new Error(driveSpendableUtxoDetailMessage(error));
    throw error;
  });
  const newPath = String(result?.newPath || oldPath);
  let nextCurrentPath = String(state.drive.currentPath || "/");
  if (nextCurrentPath === oldPath) nextCurrentPath = newPath;
  else if (nextCurrentPath.startsWith(`${oldPath}/`)) nextCurrentPath = `${newPath}${nextCurrentPath.slice(oldPath.length)}`;
  renameDriveDirLocal(dirId, nextName, { pending: false, listing: updatesCurrentListing });
  ensureDriveTreeExpandedForPath(newPath);
  state.drive.currentPath = nextCurrentPath || "/";
  state.drive.suppressTreeRefreshUntil = Date.now() + 1500;
  renderDriveExplorer();
  toast(trf("drive_dir_renamed_notice", { name: nextName }, `目录已改名：${nextName}`));
  fetchDriveTree(nextCurrentPath || "/", { tree: false }).catch(() => {});
}

async function confirmDriveRenameDir() {
  const node = state.drive.pendingRenameDir;
  if (!node) return;
  const nextName = String(els.driveRenameDirName?.value || "").trim();
  if (!nextName) return;
  if (els.btnConfirmDriveRenameDir) {
    els.btnConfirmDriveRenameDir.disabled = true;
    els.btnConfirmDriveRenameDir.textContent = tr("drive_rename_dir_running", "改名中...");
  }
  try {
    await renameDriveDirectory(node, nextName);
    closeDriveRenameDirModal();
  } catch (error) {
    if (els.btnConfirmDriveRenameDir) {
      els.btnConfirmDriveRenameDir.disabled = false;
      els.btnConfirmDriveRenameDir.textContent = tr("drive_rename_dir_confirm", "确认改名");
    }
    throw error;
  }
}

async function deleteDriveEntry(targetType, targetId) {
  const safeType = String(targetType || "").trim();
  const safeId = String(targetId || "").trim();
  if (isDriveEntryDeleting(safeType, safeId)) return;
  const entry = safeType === "file"
    ? (state.drive.files || []).find((row) => String(row.fileId || "") === safeId)
    : (state.drive.dirs || []).find((row) => String(row.dirId || "") === safeId);
  const previewResult = await api("/api/drive/delete/preview", {
    method: "POST",
    timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    body: { targetType: safeType, targetId: safeId },
  });
  const preview = previewResult?.preview || {};
  const decision = await openDriveDeleteConfirmModal({
    targetType: safeType,
    targetId: safeId,
    name: String(entry?.name || safeId),
    preview,
  });
  if (!decision?.confirmed) return;
  setDriveDeletePending(safeType, safeId, {
    name: String(entry?.name || safeId),
    preview,
  });
  renderDriveExplorer();
  toast(tr("drive_delete_pending", "已标记为删除中，正在写入链上"));
  try {
    await api("/api/drive/delete", {
      method: "POST",
      silent: true,
      timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
      body: { targetType: safeType, targetId: safeId },
    });
    state.drive.suppressTreeRefreshUntil = Date.now() + 2500;
    clearDriveDeletePending(safeType, safeId);
    if (safeType === "file") state.drive.files = (state.drive.files || []).filter((row) => String(row.fileId || "") !== safeId);
    if (safeType === "dir") state.drive.dirs = (state.drive.dirs || []).filter((row) => String(row.dirId || "") !== safeId);
    renderDriveExplorer();
    toast(tr("drive_delete_complete", "删除完成"));
  } catch (err) {
    clearDriveDeletePending(safeType, safeId);
    renderDriveExplorer();
    throw err;
  }
}

async function prepareDriveUploadFile(file, dirPath) {
  if (!file) return;
  let taskId = "";
  let buffer = new Uint8Array(0);
  const totalBytes = Math.max(0, Number(file.size || 0));
  try {
    openDriveUploadEstimatingModal(file);
    const start = await api("/api/drive/upload/start", {
      method: "POST",
      silent: true,
      body: {
        path: dirPath || state.drive.currentPath || "/",
        fileName: file.name,
        totalBytes,
      },
    });
    taskId = String(start?.task?.taskId || "");
    if (!taskId) throw new Error("upload task missing");
    upsertDriveUploadProgress({
      taskId,
      status: "uploading",
      fileName: file.name,
      dirPath: dirPath || state.drive.currentPath || "/",
      uploadedBytes: 0,
      totalBytes,
      progress: 0,
    });
    const arrayBuffer = await file.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
      const slice = buffer.slice(offset, Math.min(buffer.byteLength, offset + chunkSize));
      await api(`/api/drive/upload/${encodeURIComponent(taskId)}/chunk`, {
        method: "POST",
        silent: true,
        body: {
          chunkBase64: bytesToBase64(slice),
        },
      });
      upsertDriveUploadProgress({
        taskId,
        status: "uploading",
        fileName: file.name,
        dirPath: dirPath || state.drive.currentPath || "/",
        uploadedBytes: Math.min(buffer.byteLength, offset + slice.byteLength),
        totalBytes: buffer.byteLength,
        progress: buffer.byteLength > 0 ? Math.min(1, (offset + slice.byteLength) / buffer.byteLength) : 1,
      });
    }
    const previewResult = await api(`/api/drive/upload/${encodeURIComponent(taskId)}/preview`, {
      method: "POST",
      silent: true,
      body: {},
      timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    });
    upsertDriveUploadProgress({
      taskId,
      status: "awaiting_confirm",
      fileName: file.name,
      dirPath: dirPath || state.drive.currentPath || "/",
      uploadedBytes: buffer.byteLength,
      totalBytes: buffer.byteLength,
      progress: 0,
      preview: previewResult?.preview || {},
      estimatedFeeSat: Number(previewResult?.preview?.estimatedFeeSat || 0),
      batchCount: Number(previewResult?.preview?.batchCount || 0),
    });
    return {
      taskId,
      file,
      totalBytes: buffer.byteLength,
      preview: previewResult?.preview || {},
    };
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/same name/i.test(message)) {
      toast(trf("drive_duplicate_file_name", { file: String(file.name || "") }, `Duplicate file name, cannot upload: ${String(file.name || "")}`));
      if (error && typeof error === "object") error.driveUploadHandled = true;
    }
    if (taskId) {
      upsertDriveUploadProgress({
        taskId,
        status: "failed",
        fileName: file.name,
        dirPath: dirPath || state.drive.currentPath || "/",
        uploadedBytes: buffer.byteLength || totalBytes,
        totalBytes: buffer.byteLength || totalBytes,
        progress: 0,
        error: message,
      });
    }
    throw error;
  }
}

async function confirmPreparedDriveUploads(preparedRows) {
  const rows = Array.isArray(preparedRows) ? preparedRows.filter(Boolean) : [];
  if (!rows.length) return;
  const previews = rows.map((row) => row.preview || {});
  const totalFeeSat = previews.reduce((sum, preview) => sum + Math.max(0, Number(preview.estimatedFeeSat || 0)), 0);
  const first = previews[0] || {};
  const spendableSat = Math.max(0, Number(first.walletSpendableSat || first.walletConfirmedSat || 0));
  const aggregate = rows.length === 1 ? first : {
    filePreviews: previews,
    dirPath: state.drive.currentPath || "/",
    estimatedFeeSat: totalFeeSat,
    walletSpendableSat: spendableSat,
    walletConfirmedSat: Number(first.walletConfirmedSat || 0),
    shortfallSat: Math.max(0, totalFeeSat - spendableSat),
    canAfford: totalFeeSat <= spendableSat,
    insufficientBalance: totalFeeSat > spendableSat,
  };
  const decision = await openDriveUploadConfirmModal(aggregate);
  if (!decision?.confirmed) {
    await Promise.all(rows.map((row) => api(`/api/drive/upload/${encodeURIComponent(row.taskId)}/cancel`, {
      method: "POST",
      silent: true,
      body: {},
    }).catch(() => null)));
    return;
  }
  for (const row of rows) {
    upsertDriveUploadProgress({
      taskId: row.taskId,
      status: "queued",
      fileName: row.file.name,
      dirPath: row.preview?.dirPath || state.drive.currentPath || "/",
      uploadedBytes: row.totalBytes,
      totalBytes: row.totalBytes,
      progress: 0,
      estimatedFeeSat: Number(row.preview?.estimatedFeeSat || 0),
      batchCount: Number(row.preview?.batchCount || 0),
    });
    await api(`/api/drive/upload/${encodeURIComponent(row.taskId)}/finish`, {
      method: "POST",
      silent: true,
      body: {},
      timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    });
    scheduleDriveUploadPoll(1000);
  }
  await fetchDriveTree(state.drive.currentPath || "/");
}

async function confirmExistingDriveUploadTask(taskId) {
  const safeTaskId = String(taskId || "").trim();
  if (!safeTaskId) return;
  await api(`/api/drive/upload/${encodeURIComponent(safeTaskId)}/finish`, {
    method: "POST",
    silent: true,
    body: {},
    timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
  });
  scheduleDriveUploadPoll(1000);
  await fetchDriveTree(state.drive.currentPath || "/");
}

async function resumeDriveUploadTask(taskId) {
  const safeTaskId = String(taskId || "").trim();
  if (!safeTaskId) return;
  const previous = state.drive.uploadProgress?.[safeTaskId]
    || (Array.isArray(state.drive.uploads) ? state.drive.uploads : []).find((entry) => String(entry?.taskId || "") === safeTaskId)
    || {};
  upsertDriveUploadProgress({
    ...previous,
    taskId: safeTaskId,
    status: "queued",
    error: "",
    lastError: "",
    progress: Math.max(0, Number(previous.progress || previous.completedBatchCount / Math.max(1, Number(previous.batchCount || 1)) || 0)),
  });
  try {
    await api(`/api/drive/upload/${encodeURIComponent(safeTaskId)}/resume`, {
      method: "POST",
      silent: true,
      body: {},
      timeoutMs: DRIVE_CHAIN_OP_TIMEOUT_MS,
    });
    toast(tr("drive_upload_requeued", "Requeued for publishing"));
    scheduleDriveUploadPoll(1000);
    await fetchDriveTree(state.drive.currentPath || "/", { tree: false });
  } catch (err) {
    upsertDriveUploadProgress({
      ...previous,
      taskId: safeTaskId,
      status: String(previous.status || "paused"),
      error: String(err?.message || err || ""),
      lastError: String(err?.message || err || ""),
    });
    throw err;
  }
}

async function cancelDriveUploadTask(taskId) {
  const safeTaskId = String(taskId || "").trim();
  if (!safeTaskId) return;
  await api(`/api/drive/upload/${encodeURIComponent(safeTaskId)}/cancel`, {
    method: "POST",
    silent: true,
    body: {},
  });
  const all = { ...(state.drive.uploadProgress || {}) };
  delete all[safeTaskId];
  state.drive.uploadProgress = all;
  await fetchDriveTree(state.drive.currentPath || "/");
}

async function uploadFilesToCurrentDriveDir(files) {
  const selected = Array.from(files || []).filter(Boolean);
  if (!selected.length) return;
  const dirPath = state.drive.currentPath || "/";
  const concurrency = Math.min(2, selected.length);
  const prepared = new Array(selected.length).fill(null);
  const failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const file = selected[index];
      try {
        const row = await prepareDriveUploadFile(file, dirPath);
        if (row) prepared[index] = row;
      } catch (error) {
        failures.push({ file, error });
        if (error?.driveUploadHandled !== true) {
          toast(trf("drive_file_prepare_failed_named", {
            file: String(file?.name || tr("drive_entry_type_file", "file")),
            error: String(error?.message || error || ""),
          }, `${String(file?.name || "file")} prepare failed: ${String(error?.message || error || "")}`));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const readyRows = prepared.filter(Boolean);
  if (!readyRows.length) {
    closeDriveUploadConfirmModal(false);
    if (failures.length) {
      const first = failures[0]?.error;
      if (first?.driveUploadHandled === true) return;
      throw first || new Error(tr("drive_upload_prepare_failed", "文件准备失败"));
    }
    return;
  }
  if (failures.length) {
    toast(trf("drive_upload_partial_prepare_failed", { failed: failures.length, ready: readyRows.length }, `${failures.length} 个文件准备失败，${readyRows.length} 个文件可以继续`));
  }
  await confirmPreparedDriveUploads(readyRows);
}

async function uploadFileToCurrentDriveDir(file) {
  return uploadFilesToCurrentDriveDir(file ? [file] : []);
}

async function callAndRefresh(fn, options = {}) {
  try {
    const token = issueServerStateToken();
    const result = await fn();
    if (typeof options?.beforeApply === "function") {
      try {
        options.beforeApply(result);
      } catch (err) {
        console.warn("[call-refresh-before-apply-failed]", err);
      }
    }
    if (result?.state) applyServerState(result.state, { token });
    renderAll();
    return result;
  } catch (err) {
    toast(err.message);
    throw err;
  }
}

function bindEvents() {
  bindProfileDirtyTracking();
  els.tabLoginPassword.addEventListener("click", () => {
    if (!state.wallet.exists) return;
    setLoginMode("password");
  });
  els.tabLoginCreate.addEventListener("click", () => {
    setLoginMode("create");
    els.loginMnemonic.value = "";
    state.auth.createReady = false;
  });
  els.tabLoginImport.addEventListener("click", () => setLoginMode("import"));
  els.loginPassword.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (els.btnLoginSubmit?.disabled) return;
    els.btnLoginSubmit.click();
  });
  els.btnGenerateMnemonic.addEventListener("click", async () => {
    const password = els.loginPassword.value.trim();
    if (!password) return toast(tr("generate_mnemonic_need_password", "请先输入钱包口令，再点自动生成"));
    try {
      const result = await api("/api/wallet/switch", { method: "POST", timeoutMs: WALLET_OP_TIMEOUT_MS, body: { password, mnemonic: "", mode: "create" } });
      els.loginMnemonic.value = String(result?.mnemonic || "").trim();
      state.auth.createReady = true;
      state.wallet.loggedIn = true;
      toast(tr("msg_mnemonic_created"));
    } catch (err) {
      toast(trf("generate_mnemonic_failed", { error: err.message }, `生成助记词失败：${err.message}`));
    }
  });
  els.btnLoginSubmit.addEventListener("click", async () => {
    const password = els.loginPassword.value.trim();
    const mnemonic = els.loginMnemonic.value.trim().replace(/\s+/g, " ");
    const isImportMode = state.auth.mode === "import";
    if (!password) return toast(tr("err_password_required"));

    try {
      let loginBootstrap = null;
      if (state.auth.mode === "password") {
        const loginResult = await api("/api/auth/login", { method: "POST", body: { password } });
        loginBootstrap = loginResult?.bootstrap || null;
      } else if (state.auth.mode === "create") {
        if (!state.auth.createReady) return toast(tr("err_create_first"));
      } else {
        if (!mnemonic) return toast(tr("err_import_mnemonic_required"));
        els.btnLoginSubmit.disabled = true;
        els.loginHint.textContent = tr("login_import_progress_1");
        await new Promise((resolve) => setTimeout(resolve, 80));
        els.loginHint.textContent = tr("login_import_progress_2");
        await api("/api/wallet/switch", { method: "POST", timeoutMs: WALLET_OP_TIMEOUT_MS, body: { password, mnemonic, mode: "import" } });
        els.loginHint.textContent = tr("login_import_progress_3");
      }

      state.wallet.loggedIn = true;
      setWalletSendPreflight(false, tr("wallet_need_sync_before_send", "请先完成链同步，必要时再手动刷新钱包状态"));
      els.loginModal.classList.add("hidden");
      if (isImportMode) showLoadingModal(tr("login_import_progress_4"));
      await runPostLoginBootstrap(loginBootstrap);
      if (isImportMode && els.loadingHint) els.loadingHint.textContent = tr("login_import_progress_done");
      // Keep wallet-switch/login isolation: catalog sync is manual via Sync button.
    } catch (err) {
      hideLoadingModal();
      toast(err.message);
      setLoginHintByMode(state.auth.mode);
    } finally {
      els.btnLoginSubmit.disabled = false;
    }
  });

  els.btnChat.addEventListener("click", async () => {
    clearChatButtonUnreadLatch();
    try {
      await openGlobalChat();
    } catch (e) {
      toast(e.message);
    }
  });
  if (els.btnDrive) {
    els.btnDrive.addEventListener("click", () => {
      openDriveExplorer().catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseDrive) {
    els.btnCloseDrive.addEventListener("click", () => {
      if (els.driveModal) els.driveModal.classList.add("hidden");
    });
  }
  if (els.btnPickDriveRootDir) {
    els.btnPickDriveRootDir.addEventListener("click", () => {
      openDriveDirPicker().catch((err) => toast(err.message));
    });
  }
  if (els.btnDriveViewList) {
    els.btnDriveViewList.addEventListener("click", () => {
      state.drive.viewMode = "list";
      els.btnDriveViewList.classList.add("active");
      els.btnDriveViewGrid?.classList.remove("active");
      renderDriveExplorer();
    });
  }
  if (els.btnDriveViewGrid) {
    els.btnDriveViewGrid.addEventListener("click", () => {
      state.drive.viewMode = "grid";
      els.btnDriveViewGrid.classList.add("active");
      els.btnDriveViewList?.classList.remove("active");
      renderDriveExplorer();
    });
  }
  if (els.btnDriveRefresh) {
    els.btnDriveRefresh.addEventListener("click", () => {
      fetchDriveTree(state.drive.currentPath || "/").catch((err) => toast(err.message));
    });
  }
  if (els.btnDriveNewDir) {
    els.btnDriveNewDir.addEventListener("click", () => {
      openDriveMkdirModal();
    });
  }
  if (els.btnDriveUpload) {
    els.btnDriveUpload.addEventListener("click", () => {
      els.driveUploadInput?.click();
    });
  }
  if (els.driveUploadInput) {
    els.driveUploadInput.addEventListener("change", () => {
      const files = Array.from(els.driveUploadInput.files || []);
      uploadFilesToCurrentDriveDir(files).catch((err) => toast(err.message)).finally(() => {
        if (els.driveUploadInput) els.driveUploadInput.value = "";
      });
    });
  }
  if (els.driveTreePane) {
    els.driveTreePane.addEventListener("click", (e) => {
      const toggleBtn = e.target.closest("[data-drive-toggle-dir]");
      if (toggleBtn) {
        const safePath = String(toggleBtn.dataset.driveToggleDir || "/");
        const next = new Set(Array.isArray(state.drive.expandedDirIds) ? state.drive.expandedDirIds : []);
        if (safePath !== "/") {
          if (next.has(safePath)) next.delete(safePath);
          else next.add(safePath);
        }
        next.add("/");
        state.drive.expandedDirIds = Array.from(next);
        renderDriveExplorer();
        return;
      }
      const btn = e.target.closest("[data-drive-dir]");
      if (!btn) return;
      const node = (Array.isArray(state.drive.tree) ? state.drive.tree : []).find((entry) => String(entry.dirId || "") === String(btn.dataset.driveDir || ""));
      if (!node || node.pending) return;
      fetchDriveTree(String(node.path || "/")).catch((err) => toast(err.message));
    });
    els.driveTreePane.addEventListener("contextmenu", (e) => {
      const btn = e.target.closest("[data-drive-dir]");
      if (!btn) return;
      const node = findDriveTreeNodeByDirId(btn.dataset.driveDir);
      if (!node || node.pending) return;
      openDriveTreeContextMenu(e, node);
    });
  }
  if (els.driveListingPane) {
    els.driveListingPane.addEventListener("click", (e) => {
      const upRow = e.target.closest('[data-drive-entry-kind="up"]');
      if (upRow) {
        fetchDriveTree(String(upRow.dataset.driveEntryId || "/")).catch((err) => toast(err.message));
        return;
      }
      const disabledRow = e.target.closest(".drive-entry.deleting, .drive-entry.pending");
      if (disabledRow) return;
      const confirmUploadBtn = e.target.closest("[data-drive-confirm-upload]");
      if (confirmUploadBtn) {
        confirmExistingDriveUploadTask(confirmUploadBtn.dataset.driveConfirmUpload).catch((err) => toast(err.message));
        return;
      }
      const resumeUploadBtn = e.target.closest("[data-drive-resume-upload]");
      if (resumeUploadBtn) {
        resumeDriveUploadTask(resumeUploadBtn.dataset.driveResumeUpload).catch((err) => toast(err.message));
        return;
      }
      const cancelUploadBtn = e.target.closest("[data-drive-cancel-upload]");
      if (cancelUploadBtn) {
        cancelDriveUploadTask(cancelUploadBtn.dataset.driveCancelUpload).catch((err) => toast(err.message));
        return;
      }
      const openDirBtn = e.target.closest("[data-drive-open-dir]");
      if (openDirBtn) {
        const match = (Array.isArray(state.drive.dirs) ? state.drive.dirs : []).find((entry) => String(entry.dirId || "") === String(openDirBtn.dataset.driveOpenDir || ""));
        if (match) fetchDriveTree(String(match.path || "/")).catch((err) => toast(err.message));
        return;
      }
      const downloadFileBtn = e.target.closest("[data-drive-download-file]");
      if (downloadFileBtn) {
        downloadDriveFileToServer(downloadFileBtn.dataset.driveDownloadFile).catch((err) => toast(err.message));
        return;
      }
      const anchorFileBtn = e.target.closest("[data-drive-anchor-file]");
      if (anchorFileBtn) {
        anchorDriveFile(anchorFileBtn.dataset.driveAnchorFile).catch((err) => toast(err.message));
        return;
      }
      const downloadDirBtn = e.target.closest("[data-drive-download-dir]");
      if (downloadDirBtn) {
        downloadDriveDirToServer(downloadDirBtn.dataset.driveDownloadDir).catch((err) => toast(err.message));
        return;
      }
      const deleteDirBtn = e.target.closest("[data-drive-delete-dir]");
      if (deleteDirBtn) {
        deleteDriveEntry("dir", deleteDirBtn.dataset.driveDeleteDir).catch((err) => toast(err.message));
        return;
      }
      const deleteFileBtn = e.target.closest("[data-drive-delete-file]");
      if (deleteFileBtn) {
        deleteDriveEntry("file", deleteFileBtn.dataset.driveDeleteFile).catch((err) => toast(err.message));
        return;
      }
      const fileName = e.target.closest("[data-drive-file-name-download]");
      if (fileName) maybeDownloadDriveFileFromClick(fileName.dataset.driveFileNameDownload).catch((err) => toast(err.message));
    });
    els.driveListingPane.addEventListener("dblclick", (e) => {
      const row = e.target.closest('[data-drive-entry-kind="dir"]');
      if (!row) return;
      if (row.classList.contains("deleting") || row.classList.contains("pending")) return;
      const dirId = String(row.dataset.driveEntryId || "");
      const match = (Array.isArray(state.drive.dirs) ? state.drive.dirs : []).find((entry) => String(entry.dirId || "") === dirId);
      if (match && !match.pending) fetchDriveTree(String(match.path || "/")).catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseDriveDirPicker) {
    els.btnCloseDriveDirPicker.addEventListener("click", () => {
      els.driveDirPickerModal?.classList.add("hidden");
    });
  }
  if (els.btnDriveDirGoUp) {
    els.btnDriveDirGoUp.addEventListener("click", () => {
      if (!state.drive.pickerParentPath) return;
      fetchServerDirListing(state.drive.pickerParentPath).catch((err) => toast(err.message));
    });
  }
  if (els.btnConfirmDriveDirPicker) {
    els.btnConfirmDriveDirPicker.addEventListener("click", () => {
      saveDriveRootLocalDir().then(() => {
        els.driveDirPickerModal?.classList.add("hidden");
      }).catch((err) => toast(err.message));
    });
  }
  if (els.driveDirRoots) {
    els.driveDirRoots.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-drive-picker-root]");
      if (!btn) return;
      fetchServerDirListing(btn.dataset.drivePickerRoot).catch((err) => toast(err.message));
    });
  }
  if (els.driveDirPickerList) {
    els.driveDirPickerList.addEventListener("click", (e) => {
      const row = e.target.closest("[data-drive-picker-path]");
      if (!row) return;
      fetchServerDirListing(row.dataset.drivePickerPath).catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseDriveMkdir) els.btnCloseDriveMkdir.addEventListener("click", closeDriveMkdirModal);
  if (els.btnCancelDriveMkdir) els.btnCancelDriveMkdir.addEventListener("click", closeDriveMkdirModal);
  if (els.btnConfirmDriveMkdir) {
    els.btnConfirmDriveMkdir.addEventListener("click", () => {
      createDriveDirectory().catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseDriveRenameDir) els.btnCloseDriveRenameDir.addEventListener("click", closeDriveRenameDirModal);
  if (els.btnCancelDriveRenameDir) els.btnCancelDriveRenameDir.addEventListener("click", closeDriveRenameDirModal);
  if (els.btnConfirmDriveRenameDir) {
    els.btnConfirmDriveRenameDir.addEventListener("click", () => {
      confirmDriveRenameDir().catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseDriveUploadConfirm) els.btnCloseDriveUploadConfirm.addEventListener("click", () => closeDriveUploadConfirmModal(false));
  if (els.btnCancelDriveUploadConfirm) els.btnCancelDriveUploadConfirm.addEventListener("click", () => closeDriveUploadConfirmModal(false));
  if (els.btnConfirmDriveUploadConfirm) els.btnConfirmDriveUploadConfirm.addEventListener("click", () => closeDriveUploadConfirmModal(true));
  if (els.btnCloseDriveBrowserDownload) els.btnCloseDriveBrowserDownload.addEventListener("click", () => closeDriveBrowserDownloadModal(false));
  if (els.btnCancelDriveBrowserDownload) els.btnCancelDriveBrowserDownload.addEventListener("click", () => closeDriveBrowserDownloadModal(false));
  if (els.btnConfirmDriveBrowserDownload) els.btnConfirmDriveBrowserDownload.addEventListener("click", () => closeDriveBrowserDownloadModal(true));
  if (els.btnCloseDriveDeleteConfirm) els.btnCloseDriveDeleteConfirm.addEventListener("click", () => closeDriveDeleteConfirmModal(false));
  if (els.btnCancelDriveDeleteConfirm) els.btnCancelDriveDeleteConfirm.addEventListener("click", () => closeDriveDeleteConfirmModal(false));
  if (els.btnConfirmDriveDeleteConfirm) els.btnConfirmDriveDeleteConfirm.addEventListener("click", () => closeDriveDeleteConfirmModal(true));
  if (els.driveMkdirName) {
    els.driveMkdirName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createDriveDirectory().catch((err) => toast(err.message));
      }
    });
  }
  if (els.driveRenameDirName) {
    els.driveRenameDirName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmDriveRenameDir().catch((err) => toast(err.message));
      }
    });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#driveTreeContextMenu")) return;
    hideDriveTreeContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideDriveTreeContextMenu();
  });
  window.addEventListener("resize", hideDriveTreeContextMenu);
  window.addEventListener("scroll", hideDriveTreeContextMenu, true);
  if (els.driveUploadConfirmModal) {
    els.driveUploadConfirmModal.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (els.btnConfirmDriveUploadConfirm?.disabled) return;
      closeDriveUploadConfirmModal(true);
    });
  }
  if (els.driveBrowserDownloadModal) {
    els.driveBrowserDownloadModal.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      closeDriveBrowserDownloadModal(true);
    });
  }
  if (els.driveDeleteConfirmModal) {
    els.driveDeleteConfirmModal.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      closeDriveDeleteConfirmModal(true);
    });
  }
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      ensureChatNotifyAudioReady();
    }, { passive: true });
  });
  els.btnCloseChat.addEventListener("click", () => {
    els.chatModal.classList.add("hidden");
    els.chatModal.classList.remove("chat-modal-maximized");
    document.getElementById("chatCard")?.classList.remove("chat-maximized");
    if (els.btnChatMaximize) {
      els.btnChatMaximize.textContent = "□";
      els.btnChatMaximize.title = tr("chat_maximize", "Maximize");
      els.btnChatMaximize.setAttribute("aria-label", tr("chat_maximize", "Maximize"));
    }
    stopChatStatusPolling();
  });
  els.btnSendChat.addEventListener("click", () => sendChat().catch((e) => toast(e.message)));
  if (els.btnChatToggleOnline) els.btnChatToggleOnline.addEventListener("click", () => toggleChatOnlineState().catch((e) => toast(e.message)));
  if (els.btnChatP2pConnect) {
    els.btnChatP2pConnect.addEventListener("click", () => {
      const walletId = String(els.btnChatP2pConnect.dataset.chatWalletId || state.chat.activeWalletId || "").trim();
      const thread = threadByWalletId(walletId);
      if (thread?.directConnected === true) {
        triggerChatDisconnect(walletId).catch((e) => toast(e.message));
      } else {
        triggerChatConnectTest(walletId).catch((e) => toast(e.message));
      }
    });
  }
  if (els.btnChatFriendAction) els.btnChatFriendAction.addEventListener("click", () => runChatFriendAction().catch((e) => toast(e.message)));
  if (els.btnCloseChatFriendConfirm) els.btnCloseChatFriendConfirm.addEventListener("click", closeChatFriendConfirmModal);
  if (els.chatFriendConfirmModal) {
    els.chatFriendConfirmModal.addEventListener("click", (e) => {
      if (e.target === els.chatFriendConfirmModal) closeChatFriendConfirmModal();
    });
  }
  if (els.chatFriendConfirmList) {
    els.chatFriendConfirmList.addEventListener("click", (e) => {
      const acceptBtn = e.target.closest("button[data-chat-friend-accept]");
      if (acceptBtn) {
        acceptChatFriendRequest(acceptBtn.dataset.chatFriendAccept).catch((err) => toast(err.message));
        return;
      }
      const rejectBtn = e.target.closest("button[data-chat-friend-reject]");
      if (rejectBtn) {
        rejectChatFriendRequest(rejectBtn.dataset.chatFriendReject).catch((err) => toast(err.message));
      }
    });
  }
  if (els.btnChatContextAddFriend) {
    els.btnChatContextAddFriend.addEventListener("click", () => {
      const walletId = String(els.chatUserContextMenu?.dataset?.chatContextWallet || "").trim();
      closeChatUserContextMenu();
      sendChatFriendRequest(walletId).catch((err) => toast(err.message));
    });
  }
  if (els.btnChatCreateGroup) els.btnChatCreateGroup.addEventListener("click", () => runChatCreateGroup());
  if (els.btnChatBlockAction) els.btnChatBlockAction.addEventListener("click", () => runChatBlockAction().catch((e) => toast(e.message)));
  if (els.btnChatMenu) {
    els.btnChatMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleChatMenu();
    });
  }
  if (els.btnChatDisplayMenu) {
    els.btnChatDisplayMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleChatDisplayMenu();
    });
  }
  if (els.btnChatShowList) {
    els.btnChatShowList.addEventListener("click", () => {
      if (state.chat.mode === "order" || state.chat.surfaceMode === "thread") return;
      openGlobalChat({ keepActiveWallet: true }).catch((err) => toast(err.message));
    });
  }
  if (els.btnChatMaximize) {
    els.btnChatMaximize.addEventListener("click", () => {
      const card = document.getElementById("chatCard");
      const maximized = card?.classList.toggle("chat-maximized") === true;
      els.chatModal?.classList.toggle("chat-modal-maximized", maximized);
      els.btnChatMaximize.textContent = maximized ? "▢" : "□";
      els.btnChatMaximize.title = maximized ? tr("chat_restore", "Restore") : tr("chat_maximize", "Maximize");
      els.btnChatMaximize.setAttribute("aria-label", maximized ? tr("chat_restore", "Restore") : tr("chat_maximize", "Maximize"));
      requestAnimationFrame(() => {
        if (els.chatBox) els.chatBox.scrollTop = els.chatBox.scrollHeight;
      });
    });
  }
  const bindChatMetaToggle = (el, groupKey, key) => {
    if (!el) return;
    el.addEventListener("change", () => {
      state.chat.messageMetaVisible[groupKey] = state.chat.messageMetaVisible[groupKey] || {};
      state.chat.messageMetaVisible[groupKey][key] = el.checked;
      saveChatMetaVisibilityPreference();
      renderChatMessages().catch((err) => toast(err.message));
    });
  };
  bindChatMetaToggle(els.chatMetaSelfWho, "self", "who");
  bindChatMetaToggle(els.chatMetaSelfTransport, "self", "transport");
  bindChatMetaToggle(els.chatMetaSelfTime, "self", "time");
  bindChatMetaToggle(els.chatMetaSelfStatus, "self", "status");
  bindChatMetaToggle(els.chatMetaPeerWho, "peer", "who");
  bindChatMetaToggle(els.chatMetaPeerTransport, "peer", "transport");
  bindChatMetaToggle(els.chatMetaPeerTime, "peer", "time");
  bindChatMetaToggle(els.chatMetaPeerStatus, "peer", "status");
  if (els.btnChatSearch) els.btnChatSearch.addEventListener("click", () => searchChatUsers().catch((e) => toast(e.message)));
  if (els.chatSearchInput) {
    els.chatSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchChatUsers().catch((err) => toast(err.message));
      }
    });
  }
  if (els.chatInput) {
    els.chatInput.addEventListener("keydown", maybeSubmitChatFromEnter);
  }
  if (els.btnChatAttach && els.chatAttachmentInput) {
    els.btnChatAttach.addEventListener("click", () => els.chatAttachmentInput.click());
    els.chatAttachmentInput.addEventListener("change", () => {
      handleChatAttachmentInputChange().catch((err) => toast(err.message));
    });
  }
  if (els.chatAttachmentPreview) {
    els.chatAttachmentPreview.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-chat-attachment-remove]");
      if (!btn) return;
      const id = String(btn.dataset.chatAttachmentRemove || "");
      state.chat.pendingAttachments = (state.chat.pendingAttachments || []).filter((item) => String(item?.attachmentId || "") !== id);
      renderChatAttachmentPreview();
    });
  }
  if (els.chatEmojiBar) {
    els.chatEmojiBar.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-chat-emoji]");
      if (!btn) return;
      insertChatEmoji(btn.dataset.chatEmoji);
    });
  }
  if (els.chatBox) {
    els.chatBox.addEventListener("scroll", () => {
      if (!state.chat.activeWalletId) return;
      if (state.chat.loadingOlderMessages === true || !currentChatHasMore()) return;
      if (els.chatBox.scrollTop > 24) return;
      loadMoreChatMessages().catch((err) => toast(err.message));
    }, { passive: true });
  }
  document.addEventListener("click", (e) => {
    if (!els.chatMenuDropdown || els.chatMenuDropdown.classList.contains("hidden")) return;
    if (e.target?.closest?.("#chatMenuDropdown") || e.target?.closest?.("#btnChatMenu")) return;
    closeChatMenu();
  });
  document.addEventListener("click", (e) => {
    if (!els.chatDisplayMenuDropdown || els.chatDisplayMenuDropdown.classList.contains("hidden")) return;
    if (e.target?.closest?.("#chatDisplayMenuDropdown") || e.target?.closest?.("#btnChatDisplayMenu")) return;
    closeChatDisplayMenu();
  });
  if (els.btnCloseChatFee) {
    els.btnCloseChatFee.addEventListener("click", () => closeChatFeeModal(false));
  }
  if (els.btnCancelChatFee) {
    els.btnCancelChatFee.addEventListener("click", () => closeChatFeeModal(false));
  }
  if (els.btnConfirmChatFee) {
    els.btnConfirmChatFee.addEventListener("click", () => closeChatFeeModal(true));
  }
  if (els.chatFeeModal) {
    els.chatFeeModal.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      if (els.chatFeeModal.classList.contains("hidden")) return;
      pushWalletLog(tr("chat_fee_confirm_enter_log", "Chat fee modal confirmed by Enter"), {
        walletId: state.chat.activeWalletId || "",
        mode: state.chat.mode,
      });
      e.preventDefault();
      closeChatFeeModal(true);
    });
  }

  els.btnProfile.addEventListener("click", async () => {
    if (state.view === "profile") {
      state.view = "home";
      renderAll();
      return;
    }
    await openProfileViewFromHome("open_profile_view");
  });

  if (els.walletCard) {
    const openWalletCard = () => {
      if (state.view !== "home") return;
      openProfileViewFromHome("wallet_card_click").catch((err) => toast(err.message));
    };
    els.walletCard.addEventListener("click", (e) => {
      if (e?.target?.closest?.("button")) return;
      openWalletCard();
    });
    els.walletCard.addEventListener("keydown", (e) => {
      if (e?.target?.closest?.("button")) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openWalletCard();
    });
  }

  document.querySelectorAll(".tabs .tab[data-role]").forEach((btn) => btn.addEventListener("click", async () => {
    state.activeRole = btn.dataset.role;
    state.view = "home";
    clearOrderNotification(state.activeRole);
    try {
      const domains = catalogSyncEnabled() ? ["catalog", "order"] : ["order"];
      await ensureDomainLoaded(domains, { render: false });
    } catch (err) {
      toast(err.message);
    }
    renderView();
    renderRolePanels();
    renderHeader();
    renderMerchants();
    renderBuyerProducts();
    renderCategories();
    renderSellerProducts();
    renderOrders();
  }));

  document.querySelectorAll("[data-order-filter]").forEach((btn) => btn.addEventListener("click", async () => {
    state.orderFilter = btn.dataset.orderFilter;
    document.querySelectorAll("[data-order-filter]").forEach((b) => b.classList.toggle("active", b === btn));
    try {
      await ensureDomainLoaded("order", { render: false });
    } catch (err) {
      toast(err.message);
    }
    renderOrders();
  }));

  if (els.btnRefreshMerchants) {
    els.btnRefreshMerchants.addEventListener("click", async () => {
      if (!catalogSyncEnabled()) {
        toast(tr("catalog_sync_disabled_hint", "商品同步已关闭。不会自动加载或手动同步商品市场数据。"));
        return;
      }
      try {
        await ensureDomainLoaded("catalog", { render: true });
        await callAndRefresh(() => api("/api/catalog/sync", { method: "POST" }));
      } catch (err) {
        toast(err.message);
      }
    });
  }
  if (els.syncCard) {
    els.syncCard.addEventListener("click", (e) => {
      if (e?.target?.closest?.("button")) return;
      openSpvNodesModal("connected").catch((err) => toast(err.message));
    });
  }
  if (els.btnShowConnectedNodes) {
    els.btnShowConnectedNodes.addEventListener("click", (e) => {
      e.stopPropagation();
      openSpvNodesModal("connected").catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseAddProduct && els.addProductModal) {
    els.btnCloseAddProduct.addEventListener("click", () => els.addProductModal.classList.add("hidden"));
  }
  if (els.btnCloseCategoryEdit && els.categoryEditModal) {
    els.btnCloseCategoryEdit.addEventListener("click", () => {
      els.categoryEditModal.classList.add("hidden");
      resetCategoryEditorState();
    });
  }
  if (els.btnCloseProductEdit && els.productEditModal) {
    els.btnCloseProductEdit.addEventListener("click", () => {
      els.productEditModal.classList.add("hidden");
      resetProductEditorState();
    });
  }
  if (els.btnClosePending && els.pendingModal) {
    els.btnClosePending.addEventListener("click", () => els.pendingModal.classList.add("hidden"));
  }
  if (els.btnOrderHistory && els.orderHistoryModal) {
    els.btnOrderHistory.addEventListener("click", () => {
      state.orderHistoryPage = 1;
      renderOrderHistoryModal();
      els.orderHistoryModal.classList.remove("hidden");
    });
  }
  if (els.btnCloseOrderHistory && els.orderHistoryModal) {
    els.btnCloseOrderHistory.addEventListener("click", () => els.orderHistoryModal.classList.add("hidden"));
  }
  if (els.btnCloseOrderDetail && els.orderDetailModal) {
    els.btnCloseOrderDetail.addEventListener("click", closeOrderDetailModal);
  }
  if (els.orderDetailActions) {
    els.orderDetailActions.addEventListener("click", (e) => {
      const buyerBtn = e.target.closest("button[data-order-action]");
      if (buyerBtn) {
        handleBuyerOrderActionButton(buyerBtn);
        return;
      }
      const sellerBtn = e.target.closest("button[data-seller-order-action]");
      if (sellerBtn) handleSellerOrderActionButton(sellerBtn);
    });
  }
  if (els.btnOrderHistoryPrev) {
    els.btnOrderHistoryPrev.addEventListener("click", () => {
      state.orderHistoryPage = Math.max(1, Number(state.orderHistoryPage || 1) - 1);
      renderOrderHistoryModal();
    });
  }
  if (els.btnOrderHistoryNext) {
    els.btnOrderHistoryNext.addEventListener("click", () => {
      state.orderHistoryPage = Math.max(1, Number(state.orderHistoryPage || 1) + 1);
      renderOrderHistoryModal();
    });
  }
  if (els.btnCloseOrderPurchaseConfirm) {
    els.btnCloseOrderPurchaseConfirm.addEventListener("click", () => closeOrderPurchaseConfirmModal(false));
  }
  if (els.btnCancelOrderPurchaseConfirm) {
    els.btnCancelOrderPurchaseConfirm.addEventListener("click", () => closeOrderPurchaseConfirmModal(false));
  }
  if (els.btnConfirmOrderPurchaseConfirm) {
    els.btnConfirmOrderPurchaseConfirm.addEventListener("click", () => closeOrderPurchaseConfirmModal(true));
  }
  if (els.btnCloseSellerAcceptConfirm) {
    els.btnCloseSellerAcceptConfirm.addEventListener("click", () => closeSellerAcceptConfirmModal(null));
  }
  if (els.btnCancelSellerAcceptConfirm) {
    els.btnCancelSellerAcceptConfirm.addEventListener("click", () => closeSellerAcceptConfirmModal(false));
  }
  if (els.btnConfirmSellerAcceptConfirm) {
    els.btnConfirmSellerAcceptConfirm.addEventListener("click", () => closeSellerAcceptConfirmModal(true));
  }
  if (els.btnCloseShipmentInfo) {
    els.btnCloseShipmentInfo.addEventListener("click", () => closeShipmentInfoModal(false));
  }
  if (els.btnCancelShipmentInfo) {
    els.btnCancelShipmentInfo.addEventListener("click", () => closeShipmentInfoModal(false));
  }
  if (els.btnConfirmShipmentInfo) {
    els.btnConfirmShipmentInfo.addEventListener("click", () => closeShipmentInfoModal(true));
  }
  if (els.shipmentInfoInput) {
    els.shipmentInfoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeShipmentInfoModal(true);
      }
    });
  }
  if (els.btnCloseTxProgress) {
    els.btnCloseTxProgress.addEventListener("click", () => closeTxProgressModal(false));
  }
  if (els.btnCloseResync && els.resyncModal) {
    els.btnCloseResync.addEventListener("click", () => {
      els.resyncModal.classList.add("hidden");
      resetResyncProgressUi();
    });
  }
  if (els.btnCloseConflictModal) {
    els.btnCloseConflictModal.addEventListener("click", () => closeConflictModal(state.ui.conflictCloseValue));
  }
  if (els.btnCancelConflictModal) {
    els.btnCancelConflictModal.addEventListener("click", () => closeConflictModal(state.ui.conflictCancelValue));
  }
  if (els.btnConfirmConflictModal) {
    els.btnConfirmConflictModal.addEventListener("click", () => closeConflictModal(state.ui.conflictConfirmValue));
  }
  if (els.btnShowCandidateNodes) {
    els.btnShowCandidateNodes.addEventListener("click", (e) => {
      e.stopPropagation();
      openSpvNodesModal("candidates").catch((err) => toast(err.message));
    });
  }
  if (els.btnCloseSpvNodes && els.spvNodesModal) {
    els.btnCloseSpvNodes.addEventListener("click", () => els.spvNodesModal.classList.add("hidden"));
  }
  if (els.tabSpvConnected) {
    els.tabSpvConnected.addEventListener("click", () => {
      state.spvModalView = "connected";
      renderSpvNodesModalContent();
    });
  }
  if (els.tabSpvCandidates) {
    els.tabSpvCandidates.addEventListener("click", () => {
      state.spvModalView = "candidates";
      renderSpvNodesModalContent();
    });
  }
  if (els.btnRecoverSync) {
    els.btnRecoverSync.addEventListener("click", () => openResyncModal());
  }
  if (els.btnRebuildData) {
    els.btnRebuildData.addEventListener("click", async () => {
      try {
        const result = await api("/api/data/rebuild", {
          method: "POST",
          timeoutMs: 120000,
        });
        if (result?.state) applyServerState(result.state);
        renderAll();
        toast(tr("data_rebuild_done", "数据重建已完成"));
      } catch (err) {
        toast(err.message);
      }
    });
  }
  if (els.btnSyncNow) {
    els.btnSyncNow.addEventListener("click", () => openResyncModal());
  }
  if (els.btnConfirmResync) {
    els.btnConfirmResync.addEventListener("click", async () => {
      let flowNonce = 0;
      try {
        const raw = Math.floor(Number(els.resyncBootstrapHeight?.value || defaultResyncBootstrapHeight()));
  if (!Number.isFinite(raw)) return toast(tr("resync_height_invalid", "Enter a valid block height"));
  if (raw < 947111) return toast(tr("resync_height_too_low", "Start height cannot be lower than 947111"));
        const nowMs = Date.now();
        const cooldownUntil = Math.max(0, Number(state.ui?.resyncFlow?.cooldownUntil || 0));
        if (cooldownUntil > nowMs) {
          const waitMs = Math.max(0, cooldownUntil - nowMs);
          return toast(trf("resync_cooldown_notice", { seconds: (waitMs / 1000).toFixed(1) }, `Please wait ${(waitMs / 1000).toFixed(1)}s before starting sync again`));
        }
        flowNonce = nextResyncFlowNonce();
        const token = issueServerStateToken();
        state.ui.appliedServerStateToken = token;
        state.ui.resyncFlow.cooldownUntil = nowMs + 2000;
        state.sync.bootstrapHeight = raw;
        startResyncProgressFlow({ bootstrapHeight: raw, nonce: flowNonce, startDisabled: false });
        const resetResult = await api("/api/catalog/resync", {
          method: "POST",
          body: {
            bootstrapHeight: raw,
            confirmReset: true,
          },
          timeoutMs: 120000,
        });
        if (!isActiveResyncFlowNonce(flowNonce)) return;
        clearTradeDomainsForResync();
        if (resetResult?.state) applyServerState(resetResult.state, { token, replaceSync: true });
        state.ui.resyncFlow.commandId = String(resetResult?.commandId || "");
        state.ui.resyncFlow.commandType = String(resetResult?.commandType || "");
        state.ui.resyncFlow.resetEpoch = Number(resetResult?.resetEpoch || 0);
        state.ui.resyncFlow.resetCompleted = true;
        state.ui.resyncFlow.startDisabled = false;
        renderResyncProgressUi(buildResyncFlowState({
          sync: state.sync,
          runtime: state.runtime || {},
          jobState: state.jobState || null,
          commandQueue: state.commandQueue || null,
        }));
        renderAll();
        completeResyncToolFlow({
          nonce: flowNonce,
          bootstrapHeight: raw,
          commandId: String(resetResult?.commandId || ""),
          interruptedExistingSync: resetResult?.interruptedExistingSync === true,
          interruptedCount: Number(resetResult?.interruptedCount || 0),
          drainWaitMs: Number(resetResult?.drainWaitMs || 0),
          autoClose: true,
        });
      } catch (err) {
        if (!isActiveResyncFlowNonce(flowNonce)) return;
        clearResyncFlowPoller();
        state.ui.resyncFlow.active = false;
        if (els.btnCloseResync) els.btnCloseResync.disabled = false;
        if (els.btnConfirmResync) els.btnConfirmResync.disabled = false;
        renderResyncProgressUi({
          steps: baseResyncSteps({ bootstrapHeight: Number(els.resyncBootstrapHeight?.value || 0) }).map((step, index) => ({
            ...step,
            status: index === 0 ? "error" : "pending",
            tone: index === 0 ? "error" : "",
      detail: index === 0 ? String(err?.message || err || tr("submit_failed", "Submit failed")) : step.detail,
          })),
          finished: false,
          percent: 0,
    currentLabel: tr("submit_failed", "Submit failed"),
    summary: String(err?.message || err || tr("submit_failed", "Submit failed")),
        });
        toast(err.message);
      }
    });
  }
  if (els.btnPushChain) {
    els.btnPushChain.addEventListener("click", async () => {
      try {
        await openPendingModal();
      } catch (err) {
        toast(err.message);
      }
    });
  }
  if (els.btnConfirmPushInModal) {
    els.btnConfirmPushInModal.addEventListener("click", async () => {
      const btn = els.btnConfirmPushInModal;
      try {
        const password = String(els.pendingPassword?.value || "").trim();
        if (!password) return toast(tr("wallet_password_required", "Please enter wallet password"));
        if (btn) btn.disabled = true;
        if (els.pendingSummary) els.pendingSummary.textContent = tr("pending_submitting_queue", "Processing in background. Submitting the current queue...");
        openTxProgressModal("push", tr("tx_progress_push_title", "Publishing on-chain"));
        const r = await api("/api/changes/push", { method: "POST", body: { password }, timeoutMs: PUSH_CHAIN_STATUS_TIMEOUT_MS });
        const donePayload = await trackPushProgress();
        const progress = donePayload?.progress || {};
        const uploaded = Number(progress.processed || r.uploaded || 0);
        const failed = String(progress.status || "") === "failed" ? 1 : Number(r.failed || 0);
        if (uploaded > 0 && failed <= 0) {
          pushNotice(trf("pending_uploaded_notice", { count: uploaded, fee: Number(r.totalFeeBsv || 0).toFixed(8) }, `Published ${uploaded} changes with fee ${Number(r.totalFeeBsv || 0).toFixed(8)} BSV`));
        }
        if (failed > 0) {
          const reason = localizeUserFacingError(progress.lastError || r.failedItems?.[0]?.reason || tr("retry_later", "Please try again later"));
          pushNotice(trf("pending_publish_failed_notice", { count: failed, reason }, `Publish failed for ${failed} items: ${reason}`), "warn");
        }
        await refreshStateLite();
        renderAll();
        renderPendingModalContent();
        if (Number(state.sync.pendingUploads || 0) <= 0 && els.pendingModal) els.pendingModal.classList.add("hidden");
        finalizeTxProgressSuccess(tr("tx_progress_success", "Completed successfully"));
      } catch (err) {
        const msg = localizeUserFacingError(err?.message || err || tr("pending_publish_failed", "Publish failed"));
        state.ui.txProgress.closable = true;
        renderTxProgressUi({
          title: tr("tx_progress_push_title", "Publishing on-chain"),
          summary: msg,
          elapsedText: formatElapsedText(Date.now() - Date.parse(String(state.ui?.txProgress?.startedAt || new Date().toISOString()))),
          steps: txProgressStepBlueprint("push").map((step, index) => ({
            ...step,
            status: index === 0 ? "error" : "pending",
            detail: index === 0 ? msg : "",
          })),
        });
        if (els.txProgressModal) els.txProgressModal.classList.remove("hidden");
        toast(err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  if (els.recoverableList) {
    els.recoverableList.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("[data-recover-change-id]");
      if (!btn) return;
      const changeId = String(btn.getAttribute("data-recover-change-id") || "").trim();
      if (!changeId) return;
      try {
        btn.disabled = true;
        const r = await api("/api/changes/recover", { method: "POST", body: { changeId } });
        if (r?.state) applyServerState(r.state);
        renderAll();
        renderPendingModalContent();
    pushNotice(trf("recoverable_restored_notice", { count: Number(r.recoveredCount || 1) }, `Restored ${Number(r.recoveredCount || 1)} locally reserved unconfirmed broadcasts`));
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }
  if (els.walletHistoryList) {
    els.walletHistoryList.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("[data-wallet-rebroadcast-txid]");
      if (!btn) return;
      const txid = String(btn.getAttribute("data-wallet-rebroadcast-txid") || "").trim();
      if (!txid) return;
      try {
        btn.disabled = true;
        await api(`/api/wallet/broadcast-monitor/${encodeURIComponent(txid)}/rebroadcast`, {
          method: "POST",
          timeoutMs: 45000,
        });
        toast(tr("wallet_rebroadcast_started", "已重新广播，等待确认"));
        await refreshWalletHistory({ includeBroadcastMonitor: true, runBroadcastMonitor: true });
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }
  if (els.keyword) {
    els.keyword.addEventListener("input", scheduleBuyerKeywordSearch);
    els.keyword.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      applyBuyerKeywordSearch({ showError: true }).catch((err) => toast(err.message));
    });
  }
  if (els.btnSearch) {
    els.btnSearch.addEventListener("click", () => {
      applyBuyerKeywordSearch({ showError: true }).catch((err) => toast(err.message));
    });
  }

  if (els.btnBuyerBrowseByCategory) {
    els.btnBuyerBrowseByCategory.addEventListener("click", () => {
      state.buyerBrowseMode = "category";
      renderBuyerBrowseMode();
      renderBuyerProducts();
    });
  }
  if (els.btnBuyerBrowseByMerchant) {
    els.btnBuyerBrowseByMerchant.addEventListener("click", () => {
      state.buyerBrowseMode = "merchant";
      if (!state.selectedMerchantId || state.selectedMerchantId === BUYER_ALL_MERCHANTS) {
        state.selectedMerchantId = String(buyerMerchants()[0]?.id || "");
      }
      state.selectedBuyerMerchantCategoryId = "ALL";
      renderBuyerBrowseMode();
      renderMerchants();
      renderBuyerMerchantCategories();
      renderBuyerProducts();
    });
  }

  if (els.btnAddCategory) {
    els.btnAddCategory.addEventListener("click", async () => {
      try {
        await ensureDomainLoaded("catalog", { render: false });
        openCategoryCreateModal();
      } catch (err) {
        toast(err.message);
      }
    });
  }
  if (els.btnSubmitCategoryEdit) {
    els.btnSubmitCategoryEdit.addEventListener("click", async () => {
      if (!requireEditingAllowed(tr("category_save_action", "Save category"))) return;
      const id = state.editingCategoryId;
      const name = String(els.editCategoryName?.value || "").trim();
      if (!name) return toast(tr("category_name_required", "Please enter a category name"));
      if (!id) {
        if (categoryNameExists(name)) return toast(tr("category_name_duplicate", "Category name already exists"));
        const result = await api("/api/catalog/category", { method: "POST", body: { action: "add", name } });
        if (result?.state) applyServerState(result.state, { token: issueServerStateToken() });
        const createdId = String(result?.id || "").trim();
        if (createdId) {
          ensureLocalCategoryPresent({ id: createdId, name, merchantId: state.currentMerchantId });
          state.selectedCategoryId = createdId;
        }
        renderAll();
        if (els.categoryEditModal) els.categoryEditModal.classList.add("hidden");
        resetCategoryEditorState();
        return;
      }
      if (categoryNameExists(name, id)) return toast(tr("category_name_duplicate", "Category name already exists"));
      const editor = state.ui.categoryEditor || {};
      const currentSignature = categoryPayloadSignature(currentCategoryEditorPayload());
      const baseSignature = String(editor.baseSignature || "");
      const latestSignature = String(editor.latestSignature || baseSignature);
      if (editor.latestMissing) {
        const useCurrentDraft = await openConflictModal({
          title: tr("category_deleted_title", "Category was deleted"),
          message: tr("category_deleted_message", "The category no longer exists in the database. You can discard your current edits, or keep them and write them locally as a pending on-chain change."),
          cancelLabel: tr("discard_current_changes", "Discard current changes"),
          confirmLabel: tr("keep_current_changes", "Keep current changes"),
        });
        if (!useCurrentDraft) {
          if (els.categoryEditModal) els.categoryEditModal.classList.add("hidden");
          resetCategoryEditorState();
          toast(tr("category_edit_discarded", "Category edits discarded"));
          return;
        }
      } else if (currentSignature !== baseSignature && latestSignature !== baseSignature) {
        const useCurrentDraft = await openConflictModal({
          title: tr("category_conflict_title", "Category has new data"),
          message: tr("category_conflict_message", "The category in the database was updated by another device or by on-chain sync. You can use the latest data or keep your current edits and write them locally as a pending on-chain change."),
          cancelLabel: tr("use_latest_data", "Use latest data"),
          confirmLabel: tr("keep_my_changes", "Keep my changes"),
        });
        if (!useCurrentDraft) {
          const latestItem = sellerCategories().find((c) => String(c.id || "") === String(id || ""));
          const latestPayload = categoryPayloadFromItem(latestItem);
          const latestAppliedSignature = categoryPayloadSignature(latestPayload);
          applyCategoryPayloadToForm(latestPayload);
          state.ui.categoryEditor.baseSignature = latestAppliedSignature;
          state.ui.categoryEditor.latestSignature = latestAppliedSignature;
          state.ui.categoryEditor.conflictPending = false;
          state.ui.categoryEditor.latestMissing = false;
          toast(tr("category_conflict_discarded", "Latest category data applied. Your current edits were discarded."));
          return;
        }
      }
      await callAndRefresh(() => api("/api/catalog/category", { method: "POST", body: { action: "edit", id, name } }));
      if (els.categoryEditModal) els.categoryEditModal.classList.add("hidden");
      resetCategoryEditorState();
    });
  }
  if (els.editCategoryPreset) {
    els.editCategoryPreset.addEventListener("change", () => {
      const value = String(els.editCategoryPreset?.value || "").trim();
      if (!value) return;
      if (els.editCategoryName) els.editCategoryName.value = value;
    });
  }

  if (els.btnAddProduct) {
    els.btnAddProduct.addEventListener("click", async () => {
      try {
        if (!requireEditingAllowed(tr("product_add_action", "Add product"))) return;
        await ensureDomainLoaded("catalog", { render: false });
        const rows = sellerCategories();
        if (!rows.length) return toast(tr("select_category_first", "Select a category first"));
        if (!state.selectedCategoryId || !rows.some((c) => String(c.id || "") === String(state.selectedCategoryId || ""))) {
          state.selectedCategoryId = String(rows[0]?.id || "");
        }
        fillCategorySelectOptions(els.addProductCategory, state.selectedCategoryId);
        if (els.addProductTitle) els.addProductTitle.value = "";
        if (els.addProductPrice) els.addProductPrice.value = "0";
        if (els.addProductStock) els.addProductStock.value = "0";
        if (els.addProductImageUrl) els.addProductImageUrl.value = "";
        if (els.addProductImageFile) els.addProductImageFile.value = "";
        setProductImagePreview(els.addProductImagePreview, "");
        if (els.addProductDescription) els.addProductDescription.value = "";
        if (els.addProductModal) els.addProductModal.classList.remove("hidden");
      } catch (err) {
        toast(err.message);
      }
    });
  }
	  if (els.btnSubmitAddProduct) {
	    els.btnSubmitAddProduct.addEventListener("click", async () => {
	      if (!requireEditingAllowed(tr("product_add_action", "Add product"))) return;
	      const categoryId = String(els.addProductCategory?.value || "").trim();
	      const activeCategory = sellerCategories().find((c) => String(c?.id || "") === categoryId);
	      if (!activeCategory) return toast(tr("select_category_first", "Add a category first"));
	      await callAndRefresh(() => api("/api/catalog/product", {
	        method: "POST",
	        body: {
          action: "add",
          merchantId: state.currentMerchantId,
          categoryId,
          title: els.addProductTitle.value.trim(),
          price: Number(els.addProductPrice.value || 0),
          stock: Number(els.addProductStock.value || 0),
          imageUrl: els.addProductImageUrl.value.trim(),
          description: els.addProductDescription.value.trim(),
        },
      }));
      if (els.addProductModal) els.addProductModal.classList.add("hidden");
    });
  }
  if (els.addProductImageFile) {
    els.addProductImageFile.addEventListener("change", () => {
      handleProductImageFileSelection(els.addProductImageFile, els.addProductImageUrl, els.addProductImagePreview).catch((err) => {
        toast(err?.message || tr("product_image_prepare_failed", "商品图片处理失败"));
      });
    });
  }
  if (els.editProductImageFile) {
    els.editProductImageFile.addEventListener("change", () => {
      handleProductImageFileSelection(els.editProductImageFile, els.editProductImageUrl, els.editProductImagePreview).catch((err) => {
        toast(err?.message || tr("product_image_prepare_failed", "商品图片处理失败"));
      });
    });
  }
  if (els.btnSubmitProductEdit) {
    els.btnSubmitProductEdit.addEventListener("click", async () => {
      if (!requireEditingAllowed(tr("product_save_action", "Save product"))) return;
      const id = state.editingProductId;
      if (!id) return toast(tr("product_not_selected", "No product selected"));
      const categoryId = String(els.editProductCategory?.value || "").trim();
      const editor = state.ui.productEditor || {};
      const currentSignature = productPayloadSignature(currentProductEditorPayload());
      const baseSignature = String(editor.baseSignature || "");
      const latestSignature = String(editor.latestSignature || baseSignature);
      if (editor.latestMissing) {
        const useCurrentDraft = await openConflictModal({
          title: tr("product_deleted_title", "Product was deleted"),
          message: tr("product_deleted_message", "The product no longer exists in the database. You can discard your current edits, or keep them and write them locally as a pending on-chain change."),
          cancelLabel: tr("discard_current_changes", "Discard current changes"),
          confirmLabel: tr("keep_current_changes", "Keep current changes"),
        });
        if (!useCurrentDraft) {
          if (els.productEditModal) els.productEditModal.classList.add("hidden");
          resetProductEditorState();
          toast(tr("product_edit_discarded", "Product edits discarded"));
          return;
        }
      } else if (currentSignature !== baseSignature && latestSignature !== baseSignature) {
        const useCurrentDraft = await openConflictModal({
          title: tr("product_conflict_title", "Product has new data"),
          message: tr("product_conflict_message", "The product in the database was updated by another device or by on-chain sync. You can use the latest data or keep your current edits and write them locally as a pending on-chain change."),
          cancelLabel: tr("use_latest_data", "Use latest data"),
          confirmLabel: tr("keep_my_changes", "Keep my changes"),
        });
        if (!useCurrentDraft) {
          const latestItem = state.products.find((p) => String(p.id || "") === String(id || "") && isOwnedProduct(p));
          const latestPayload = productPayloadFromItem(latestItem);
          const latestAppliedSignature = productPayloadSignature(latestPayload);
          applyProductPayloadToForm(latestPayload);
          state.ui.productEditor.baseSignature = latestAppliedSignature;
          state.ui.productEditor.latestSignature = latestAppliedSignature;
          state.ui.productEditor.conflictPending = false;
          state.ui.productEditor.latestMissing = false;
          toast(tr("product_conflict_discarded", "Latest product data applied. Your current edits were discarded."));
          return;
        }
      }
      await callAndRefresh(() => api("/api/catalog/product", {
        method: "POST",
        body: {
          action: "edit",
          id,
          categoryId,
          title: String(els.editProductTitle?.value || "").trim(),
          price: Number(els.editProductPrice?.value || 0),
          stock: Number(els.editProductStock?.value || 0),
          imageUrl: String(els.editProductImageUrl?.value || "").trim(),
          description: String(els.editProductDescription?.value || "").trim(),
        },
      }));
      if (els.productEditModal) els.productEditModal.classList.add("hidden");
      resetProductEditorState();
    });
  }

  els.btnSaveProfile.addEventListener("click", () => saveProfileAndChatSettings().catch((err) => toast(err.message)));
  if (els.langSelect) {
    els.langSelect.addEventListener("change", async () => {
      const previous = localeState.code;
      try {
        els.langSelect.disabled = true;
        await setUiLanguage(els.langSelect.value, { persist: true, rerender: true });
      } catch (err) {
        if (els.langSelect) els.langSelect.value = resolvePreferredLocale(previous);
        toast(err.message || tr("language_switch_failed", "语言切换失败"));
      } finally {
        els.langSelect.disabled = false;
      }
    });
  }
  if (els.btnApplySteward) {
    els.btnApplySteward.addEventListener("click", async () => {
      await callAndRefresh(() => api("/api/steward", {
        method: "POST",
        body: {
          regionPriority: els.regionPriority.value,
          pollSec: Number(els.pollSec.value || 15),
          replayWindow: Number(els.replayWindow.value || 120),
          catalogSyncEnabled: els.catalogSyncEnabled?.value !== "0",
        },
      }));
    });
  }
  if (els.btnLogout) {
    els.btnLogout.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
        state.wallet.loggedIn = false;
        state.ui.walletUiLoaded = false;
        state.ui.walletViewActive = false;
        state.walletWatch.lastTotalSat = null;
        setWalletSendPreflight(false, tr("wallet_logged_out_sync_again", "已退出登录，请重新登录后同步钱包"));
        if (state.timers.walletPoll) {
          clearInterval(state.timers.walletPoll);
          state.timers.walletPoll = null;
        }
        if (state.timers.catalogPoll) {
          clearInterval(state.timers.catalogPoll);
          state.timers.catalogPoll = null;
        }
        clearEventReconnectTimer();
        if (state.events.ws) {
          try { state.events.ws.close(); } catch (_) {}
          state.events.ws = null;
        }
        state.events.connected = false;
        state.view = "home";
        await initAuthGate();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  els.btnWalletSwitch.addEventListener("click", () => {
    state.switchWallet.currentPassword = "";
    els.switchWalletPassword.value = "";
    els.switchWalletNewPassword.value = "";
    els.switchWalletMnemonic.value = "";
    els.switchWalletProgress.textContent = "";
    els.switchStep1.classList.remove("hidden");
    els.switchStep2.classList.add("hidden");
    els.switchWalletModal.classList.remove("hidden");
  });
  els.btnCloseSwitchWallet.addEventListener("click", () => els.switchWalletModal.classList.add("hidden"));
  els.btnSwitchStep1Next.addEventListener("click", async () => {
    const currentPwd = els.switchWalletPassword.value.trim();
    if (!currentPwd) return toast(tr("err_current_password_required"));
    try {
      await api("/api/auth/login", { method: "POST", body: { password: currentPwd } });
      state.switchWallet.currentPassword = currentPwd;
      els.switchStep1.classList.add("hidden");
      els.switchStep2.classList.remove("hidden");
    } catch (err) {
      toast(tr("err_wrong_password"));
    }
  });
  els.btnConfirmSwitchWallet.addEventListener("click", async () => {
    const password = state.switchWallet.currentPassword;
    const newPassword = els.switchWalletNewPassword.value.trim();
    const mnemonic = els.switchWalletMnemonic.value.trim().replace(/\s+/g, " ");
    if (!password) return toast(tr("switch_wallet_finish_step1_first", "Finish step 1 current-password verification first"));
    if (!newPassword) return toast(tr("err_new_password_required"));
    if (!mnemonic) return toast(tr("err_target_mnemonic_required"));
    try {
      els.btnConfirmSwitchWallet.disabled = true;
      els.switchWalletProgress.textContent = tr("progress_1");
      await new Promise((resolve) => setTimeout(resolve, 120));
      els.switchWalletProgress.textContent = tr("progress_2");
      const result = await api("/api/wallet/switch", { method: "POST", timeoutMs: WALLET_OP_TIMEOUT_MS, body: { password: newPassword, mnemonic, mode: "import" } });
      els.switchWalletProgress.textContent = tr("progress_3");
      const syncQueued = await api("/api/wallet/sync?rescan=1&count=50", {
        method: "POST",
        timeoutMs: WALLET_OP_TIMEOUT_MS,
        body: { asyncProgress: true },
      });
      await resolveWalletSyncResponse(syncQueued, {
        onProgress: (text) => {
          if (text) els.switchWalletProgress.textContent = text;
        },
      });
      els.switchWalletProgress.textContent = tr("progress_4");
      pushWalletLog(tr("wallet_switch_success_log", "Wallet switch succeeded"), result);
      setWalletSendPreflight(false, tr("wallet_switch_wait_sync", "Wallet switched. Wait for chain sync to recover; refresh wallet state if needed."));
      if (result?.state) {
        applyServerState(result.state, { token: issueServerStateToken() });
      }
      await ensureReceiveAddress();
      restoreWalletSendPreflight();
      // Keep wallet-switch/login isolation: catalog sync is manual via Sync button.
      els.switchWalletProgress.textContent = tr("progress_done");
      els.switchWalletModal.classList.add("hidden");
    } catch (err) {
      toast(err.message);
    } finally {
      els.btnConfirmSwitchWallet.disabled = false;
    }
  });

  els.btnWalletSync.addEventListener("click", async () => {
    const prevLabel = els.btnWalletSync.textContent;
    try {
      state.ui.walletSyncInFlight = true;
      setWalletSendPreflight(false, tr("wallet_refresh_in_progress", "Wallet refresh and send precheck in progress"));
      renderHeader();
      els.btnWalletSync.disabled = true;
      els.btnWalletSync.textContent = tr("wallet_sync_in_progress_label", "Refreshing Wallet...");
      pushWalletLog(tr("wallet_refresh_start_log", "Wallet refresh started"), "incremental sync + preflight");
      const result = await api("/api/wallet/sync", {
        method: "POST",
        timeoutMs: WALLET_OP_TIMEOUT_MS,
        body: {
          source: "wallet_sync_button",
          asyncProgress: true,
        },
      });
      const finalResult = await resolveWalletSyncResponse(result, {
        onProgress: (text) => {
          if (text) pushWalletLog(tr("wallet_refresh_progress_log", "Wallet refresh progress"), text);
        },
      });
      pushWalletLog(tr("wallet_refresh_done_log", "Wallet refresh completed"), finalResult);
      state.ui.walletSyncCleanModeUntil = Date.now() + 10 * 60 * 1000;
      if (finalResult?.state) {
        applyServerState(finalResult.state, { token: issueServerStateToken() });
      }
      await ensureReceiveAddress();
      await refreshWalletUiFromEvent("wallet_refresh_done");
      pushWalletLog(tr("wallet_send_precheck_log", "Wallet send precheck"), walletSendGateStatus());
    } catch (err) { toast(err.message); }
    finally {
      state.ui.walletSyncInFlight = false;
      els.btnWalletSync.disabled = false;
      els.btnWalletSync.textContent = prevLabel;
      renderHeader();
    }
  });

  async function openWalletReceiveModal(options = {}) {
    const refresh = options.refresh === true;
    const endpoint = refresh ? "/api/wallet/receive-address/refresh" : "/api/wallet/receive-address";
    const request = refresh ? { method: "POST" } : {};
    const result = await api(endpoint, request);
    state.walletReceiveAddress = result.address || "";
    if (els.walletReceiveView) els.walletReceiveView.value = state.walletReceiveAddress;
    if (els.receiveModalAddress) els.receiveModalAddress.value = state.walletReceiveAddress;
    renderReceiveQr();
    renderReceiveModalQr();
    if (options.open !== false && els.receiveModal) els.receiveModal.classList.remove("hidden");
    pushNotice(refresh
      ? tr("wallet_new_address_updated", "New receive address created")
      : tr("wallet_receive_updated", "Receive address updated"));
  }

  els.btnWalletReceive.addEventListener("click", async () => {
    try {
      await openWalletReceiveModal({ refresh: true, open: true });
    } catch (err) { toast(err.message); }
  });
  if (els.btnHomeWalletReceive) {
    els.btnHomeWalletReceive.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await openWalletReceiveModal({ refresh: false, open: true });
      } catch (err) { toast(err.message); }
    });
  }
  if (els.btnCloseReceiveModal && els.receiveModal) {
    els.btnCloseReceiveModal.addEventListener("click", () => els.receiveModal.classList.add("hidden"));
  }
  if (els.btnCopyReceive) {
    els.btnCopyReceive.addEventListener("click", async () => {
      try {
        const text = String(state.walletReceiveAddress || els.walletReceiveView?.value || "").trim();
        if (!text) {
          toast(tr("wallet_receive_empty", "No receive address yet"));
          return;
        }
        await copyTextToClipboard(text);
        pushNotice(tr("wallet_receive_copied", "Receive address copied"));
      } catch (_) {
        toast(tr("wallet_receive_copy_failed", "Failed to copy receive address"));
      }
    });
  }
  if (els.btnCopyReceiveModal) {
    els.btnCopyReceiveModal.addEventListener("click", async () => {
      try {
        const text = String(state.walletReceiveAddress || els.receiveModalAddress?.value || "").trim();
        if (!text) {
          toast(tr("wallet_receive_empty", "No receive address yet"));
          return;
        }
        await copyTextToClipboard(text);
        pushNotice(tr("wallet_receive_copied", "Receive address copied"));
      } catch (_) {
        toast(tr("wallet_receive_copy_failed", "Failed to copy receive address"));
      }
    });
  }

  function openWalletSendModal(options = {}) {
    const gate = walletSendGateStatus();
    if (!gate.ready) {
      toast(gate.reason || tr("wallet_need_sync_before_send", "Please finish chain sync and refresh wallet state if needed before sending"));
      return false;
    }
    if (Number(state.wallet.availableBsv || 0) <= 0) {
      toast(tr("msg_no_balance_send"));
      return false;
    }
    const donation = options.donation === true;
    if (els.sendModalTitle) {
      els.sendModalTitle.textContent = donation
        ? tr("donate_bsv_title", "Donate BSV")
        : tr("send_bsv_title", "Send BSV");
    }
    els.sendModalTo.value = donation ? DONATION_ADDRESS : "";
    els.sendModalTo.readOnly = donation;
    els.sendModalAmount.value = String(options.amountBsv || "0.00001");
    els.sendModalAmount.placeholder = "";
    els.sendModalAmount.dataset.sendAll = "";
    if (els.sendModalNote) els.sendModalNote.value = donation ? tr("donation_note_default", "donation") : "";
    renderSendModalAvailableBalance();
    els.sendModal.classList.remove("hidden");
    return true;
  }

  els.btnWalletSend.addEventListener("click", () => openWalletSendModal());
  if (els.btnHomeWalletSend) {
    els.btnHomeWalletSend.addEventListener("click", (e) => {
      e.stopPropagation();
      openWalletSendModal();
    });
  }
  if (els.btnWalletDonate) {
    els.btnWalletDonate.addEventListener("click", () => openWalletSendModal({ donation: true }));
  }
  els.btnCloseSend.addEventListener("click", () => {
    els.sendModal.classList.add("hidden");
    els.sendModalTo.readOnly = false;
    if (els.sendModalTitle) els.sendModalTitle.textContent = tr("send_bsv_title", "Send BSV");
  });
  if (els.btnSendAll) {
    els.btnSendAll.addEventListener("click", async () => {
      try {
        let inputCount = 1;
        try {
          const status = await api("/api/wallet/status", { silent: true });
          inputCount = Math.max(1, Number(status?.walletState?.walletUtxoCount || 1));
        } catch (_) {}
        const totalSat = Number(state.wallet.availableSat || Math.round(Number(state.wallet.availableBsv || 0) * 100000000) || 0);
        const estimate = estimateSendAllAmountBsv(inputCount, totalSat);
        els.sendModalAmount.value = estimate.sendBsv > 0 ? estimate.sendBsv.toFixed(8) : "0.00000000";
        els.sendModalAmount.placeholder = tr("send_all_placeholder", "Send all");
        els.sendModalAmount.dataset.sendAll = "1";
        pushNotice(trf("send_all_estimated_notice", { amount: estimate.sendBsv.toFixed(8), feeSat: estimate.feeSat }, `Estimated send-all amount ${estimate.sendBsv.toFixed(8)} BSV after fee ${estimate.feeSat} sat`));
      } catch (err) {
        toast(String(err?.message || err || tr("send_all_estimate_failed", "Failed to estimate send-all amount")));
      }
    });
  }
  if (els.sendModalAmount) {
    els.sendModalAmount.addEventListener("input", () => {
      els.sendModalAmount.dataset.sendAll = "";
    });
  }
  els.btnSendConfirm.addEventListener("click", async () => {
    try {
      const sendAll = String(els.sendModalAmount?.dataset?.sendAll || "") === "1";
      const amountBsv = sendAll ? 0 : Number(els.sendModalAmount.value || 0);
      const currentTotalBsv = Number(state.wallet.availableBsv || 0);
      const noteText = String(els.sendModalNote?.value || "").trim();
      const sendTrace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const gate = walletSendGateStatus();
      if (!gate.ready) {
        throw new Error(gate.reason || tr("wallet_need_sync_before_send", "Please finish chain sync and refresh wallet state if needed before sending"));
      }
      if (!sendAll && !(amountBsv > 0)) {
        toast(tr("send_amount_invalid", "Enter a valid send amount"));
        return;
      }
      if (!sendAll && !(currentTotalBsv > amountBsv)) {
        toast(tr("balance_insufficient_fee", "Insufficient balance. Leave room for miner fee"));
        return;
      }
      try {
        console.info("[wallet-send-click]", {
          sendTrace,
          to: els.sendModalTo.value.trim(),
          amountBsv: sendAll ? "ALL" : amountBsv,
          sendAll,
          note: noteText,
          currentTotalBsv,
        });
      } catch (_) {}
      pushWalletLog(tr("wallet_send_click_log", "Send button clicked"), {
        sendTrace,
        to: els.sendModalTo.value.trim(),
        amountBsv: sendAll ? "ALL" : amountBsv,
        sendAll,
        note: noteText,
      });
      els.sendModal.classList.add("hidden");
      openTxProgressModal("send", tr("tx_progress_send_title", "Sending BSV"));
      pushNotice(tr("wallet_send_submitting", "Submitting transfer..."));
      const queued = await api("/api/wallet/send", {
        method: "POST",
        timeoutMs: WALLET_OP_TIMEOUT_MS,
        body: {
          to: els.sendModalTo.value.trim(),
          amountBsv,
          sendAll,
          note: noteText || "wallet-send",
          sendTrace,
          asyncProgress: true,
        },
      });
      const resultPayload = await trackWalletSendProgress(queued?.commandId || "");
      const result = resultPayload?.command?.result && typeof resultPayload.command.result === "object"
        ? resultPayload.command.result
        : {};
      pushWalletLog(tr("wallet_send_submitted_log", "Transfer submitted"), { ...result, sendTrace });
      pushNotice(tr("wallet_send_submitted_notice", "Transfer submitted. Waiting for confirmation"));
      let postRefreshError = "";
      try {
        await ensureReceiveAddress();
      } catch (refreshErr) {
        postRefreshError = String(refreshErr?.message || refreshErr || tr("wallet_send_refresh_failed", "Post-send refresh failed"));
        pushWalletLog(tr("wallet_send_refresh_failed", "Post-send refresh failed"), { sendTrace, error: postRefreshError });
      }
      const txidText = String(result?.txid || "").trim();
      const preflight = evaluateWalletSendPreflight({
        statusHint: result?.beefComplete === true ? "ready_with_unconfirmed_chain" : "blocked_need_beef_context",
        allowUnconfirmedChain: result?.beefComplete === true,
        requireBeefComplete: true,
        beefComplete: result?.beefComplete === true,
        readyReason: txidText
          ? trf("wallet_previous_pending_ready_txid", { txid: txidText.slice(0, 8) }, `Previous send {txid} is stored locally and its unconfirmed chain context is complete. You can continue sending`)
          : tr("wallet_previous_pending_ready", "Previous send is stored locally and its unconfirmed chain context is complete. You can continue sending"),
      });
      setWalletSendPreflight(preflight.status, preflight.reason);
      pushWalletLog(tr("wallet_send_recheck_log", "Post-send eligibility reevaluated"), {
        sendTrace,
        txid: txidText,
        beefComplete: result?.beefComplete === true,
        gate: walletSendGateStatus(),
      });
      if (postRefreshError) {
        toast(trf("wallet_send_submitted_refresh_failed", { error: postRefreshError }, `Transfer submitted, but post-send refresh failed: ${postRefreshError}`));
      }
      finalizeTxProgressSuccess(tr("tx_progress_success", "Completed successfully"));
    } catch (err) {
      try {
        console.error("[wallet-send-click-failed]", {
          error: String(err?.message || err),
        });
      } catch (_) {}
      const msg = String(err.message || "");
      state.ui.txProgress.closable = true;
      renderTxProgressUi({
        title: tr("tx_progress_send_title", "Sending BSV"),
        summary: msg || tr("wallet_send_failed", "Send failed"),
        elapsedText: formatElapsedText(Date.now() - Date.parse(String(state.ui?.txProgress?.startedAt || new Date().toISOString()))),
        steps: txProgressStepBlueprint("send").map((step, index) => ({
          ...step,
          status: index === 0 ? "error" : "pending",
          detail: index === 0 ? (msg || tr("wallet_send_failed", "Send failed")) : "",
        })),
      });
      if (els.txProgressModal) els.txProgressModal.classList.remove("hidden");
      if (msg.includes("No local SPV UTXOs found")) {
        toast(tr("balance_unconfirmed_wait", "Balance is not confirmed yet. Please wait for confirmation before publishing on-chain"));
      } else if (msg.includes("Insufficient spendable balance")) {
        toast(tr("balance_insufficient_fee", "Insufficient balance. Leave room for miner fee"));
      } else if (msg.includes("BEEF context incomplete")) {
        toast(tr("beef_context_incomplete", "Transaction context is incomplete. Sending is blocked by strict BEEF rules; wait for the previous transaction to confirm or sync context first"));
      } else {
        toast(msg);
      }
    }
  });

  els.btnShowMnemonic.addEventListener("click", () => {
    els.mnemonicPassword.value = "";
    els.mnemonicOutput.value = "";
    els.mnemonicModal.classList.remove("hidden");
  });
  els.btnCloseMnemonic.addEventListener("click", () => els.mnemonicModal.classList.add("hidden"));
  els.btnMnemonicConfirm.addEventListener("click", async () => {
    try {
      const result = await api("/api/wallet/mnemonic", { method: "POST", body: { password: els.mnemonicPassword.value.trim() } });
      els.mnemonicOutput.value = result.mnemonic || "";
      pushWalletLog(tr("mnemonic_verified_log", "Mnemonic verified and shown"), "ok");
    } catch (err) { toast(err.message); }
  });

  const handleBuyerProductClick = (e) => {
    const row = e.target.closest("[data-open-product]");
    if (!row) return;
    const productId = String(row.dataset.openProduct || "").trim();
    if (!productId) return;
    openProductDetailModal(productId);
  };
  els.productList.addEventListener("click", handleBuyerProductClick);
  if (els.buyerMerchantProductList) els.buyerMerchantProductList.addEventListener("click", handleBuyerProductClick);

  els.merchantList.addEventListener("click", (e) => {
    const row = e.target.closest("[data-merchant-id]");
    if (!row) return;
    const merchantId = String(row.dataset.merchantId || "");
    const item = buyerMerchants().find((m) => m.id === merchantId);
    if (!item) return;
    state.selectedMerchantId = item.id;
    renderMerchants();
    renderBuyerProducts();
  });

  if (els.buyerPrimaryCategoryList) {
    els.buyerPrimaryCategoryList.addEventListener("click", (e) => {
      const row = e.target.closest("[data-buyer-primary-category]");
      if (!row) return;
      state.search.primaryCategory = String(row.dataset.buyerPrimaryCategory || "ALL").trim() || "ALL";
      renderBuyerPrimaryCategories();
      renderBuyerProducts();
    });
  }
  if (els.btnCloseProductDetail) {
    els.btnCloseProductDetail.addEventListener("click", () => closeProductDetailModal());
  }
  if (els.btnProductDetailBuy) {
    els.btnProductDetailBuy.addEventListener("click", async () => {
      const productId = String(els.btnProductDetailBuy?.dataset.productId || "").trim();
      await runBuyerProductPurchase(productId);
    });
  }
  els.categoryList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-category-action]");
    if (btn) {
      if (!requireEditingAllowed(tr("category_edit_action", "Edit category"))) return;
      const categoryId = String(btn.dataset.categoryId || "");
      const action = String(btn.dataset.categoryAction || "");
      const item = sellerCategories().find((c) => c.id === categoryId);
      if (!item) return;
      if (action === "rename") {
        openCategoryEditModal(categoryId);
        return;
      }
      if (action === "delete") {
        const confirmed = await openConflictModal({
          title: tr("category_delete_confirm_title", "Confirm category deletion"),
          message: trf("category_delete_confirm_message", { name: item.name || categoryId }, `Delete category "${item.name || categoryId}"?`),
          cancelLabel: tr("cancel", "Cancel"),
          confirmLabel: tr("confirm_delete", "Delete"),
        });
        if (!confirmed) return;
        callAndRefresh(() => api("/api/catalog/category", { method: "POST", body: { action: "delete", id: categoryId } }));
      }
      return;
    }
    const row = e.target.closest(".row");
    if (!row) return;
    const id = String(row.dataset.categoryId || "");
    const item = sellerCategories().find((c) => c.id === id);
    if (!item) return;
    state.selectedCategoryId = item.id;
    renderCategories();
    renderSellerProducts();
  });

  els.sellerProductList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-product-action]");
    if (btn) {
      if (!requireEditingAllowed(tr("product_edit_action", "Edit product"))) return;
      const productId = String(btn.dataset.productId || "");
      const action = String(btn.dataset.productAction || "");
      const p = state.products.find((x) => x.id === productId && isOwnedProduct(x));
      if (!p) return;
      if (action === "edit") {
        openProductEditModal(productId);
        return;
      }
      if (action === "delete") {
        const confirmed = await openConflictModal({
          title: tr("product_delete_confirm_title", "Confirm product deletion"),
          message: trf("product_delete_confirm_message", { name: p.title || productId }, `Delete product "${p.title || productId}"?`),
          cancelLabel: tr("cancel", "Cancel"),
          confirmLabel: tr("confirm_delete", "Delete"),
        });
        if (!confirmed) return;
        callAndRefresh(() => api("/api/catalog/product", { method: "POST", body: { action: "delete", id: productId } }));
      }
      return;
    }
    const row = e.target.closest(".row");
    if (!row) return;
    const p = state.products.find((x) => x.id === row.dataset.sellerProductId && isOwnedProduct(x));
    if (!p) return;
    state.selectedSellerProductId = p.id;
    renderSellerProducts();
  });

  els.orderListBuyer.addEventListener("click", (e) => {
    const detailTarget = e.target.closest("[data-open-order-detail]");
    if (detailTarget) {
      openOrderDetailModal(detailTarget.dataset.orderId, detailTarget.dataset.orderRole || "buyer");
      return;
    }
    const btn = e.target.closest("button[data-order-action]");
    if (btn) handleBuyerOrderActionButton(btn);
  });

  els.orderListSeller.addEventListener("click", (e) => {
    const detailTarget = e.target.closest("[data-open-order-detail]");
    if (detailTarget) {
      openOrderDetailModal(detailTarget.dataset.orderId, detailTarget.dataset.orderRole || "seller");
      return;
    }
    const btn = e.target.closest("button[data-seller-order-action]");
    if (btn) handleSellerOrderActionButton(btn);
  });

  els.chatUserPane.addEventListener("click", (e) => {
    closeChatUserContextMenu();
    const disconnectBtn = e.target.closest("button[data-chat-disconnect]");
    if (disconnectBtn) {
      triggerChatDisconnect(disconnectBtn.dataset.chatDisconnect).catch((err) => toast(err.message));
      return;
    }
    const testBtn = e.target.closest("button[data-chat-connect-test]");
    if (testBtn) {
      triggerChatConnectTest(testBtn.dataset.chatConnectTest).catch((err) => toast(err.message));
      return;
    }
    const btn = e.target.closest("button[data-chat-wallet]");
    if (!btn) return;
    if (state.chat.mode === "order") return;
    setActiveChatWallet(btn.dataset.chatWallet);
    const switchSeq = Number(state.chat.activeSwitchSeq || 0);
    renderChatUsers();
    renderChatStatusBar();
    renderChatMessages({ ensureLoaded: false, switchSeq }).catch((err) => toast(err.message));
    renderChatMessages({ ensureLoaded: true, switchSeq, loadingIfEmpty: true })
      .then(() => {
        if (Number(state.chat.activeSwitchSeq || 0) !== switchSeq) return null;
        scheduleMarkActiveChatThreadRead(250);
        setTimeout(() => {
          if (Number(state.chat.activeSwitchSeq || 0) !== switchSeq) return;
          refreshChatDirectStatusForWallet(state.chat.activeWalletId, {
            silent: true,
            render: true,
            activeOnly: true,
          }).catch(() => {});
        }, 0);
        return null;
      })
      .catch((err) => toast(err.message));
  });
  els.chatUserPane.addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-chat-user-context]");
    if (!row) return;
    e.preventDefault();
    openChatUserContextMenu(row.dataset.chatUserContext, e.clientX, e.clientY);
  });
  document.addEventListener("click", (e) => {
    if (els.chatUserContextMenu && !els.chatUserContextMenu.contains(e.target)) closeChatUserContextMenu();
  });
}

(async function main() {
  await initI18n();
  loadChatMetaVisibilityPreference();
  bindEvents();
  bindUiEventHandlers();
  renderAll();
  try {
    const authed = await initAuthGate();
    if (authed) {
      await runPostLoginBootstrap();
      // Keep wallet-switch/login isolation: catalog sync is manual via Sync button.
    }
  } catch (err) {
    hideLoadingModal();
    toast(trf("init_failed", { error: err.message }, `Initialization failed: ${err.message}`));
  }
})();

(function initCatalogDefaultCategories(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.CATALOG_DEFAULT_CATEGORIES = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function buildCatalogDefaultCategories() {
  return Object.freeze([
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
    "农资绿植"
  ]);
}));

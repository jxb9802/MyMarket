# Project Name

A decentralized P2P marketplace with on-chain escrow and built-in decentralized storage.

---

## 🚀 How to Use

### 1. Installation
**Method 1: Run directly from source (Recommended)**

1. Download the entire project to your local machine.
2. Extract the files to a disk with **plenty of free space**.  
   *The application synchronizes all product and user data locally, so storage usage will grow as the platform scales.*
3. Start the application:
   - **Windows**: Double-click `start.bat`
   - **Linux / macOS**: Run `./start.sh` in the terminal
4. Open your browser and visit:  
   **http://127.0.0.1:8091**

**Method 2: Install via npm**

  1.npm install @jxb9802/bsv-market
  
  2.cd node_modules/@jxb9802/bsv-market
  
  3.npm start
  
  4. Open your browser and visit:  
   **http://127.0.0.1:8091**
---

### 2. Main Features

- **Buyer Page** (Default) — Browse, search, and purchase products.
- **Seller Page** — Create and publish your own product listings.
- **Free On-Chain Cloud Storage** — Built-in decentralized storage for files and data.

---

### 3. Transaction & Dispute Resolution

This platform uses a **deposit-based escrow system** with **no central arbitration**. All disputes are handled transparently on-chain.

#### Transaction Flow

1. **Buyer creates an order** → Product amount + **20% security deposit** is locked.
2. **Seller confirms the order** → Seller locks **5% security deposit**.
3. **Seller ships the goods** and submits delivery confirmation.
4. **Buyer confirms receipt** → Transaction completes:
   - 20% deposit refunded to buyer
   - 5% deposit refunded to seller
   - Product amount transferred to seller

#### Return / Dispute Process

- If the buyer requests a return, the case is forwarded to the seller.
- If the seller **accepts** the return:
  - Product amount + 20% deposit refunded to buyer
  - 5% deposit refunded to seller
  - Buyer must return the goods
- If the seller **rejects** the return:
  - Both parties must resolve the dispute privately.
  - All locked funds remain **permanently locked** on-chain:
    - Buyer’s 20% deposit + product amount
    - Seller’s 5% deposit

---

## ⚠️ Important Notes

- This is a **fully decentralized** application. There is no platform arbitration.
- Ensure you have sufficient disk space before running the node.
- All transactions and deposits are handled on-chain.
- Keep your private keys secure.

---

## Tech Stack

*(Add your technologies here — e.g. Blockchain, IPFS, etc.)*

---

## License

*(Add license information)*

---

**Made with ❤️ for decentralized commerce**

如何使用项目
1.下载整个项目到你的本机电脑
2.把代码解压到一个空间最大的磁盘，由于软件要在你的电脑上同步所有商品数据，随着用户和商品变需要很大的磁盘空间
3.windows平台运行 start.bat; Linux或Mac 运行./start.sh
4.运行软件后会在你的电脑的 8091 端口打开web服务，所以你可以通过 http://127.0.0.1:8091 进行访问
5.本项目内部有一个免费的链上网盘
6.你可以通过左上角的买家页（默认页）来搜索和购买商品
7.你可以通过左上角的卖家页来发布自己的商品
8.本项目没有仲裁机制，买卖双方通过锁定保证金来进行处理争议，具体过程如下：
  a.买下创建订单，会自动锁定商口金额+20%的保证金
  b.卖家需要确认订单，卖家也要锁定10%的保证金
  c.卖家发货后把交易确认提交给买家
  d.买家如果确认收货，交易完成，20%保证金退回买家，10%保证金退回卖家，商品金额汇入卖家，交易完成
  c.习家如果退货，则交易流转给卖家处理
  e.卖家确认退回商品后可以完成退货，则20%保证金和商品金额退回买家，10%保证金退回卖家（商品退回）
  f.卖家如不确认退回，则双方自行私下解决，链上永远锁定买的的20%保证金和商品金额，及卖家的10%保证金
  

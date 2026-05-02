Windows sync watch:

- Every ~10 minutes, read Windows-side logs and JSON snapshots only.
- Do not read or touch Windows `market.db` or other SQLite files.
- Do not modify `/home/jb9802/share/bsv_market` until Windows sync finishes.
- Check:
  - `log/market-debug.log` for `independent_sync_commit_window_profile`, `independent_sync_service_finished`, `sync_final_state_merged`, `sync_heights_clamped_by_receipts_on_load`, `sqlite_sync_state_persist_failed`, `api_unhandled_error`
  - `data/p2p_sync_receipts.json` for `committedHeight`
  - `data/public_state_cache.json` for recovery of `sync` / `wallet`
  - `log/bsv_market_run.log` for repeated `disk I/O error`
- If sync stalls, regresses, or public state stays broken, diagnose from logs and make fixes only in Linux workspace first.

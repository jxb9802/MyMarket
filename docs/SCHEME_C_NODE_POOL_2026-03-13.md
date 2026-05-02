# Scheme C Node Pool

Date: 2026-03-13

Source:
- `docs/scheme_c_probe_report.json`
- `docs/scheme_c_filtered_probe_report.json`

Selection rule:
- Passed stage 1: handshake + `ping` + `filterload` + `filteradd` + `filterclear`
- Passed stage 2: handshake + `filterload` + `getheaders` + filtered block response

Dedicated node pool:

```text
100.11.85.230:8333
100.49.247.84:8333
100.7.12.142:8333
107.136.51.230:8333
107.210.90.217:8333
115.187.38.11:8333
135.148.136.25:8333
```

Current overlap with recent active SPV peers:
- Present in recent active set:
  - `100.49.247.84:8333`
  - `107.136.51.230:8333`
  - `107.210.90.217:8333`
- Not present in recent active set:
  - `100.11.85.230:8333`
  - `100.7.12.142:8333`
  - `115.187.38.11:8333`
  - `135.148.136.25:8333`

Notes:
- This pool should be used only for Scheme C experiments.
- Do not replace the general SPV peer pool with this list.
- Re-probe regularly; support is capability-sensitive and can drift over time.

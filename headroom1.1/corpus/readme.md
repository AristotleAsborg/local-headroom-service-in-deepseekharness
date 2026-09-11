---
description: "A local cache bridge for deployments that need a bounded, self-sweeping store in front of a slow backend."
kind: "package-reference"
---

# @example-org/example-cache-bridge

English | [中文](README.zh.md)

## Summary

This package keeps a bounded working set of recently read records in memory so that repeated reads do not
reach the backend. Entries carry an expiry, a hit counter and a byte cost, and a sweeper evicts whatever
exceeds the configured budget. It is useful in front of a network store, a filesystem index, or any backend
whose latency is dominated by round trips rather than by work. No cache is enabled by default, and the
package owns no storage of its own: every entry lives only as long as the process does.

## Use this package

Add the bridge when the same records are read more than once inside one process. One configuration entry is
the whole setup: give the cache a budget and a sweep interval, and the wrapper appears around the backend
client you already use.

### Minimal configuration

```yaml
- id: cache-bridge
  name: '@example-org/example-cache-bridge'
  config:
    maxEntries: 1024
    ttlSeconds: 60
    sweepIntervalSeconds: 5
```

| Field | Default | Meaning |
|---|---|---|
| `maxEntries` | required | Hard ceiling on stored entries |
| `ttlSeconds` | required | How long an entry stays readable |
| `sweepIntervalSeconds` | `5` | How often expired entries are collected |
| `onEvict` | — | Callback invoked with the key and the eviction reason |
| `maxEntryBytes` | `262144` | Entries larger than this are stored by reference |
| `warmOnStart` | `false` | Preload the working set before serving |

### Key shape and coexistence

Keys are namespaced by the caller, so two wrappers over the same backend never collide. A key stays stable
while the underlying record keeps its identity, so repeated reads hit the same entry across reloads.

- Two entries publishing the same key coexist under their own namespaces.
- Two configurations using the same namespace: the later one fails to load.
- A backend that reports the same key twice in one page gets that page treated as inconsistent.
- An update that changes the key shape is rejected rather than silently missing every read.

## Known Limitations

- Storage is per process; a restart starts cold and every entry is gone.
- Warm-on-start reads the backend synchronously and will delay startup.
- Eviction is by budget and age, not by usefulness, so a large cold entry can displace a small hot one.
- Metrics are counters only; no histograms or per-key reporting.

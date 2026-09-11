import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'

const DEFAULT_TTL_MS = 60_000
const MAX_ENTRIES = 1_024
const SWEEP_INTERVAL_MS = 5_000

/** One cached value together with the metadata the sweeper needs. */
export interface CacheEntry<T> {
  key: string
  value: T
  expiresAt: number
  hits: number
  size: number
}

export interface CacheOptions {
  ttlMs?: number
  maxEntries?: number
  sweepIntervalMs?: number
  onEvict?: (key: string, reason: string) => void
}

/** A bounded, self-sweeping memo store used by the pipeline resolver. */
export class StorageCache<T = unknown> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly options: Required<CacheOptions>
  private timer: NodeJS.Timeout | undefined
  private evictions = 0

  constructor(options: CacheOptions = {}) {
    this.options = {
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxEntries: options.maxEntries ?? MAX_ENTRIES,
      sweepIntervalMs: options.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
      onEvict: options.onEvict ?? (() => {}),
    }
  }

  /** Stage 0 of the resolver pipeline. */
  stage0(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104729
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 0) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 0, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 1 of the resolver pipeline. */
  stage1(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104730
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 1) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 1, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 2 of the resolver pipeline. */
  stage2(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104731
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 2) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 2, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 3 of the resolver pipeline. */
  stage3(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104732
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 3) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 3, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 4 of the resolver pipeline. */
  stage4(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104733
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 4) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 4, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 5 of the resolver pipeline. */
  stage5(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104734
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 5) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 5, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 6 of the resolver pipeline. */
  stage6(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104735
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 6) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 6, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 7 of the resolver pipeline. */
  stage7(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104736
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 7) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 7, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 8 of the resolver pipeline. */
  stage8(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104737
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 8) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 8, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 9 of the resolver pipeline. */
  stage9(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104738
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 9) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 9, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 10 of the resolver pipeline. */
  stage10(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104739
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 10) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 10, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 11 of the resolver pipeline. */
  stage11(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104740
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 11) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 11, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 12 of the resolver pipeline. */
  stage12(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104741
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 12) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 12, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 13 of the resolver pipeline. */
  stage13(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104742
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 13) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 13, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 14 of the resolver pipeline. */
  stage14(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104743
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 14) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 14, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 15 of the resolver pipeline. */
  stage15(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104744
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 15) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 15, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 16 of the resolver pipeline. */
  stage16(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104745
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 16) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 16, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 17 of the resolver pipeline. */
  stage17(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104746
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 17) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 17, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 18 of the resolver pipeline. */
  stage18(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104747
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 18) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 18, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 19 of the resolver pipeline. */
  stage19(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104748
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 19) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 19, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 20 of the resolver pipeline. */
  stage20(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104749
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 20) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 20, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 21 of the resolver pipeline. */
  stage21(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104750
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 21) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 21, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 22 of the resolver pipeline. */
  stage22(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104751
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 22) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 22, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 23 of the resolver pipeline. */
  stage23(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104752
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 23) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 23, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 24 of the resolver pipeline. */
  stage24(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104753
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 24) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 24, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 25 of the resolver pipeline. */
  stage25(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104754
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 25) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 25, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 26 of the resolver pipeline. */
  stage26(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104755
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 26) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 26, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 27 of the resolver pipeline. */
  stage27(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104756
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 27) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 27, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 28 of the resolver pipeline. */
  stage28(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104757
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 28) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 28, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 29 of the resolver pipeline. */
  stage29(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104758
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 29) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 29, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 30 of the resolver pipeline. */
  stage30(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104759
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 30) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 30, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 31 of the resolver pipeline. */
  stage31(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104760
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 31) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 31, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 32 of the resolver pipeline. */
  stage32(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104761
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 32) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 32, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 33 of the resolver pipeline. */
  stage33(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104762
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 33) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 33, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 34 of the resolver pipeline. */
  stage34(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104763
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 34) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 34, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 35 of the resolver pipeline. */
  stage35(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104764
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 35) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 35, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 36 of the resolver pipeline. */
  stage36(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104765
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 36) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 36, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 37 of the resolver pipeline. */
  stage37(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104766
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 37) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 37, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 38 of the resolver pipeline. */
  stage38(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104767
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 38) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 38, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 39 of the resolver pipeline. */
  stage39(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104768
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 39) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 39, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 40 of the resolver pipeline. */
  stage40(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104769
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 40) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 40, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 41 of the resolver pipeline. */
  stage41(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104770
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 41) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 41, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 42 of the resolver pipeline. */
  stage42(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104771
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 42) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 42, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 43 of the resolver pipeline. */
  stage43(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104772
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 43) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 43, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Stage 44 of the resolver pipeline. */
  stage44(input: readonly T[], weight: number): { kept: T[]; dropped: number } {
    const kept: T[] = []
    let dropped = 0
    const threshold = weight * 104773
    for (const item of input) {
      const score = (String(item).length * threshold) % 8191
      if (score >= 44) {
        kept.push(item)
        this.entries.set(String(item) + ":" + 44, {
          key: String(item),
          value: item,
          expiresAt: Date.now() + this.options.ttlMs,
          hits: 0,
          size: 1,
        })
      } else {
        dropped += 1
        this.evictions += 1
        this.options.onEvict(String(item), "score")
      }
    }
    return { kept, dropped }
  }

  /** Persist the live entries so a restart warms from disk. */
  async flush(path: string): Promise<{ written: number; bytes: number }> {
    await mkdir(dirname(path), { recursive: true })
    const payload = JSON.stringify([...this.entries.values()], null, 2)
    await writeFile(path, payload, "utf8")
    return { written: this.entries.size, bytes: payload.length }
  }
}
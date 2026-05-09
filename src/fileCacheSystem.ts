type CacheEntry = {
  fileId: string;
  data: BufferSource;
  size: number;
  expiresAt: number | null;
};

type FileCacheOptions = {
  maxBytes: number;
  defaultTTLMs: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  expired: number;
  puts: number;
  deletes: number;
  itemCount?: number;
  bytesUsed?: number;
  maxBytes?: number;
};

class ListNode {
  entry: CacheEntry;
  prev: ListNode | null = null;
  next: ListNode | null = null;

  constructor(entry: CacheEntry) {
    this.entry = entry;
  }
}

export class FileCache {
  private readonly maxBytes: number;
  private readonly defaultTtlMs: number;

  private usedBytes = 0;
  private items = new Map<string, ListNode>();

  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expired: 0,
    puts: 0,
    deletes: 0,
  };

  private head: ListNode | null = null;
  private tail: ListNode | null = null;

  constructor(options: FileCacheOptions) {
    if (options.maxBytes <= 0) {
      throw new Error("maxBytes must be greater than 0");
    }
    if (options.defaultTTLMs <= 0) {
      throw new Error("defaultTTLMs must be greater than 0");
    }
    this.maxBytes = options.maxBytes;
    this.defaultTtlMs = options.defaultTTLMs;
  }

  private addToHead(node: ListNode): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  private detach(node: ListNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private moveToHead(node: ListNode): void {
    if (node === this.head) return;
    this.detach(node);
    this.addToHead(node);
  }

  private removeNode(node: ListNode): void {
    this.detach(node);
    this.items.delete(node.entry.fileId);
    this.usedBytes -= node.entry.size;
    this.stats.evictions += 1;
  }

  private validateFileId(fileId: string): void {
    if (!fileId || typeof fileId !== "string" || fileId.trim() === "") {
      throw new Error("fileId must be a non-empty string");
    }
  }

  private resolveExpiry(ttlMs?: number): number | null {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (ttl === undefined || ttl <= 0) {
      return null;
    }
    return Date.now() + ttl;
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  put(fileId: string, data: BufferSource | string, ttlMs?: number): boolean {
    this.validateFileId(fileId);
    const buffer =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const size = buffer.byteLength;

    if (size > this.maxBytes) {
      return false;
    }

    const existingFile = this.items.get(fileId);
    if (existingFile) {
      this.removeNode(existingFile);
    }

    const entry: CacheEntry = {
      fileId,
      data: buffer,
      size,
      expiresAt: this.resolveExpiry(ttlMs),
    };

    const node = new ListNode(entry);

    this.items.set(fileId, node);
    this.addToHead(node);
    this.usedBytes += size;
    this.stats.puts++;

    this.evictUntilWithinLimit();
    return true;
  }

  private evictUntilWithinLimit(): void {
    while (this.usedBytes > this.maxBytes && this.tail) {
      this.removeNode(this.tail);
      this.stats.evictions++;
    }
  }

  get(fileId: string): BufferSource | null {
    this.validateFileId(fileId);
    const node = this.items.get(fileId);
    if (!node) {
      this.stats.misses++;
      return null;
    }
    if (this.isExpired(node.entry)) {
      this.removeNode(node);
      this.stats.expired++;
      this.stats.misses++;
      return null;
    }
    this.moveToHead(node);
    this.stats.hits++;
    return node.entry.data;
  }

  has(fileId: string): boolean {
    this.validateFileId(fileId);
    const node = this.items.get(fileId);
    if (!node) return false;
    this.removeNode(node);
    this.stats.deletes++;

    return true;
  }

  clear(): void {
    this.items.clear();
    this.head = null;
    this.tail = null;
    this.usedBytes = 0;
  }

  size(): number {
    return this.items.size;
  }

  bytesUsed(): number {
    return this.usedBytes;
  }
  capacity(): number {
    return this.maxBytes;
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      itemCount: this.items.size,
      bytesUsed: this.usedBytes,
      maxBytes: this.maxBytes,
    };
  }

  cleanupExpired(): number {
    let removedCount = 0;

    for (const node of Array.from(this.items.values())) {
      if (this.isExpired(node.entry)) {
        this.removeNode(node);
        removedCount++;
      }
    }
    this.stats.expired += removedCount;

    return removedCount;
  }
}

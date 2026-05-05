export type Message<T> = {
  id: string;
  payload: T;
  receivedAt: number;
};

export type MessageInput<T> = Omit<Message<T>, "receivedAt"> &
  Partial<Pick<Message<T>, "receivedAt">>;

export type Handler<T> = (message: Message<T>) => Promise<void>;

export type DeadLetter<T> = {
  message: Message<T>;
  attempts: number;
  error: string;
  failedAt: number;
};

type WorkItem<T> = {
  message: Message<T>;
  attempts: number;
};

export type IngestorOptions<T> = {
  concurrency: number;
  maxPending: number;
  maxRetries: number;
  timeoutMs: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  dedupeSize?: number;
  deadLetterLimit?: number;
  onDeadLetter?: (item: DeadLetter<T>) => void;
};

class FastQueue<T> {
  private items: Array<T | undefined> = [];
  private head: number = 0;

  push(item: T): void {
    this.items.push(item);
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;

    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head++;

    if (this.head > 1000 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  get length(): number {
    return this.items.length - this.head;
  }
}

export class ReliableMessageIngestor<T> {
  private queue = new FastQueue<WorkItem<T>>();

  private activeIds = new Set<string>();
  private processedIds = new Map<string, true>();
  private deadLetters: DeadLetter<T>[] = [];

  private inflightCount = 0;
  private accepting = true;

  private readonly options: IngestorOptions<T>;
  private onDeadLetter: (item: DeadLetter<T>) => void = () => {};

  private stats = {
    accepted: 0,
    processed: 0,
    failed: 0,
    deadLettered: 0,
    retried: 0,
    duplicates: 0,
    rejected: 0,
    failedAttempts: 0,
  };

  constructor(
    private readonly handler: Handler<T>,
    options: IngestorOptions<T>,
  ) {
    this.options = {
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 10_000,
      dedupeSize: 10_000,
      deadLetterLimit: 1000,
      ...options,
    };
    this.onDeadLetter = this.options.onDeadLetter ?? (() => {});
    if (this.options.concurrency <= 0)
      throw new Error("Concurrency must be greater than 0");
    if (this.options.maxPending <= 0)
      throw new Error("Max pending must be greater than 0");
  }

  ingest(input: MessageInput<T>): boolean {
    if (!this.accepting) {
      this.stats.rejected++;
      return false;
    }

    const id = input.id?.trim();
    if (!id) {
      throw new Error("Message id is required");
    }

    if (this.activeIds.has(id) || this.processedIds.has(id)) {
      this.stats.duplicates++;
      return true;
    }

    if (this.activeIds.size >= this.options.maxPending) {
      this.stats.rejected++;
      return false;
    }

    const message: Message<T> = {
      ...input,
      id,
      receivedAt: input.receivedAt ?? Date.now(),
    };

    this.activeIds.add(id);
    this.queue.push({ message, attempts: 0 });
    this.stats.accepted++;
    this.drain();

    return true;
  }

  private async drain() {
    while (
      this.inflightCount < this.options.concurrency &&
      this.queue.length > 0
    ) {
      const item = this.queue.shift();
      if (!item) return;

      this.inflightCount++;
      this.process(item).catch((err: unknown) => {
        throw new Error(
          `unhandled error in processing message ${item.message.id}, cause: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  private async process(item: WorkItem<T>): Promise<void> {
    const { message } = item;

    try {
      const work = Promise.resolve().then(() => this.handler(message));
      await this.withTimeout(
        work,
        this.options.timeoutMs,
        this.options.timeoutMs,
      );
      this.activeIds.delete(message.id);
      this.processedIds.set(message.id, true);
      this.rememberProcessedId(message.id);
      this.stats.processed++;
    } catch (err: unknown) {
      const attempts = item.attempts + 1;
      if (attempts > this.options.maxRetries) {
        this.moveToDeadLetter(message, attempts, err);
        this.activeIds.delete(message.id);
        return;
      }

      this.stats.failedAttempts++;
      this.stats.retried++;

      const delay = this.retryDelay(attempts);

      setTimeout(() => {
        this.queue.push({ message, attempts });
        this.drain();
      }, delay);
    } finally {
      this.inflightCount--;
      this.drain();
    }
  }

  private moveToDeadLetter(
    message: Message<T>,
    attempts: number,
    error: unknown,
  ) {
    this.activeIds.delete(message.id);

    const deadLetter: DeadLetter<T> = {
      message,
      attempts,
      error: error instanceof Error ? error.message : String(error),
      failedAt: Date.now(),
    };
    this.deadLetters.push(deadLetter);
    if (this.deadLetters.length > this.options.deadLetterLimit!) {
      this.deadLetters.shift();
    }
    this.stats.deadLettered++;

    this.onDeadLetter(deadLetter);
  }

  private rememberProcessedId(id: string) {
    if (this.processedIds.has(id)) {
      this.processedIds.delete(id);
    }

    this.processedIds.set(id, true);

    while (this.processedIds.size > this.options.dedupeSize!) {
      const oldestId = this.processedIds.keys().next().value;
      if (oldestId !== undefined) {
        this.processedIds.delete(oldestId);
      }
    }
  }

  private retryDelay(attempts: number): number {
    const base = this.options.baseRetryDelayMs ?? 100;
    const max = this.options.maxRetryDelayMs ?? 10_000;
    const exponentialDelay = Math.min(base * 2 ** (attempts - 1), max);
    const capped = Math.min(exponentialDelay, max);
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.floor(capped * jitter);
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    ms: number,
  ): Promise<T> {
    if (ms <= 0) return promise;

    let timer: ReturnType<typeof setTimeout>;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Processing timed out after ${timeoutMs} ms`));
      }, ms);
      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeCount: this.activeIds.size,
      inflightCount: this.inflightCount,
      deadLetterCount: this.deadLetters.length,
    };
  }

  getDeadLetters() {
    return [...this.deadLetters];
  }

  stopAccepting() {
    this.accepting = false;
  }

  async stopAndDrain(timeoutMs: number): Promise<boolean> {
    this.stopAccepting();
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const idle =
        this.queue.length === 0 &&
        this.inflightCount === 0 &&
        this.activeIds.size === 0;
      if (idle) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }
}

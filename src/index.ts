import BankingSystem from "./bankingSystem.js";
import { FileCache } from "./fileCacheSystem.js";
import { ReliableMessageIngestor } from "./messageIngestor.js";

type BankingEvent =
  | {
      event: "deposit";
      accountId: number;
      amount: number;
    }
  | {
      event: "withdraw";
      accountId: number;
      amount: number;
    }
  | {
      event: "transfer";
      fromAccountId: number;
      toAccountId: number;
      amount: number;
    }
  | {
      event: "get_balance";
      accountId: number;
      timestamp: number;
    }
  | {
      event: "bad_event";
    };

const bank = new BankingSystem();
const fileCache = new FileCache({
  maxBytes: 10_000,
  defaultTTLMs: 30_000,
});

const decoder = new TextDecoder();

function cacheJson(fileId: string, value: unknown, ttlMs?: number): void {
  const cached = fileCache.put(fileId, JSON.stringify(value), ttlMs);
  if (!cached) {
    console.log("cache skipped", { fileId });
  }
}

function readCachedJson<T>(fileId: string): T | null {
  const cached = fileCache.get(fileId);
  return cached ? (JSON.parse(decoder.decode(cached)) as T) : null;
}

function balanceCacheKey(accountId: number, timestamp: number): string {
  return `balance:${accountId}:${timestamp}`;
}

function getCachedBalance(accountId: number, timestamp: number): number | null {
  const fileId = balanceCacheKey(accountId, timestamp);
  const cachedBalance = readCachedJson<number>(fileId);

  if (cachedBalance !== null) {
    console.log("balance cache hit", { fileId, cachedBalance });
    return cachedBalance;
  }

  const balance = bank.getBalanceAt(accountId, timestamp);
  if (balance !== null) {
    cacheJson(fileId, balance, 10_000);
    console.log("balance cache miss; stored result", { fileId, balance });
  }

  return balance;
}

bank.createAccount(1, "Alice");
bank.createAccount(2, "Bob");
bank.deposit(1, 500, Date.now());
bank.deposit(2, 100, Date.now());

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const ingestor = new ReliableMessageIngestor<BankingEvent>(
  async (message) => {
    await sleep(Math.random() * 500);

    const timestamp = Date.now();
    const { payload } = message;

    switch (payload.event) {
      case "deposit": {
        const ok = bank.deposit(payload.accountId, payload.amount, timestamp);
        if (!ok) throw new Error("deposit failed");

        console.log("processed deposit", {
          messageId: message.id,
          accountId: payload.accountId,
          amount: payload.amount,
        });
        return;
      }

      case "withdraw": {
        const balance = bank.withdraw(
          payload.accountId,
          payload.amount,
          timestamp,
        );
        if (balance === null) throw new Error("withdraw failed");

        console.log("processed withdraw", {
          messageId: message.id,
          accountId: payload.accountId,
          amount: payload.amount,
          balance,
        });
        return;
      }

      case "transfer": {
        const ok = bank.transfer(
          payload.fromAccountId,
          payload.toAccountId,
          payload.amount,
          timestamp,
        );
        if (!ok) throw new Error("transfer failed");

        console.log("processed transfer", {
          messageId: message.id,
          fromAccountId: payload.fromAccountId,
          toAccountId: payload.toAccountId,
          amount: payload.amount,
        });
        return;
      }

      case "get_balance": {
        const balance = getCachedBalance(payload.accountId, payload.timestamp + 1);
        if (balance === null) throw new Error("get_balance failed");

        console.log("processed get_balance", {
          messageId: message.id,
          accountId: payload.accountId,
          timestamp: payload.timestamp,
          balance,
        });
        return;
      }

      case "bad_event":
        throw new Error("bad event failed");
    }
  },
  {
    concurrency: 4,
    maxPending: 1000,
    maxRetries: 3,
    timeoutMs: 1000,
    onDeadLetter: (item) => {
      console.log("dead-lettered", {
        messageId: item.message.id,
        attempts: item.attempts,
        error: item.error,
      });
    },
  },
);

ingestor.ingest({
  id: "msg_1",
  payload: { event: "deposit", accountId: 1, amount: 200 },
});

ingestor.ingest({
  id: "msg_2",
  payload: { event: "withdraw", accountId: 1, amount: 50 },
});

ingestor.ingest({
  id: "msg_3",
  payload: {
    event: "transfer",
    fromAccountId: 1,
    toAccountId: 2,
    amount: 125,
  },
});

ingestor.ingest({
  id: "msg_4",
  payload: { event: "bad_event" },
});

ingestor.ingest({
  id: "msg_1",
  payload: { event: "deposit", accountId: 1, amount: 999 },
});

ingestor.ingest({
  id: "msg_5",
  payload: { event: "get_balance", accountId: 1, timestamp: Date.now() },
});

const drained = await ingestor.stopAndDrain(5_000);

const finalState = {
  aliceBalance: getCachedBalance(1, Date.now()),
  bobBalance: getCachedBalance(2, Date.now()),
  aliceTransactions: bank.getTransactionHistory(1),
  bobTransactions: bank.getTransactionHistory(2),
  topSpenders: bank.getTopSpenders(5),
};

cacheJson("banking:final-state", finalState);

console.log("drained", drained);
console.log("stats", ingestor.getStats());
console.log("deadLetters", ingestor.getDeadLetters());
console.log("finalState", finalState);
console.log("cachedFinalState", readCachedJson("banking:final-state"));
console.log("cacheStats", fileCache.getStats());

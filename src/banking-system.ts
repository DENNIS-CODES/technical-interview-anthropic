type TransactionType = "DEPOSIT" | "WITHDRAW" | "TRANSFER_IN" | "TRANSFER_OUT";
type AccountId = number | string;

type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  timestamp: number;
  balanceAfter: number;
  counterparty?: string;
};

type Account = {
  id: number;
  name: string;
  balance: number;
   history: BalanceSnapshot[];
  transactions: Transaction[];
  spentTotal: number;
  createdAt: number;
};

type BalanceSnapshot = {
  timestamp: number;
  balance: number;
};

class BankingSystem {
  private accounts: Map<number, Account> = new Map();
  private nextTransactionId = 1;

  createAccount(id: number, name: string): { id: number; name: string } | null {
    if (!this.isValidAccountId(id) || name.trim().length === 0 || this.accounts.has(id)) {
      return null;
    }
    const newAccount: Account = {
      id,
      name,
      balance: 0,
      history: [],
      transactions: [],
      spentTotal: 0,
      createdAt: Date.now(),
    };
    this.accounts.set(id, newAccount);
    return { id, name };
  }

  deposit(id: number, amount: number, timestamp: number): boolean {
    if (!this.isValidAmount(amount) || !this.isValidTimestamp(timestamp)) return false;
    const account = this.accounts.get(id);
    if (!account) return false;
    if (!this.canRecordSnapshotAt(account, timestamp)) return false;

    account.balance += amount;
    this.recordSnapshot(account, timestamp);

    this.recordTransaction(account, timestamp, {
      type: "DEPOSIT",
      amount,
    });
    return true;
  }

  withdraw(id: number, amount: number, timestamp = Date.now()): number | null {
    const account = this.accounts.get(id);
    if (
      !account ||
      !this.isValidAmount(amount) ||
      !this.isValidTimestamp(timestamp) ||
      !this.canRecordSnapshotAt(account, timestamp) ||
      account.balance < amount
    ) {
      return null;
    }
    account.balance -= amount;
    account.spentTotal += amount;
    this.recordSnapshot(account, timestamp);
    this.recordTransaction(account, timestamp, {
      type: "WITHDRAW",
      amount,
    });
    return account.balance;
  }

  getBalanceAt(id: number, timestamp: number): number | null {
    const account = this.accounts.get(id);
    if (!account) return null;
    if (timestamp <= account.createdAt) return null;

    const history = account.history;
    if (history.length === 0) return 0;

    let left = 0;
    let right = history.length - 1;
    let answer: BalanceSnapshot | null = null;

    while (left <= right) {
      const mid = left + Math.floor((right - left) / 2);
      if (history[mid] && history[mid].timestamp <= timestamp) {
        answer = history[mid];
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return answer ? answer.balance : null;
  }

  transfer(
    fromAccountId: AccountId,
    toAccountId: AccountId,
    amount: number,
    timestamp: number,
  ): boolean {
    if (!this.isValidAmount(amount) || !this.isValidTimestamp(timestamp)) return false;

    const fromId = this.normalizeAccountId(fromAccountId);
    const toId = this.normalizeAccountId(toAccountId);

    if (fromId === null || toId === null || fromId === toId) return false;

    const fromAccount = this.accounts.get(fromId);
    const toAccount = this.accounts.get(toId);

    if (!fromAccount || !toAccount) return false;
    if (fromAccount.balance < amount) return false;
    if (
      !this.canRecordSnapshotAt(fromAccount, timestamp) ||
      !this.canRecordSnapshotAt(toAccount, timestamp)
    ) {
      return false;
    }

    fromAccount.balance -= amount;
    toAccount.balance += amount;

    fromAccount.spentTotal += amount;

    this.recordSnapshot(fromAccount, timestamp);
    this.recordSnapshot(toAccount, timestamp);

    this.recordTransaction(fromAccount, timestamp, {
      type: "TRANSFER_OUT",
      amount,
      counterparty: String(toId),
    });

    this.recordTransaction(toAccount, timestamp, {
      type: "TRANSFER_IN",
      amount,
      counterparty: String(fromId),
    });

    return true;
  }

  getTopSpenders(limit: number): Array<{ id: number; name: string; spentTotal: number }> {
    if (!Number.isSafeInteger(limit) || limit <= 0) return [];

    return [...this.accounts.values()]
      .sort((left, right) => right.spentTotal - left.spentTotal || left.id - right.id)
      .slice(0, limit)
      .map(({ id, name, spentTotal }) => ({ id, name, spentTotal }));
  }

  getTransactionHistory(id: number): Transaction[] {
    const account = this.accounts.get(id);
    return account ? account.transactions.map((transaction) => ({ ...transaction })) : [];
  }

  private recordSnapshot(account: Account, timestamp: number) {
    const history = account.history;
    const last = history[history.length - 1];
    if (last && last.timestamp === timestamp) {
      last.balance = account.balance;
      return;
    }

    history.push({
      timestamp,
      balance: account.balance,
    });
  }

  private canRecordSnapshotAt(account: Account, timestamp: number): boolean {
    const last = account.history[account.history.length - 1];
    return !last || timestamp >= last.timestamp;
  }

  private recordTransaction(
    account: Account,
    timestamp: number,
    input: Omit<Transaction, "id" | "timestamp" | "balanceAfter">,
  ) {
    const transaction: Transaction = {
      id: `txn-${this.nextTransactionId}`,
      ...input,
      timestamp,
      balanceAfter: account.balance,
    };
    this.nextTransactionId += 1;
    account.transactions.push(transaction);
  }

  private normalizeAccountId(id: AccountId): number | null {
    const normalized = typeof id === "number" ? id : Number(id);
    return this.isValidAccountId(normalized) ? normalized : null;
  }

  private isValidAccountId(id: number): boolean {
    return Number.isSafeInteger(id) && id > 0;
  }

  private isValidTimestamp(timestamp: number): boolean {
    return Number.isSafeInteger(timestamp) && timestamp >= 0;
  }


  private isValidAmount(amount: number): boolean {
    return typeof amount === "number" && amount > 0;
  }
}

export default BankingSystem;

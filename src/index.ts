import BankingSystem from "./banking-system.js";

const bank = new BankingSystem();

const timestamps = {
  beforeAccounts: Date.now() - 1,
  aliceDeposit: Date.now() + 1_000,
  bobDeposit: Date.now() + 2_000,
  afterWithdrawProbe: Date.now() + 3_000,
  transfer: Date.now() + 4_000,
  transferUnknownAccount: Date.now() + 5_000,
  transferSelf: Date.now() + 6_000,
  transferInsufficientFunds: Date.now() + 7_000,
  finalProbe: Date.now() + 8_000,
};

function logStep<T>(
  tag: string,
  action: string,
  input: Record<string, unknown>,
  result: T,
  expected?: T,
) {
  console.log(tag, {
    action,
    input,
    result,
    expected,
    passed: expected === undefined ? "not asserted" : Object.is(result, expected),
  });
}

function readBalance(accountId: number, timestamp: number) {
  return bank.getBalanceAt(accountId, timestamp);
}

function logBalances(tag: string, timestamp: number) {
  console.log(tag, {
    timestamp,
    balances: {
      alice: readBalance(1, timestamp),
      bob: readBalance(2, timestamp),
    },
  });
}

function logTransactionHistory(tag: string, accountId: number) {
  const history = bank.getTransactionHistory(accountId);

  console.log(tag, {
    accountId,
    transactionCount: history.length,
    transactions: history.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
      balanceAfter: transaction.balanceAfter,
      counterparty: transaction.counterparty ?? null,
    })),
  });
}

function logTransferAudit(
  tag: string,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    timestamp: number;
  },
  expected: boolean,
) {
  const before = {
    fromBalance: readBalance(Number(input.fromAccountId), input.timestamp - 1),
    toBalance: readBalance(Number(input.toAccountId), input.timestamp - 1),
  };
  const result = bank.transfer(
    input.fromAccountId,
    input.toAccountId,
    input.amount,
    input.timestamp,
  );
  const after = {
    fromBalance: readBalance(Number(input.fromAccountId), input.timestamp),
    toBalance: readBalance(Number(input.toAccountId), input.timestamp),
  };

  console.log(tag, {
    action: result ? "transfer accepted" : "transfer rejected",
    input,
    before,
    after,
    delta: {
      from: before.fromBalance === null || after.fromBalance === null
        ? null
        : after.fromBalance - before.fromBalance,
      to: before.toBalance === null || after.toBalance === null
        ? null
        : after.toBalance - before.toBalance,
    },
    expected,
    result,
    passed: Object.is(result, expected),
  });
}

console.log("\n[SETUP] Creating accounts");
logStep(
  "[SETUP][CREATE_ACCOUNT]",
  "create Alice",
  { id: 1, name: "Alice" },
  bank.createAccount(1, "Alice"),
);
logStep(
  "[SETUP][CREATE_ACCOUNT]",
  "create Bob",
  { id: 2, name: "Bob" },
  bank.createAccount(2, "Bob"),
);
logStep(
  "[EDGE][CREATE_ACCOUNT_DUPLICATE]",
  "reject duplicate Alice account",
  { id: 1, name: "Alice Clone" },
  bank.createAccount(1, "Alice Clone"),
  null,
);

console.log("\n[FLOW] Deposits");
logStep(
  "[MONEY_IN][DEPOSIT]",
  "deposit into Alice",
  { accountId: 1, amount: 100, timestamp: timestamps.aliceDeposit },
  bank.deposit(1, 100, timestamps.aliceDeposit),
  true,
);
logStep(
  "[MONEY_IN][DEPOSIT]",
  "deposit into Bob",
  { accountId: 2, amount: 200, timestamp: timestamps.bobDeposit },
  bank.deposit(2, 200, timestamps.bobDeposit),
  true,
);
logStep(
  "[EDGE][DEPOSIT_INVALID_AMOUNT]",
  "reject zero deposit",
  { accountId: 1, amount: 0, timestamp: timestamps.bobDeposit },
  bank.deposit(1, 0, timestamps.bobDeposit),
  false,
);
logStep(
  "[EDGE][DEPOSIT_UNKNOWN_ACCOUNT]",
  "reject deposit into missing account",
  { accountId: 999, amount: 50, timestamp: timestamps.bobDeposit },
  bank.deposit(999, 50, timestamps.bobDeposit),
  false,
);

console.log("\n[FLOW] Withdrawals");
logStep(
  "[MONEY_OUT][WITHDRAW]",
  "withdraw from Alice",
  { accountId: 1, amount: 30, timestamp: timestamps.afterWithdrawProbe },
  bank.withdraw(1, 30, timestamps.afterWithdrawProbe),
  70,
);
logStep(
  "[EDGE][WITHDRAW_INSUFFICIENT_FUNDS]",
  "reject overdraw from Alice",
  { accountId: 1, amount: 10_000 },
  bank.withdraw(1, 10_000),
  null,
);

console.log("\n[STATE] Historical balance probes");
logStep(
  "[STATE][BALANCE_AT_BEFORE_CREATION]",
  "Alice balance before account creation",
  { accountId: 1, timestamp: timestamps.beforeAccounts },
  bank.getBalanceAt(1, timestamps.beforeAccounts),
  null,
);
logStep(
  "[STATE][BALANCE_AT_AFTER_DEPOSIT]",
  "Alice balance after deposit snapshot",
  { accountId: 1, timestamp: timestamps.aliceDeposit },
  bank.getBalanceAt(1, timestamps.aliceDeposit),
  100,
);
logStep(
  "[STATE][BALANCE_AT_AFTER_WITHDRAW_PROBE]",
  "Alice historical balance after withdraw snapshot",
  { accountId: 1, timestamp: timestamps.afterWithdrawProbe },
  bank.getBalanceAt(1, timestamps.afterWithdrawProbe),
  70,
);

console.log("\n[FLOW] Transfers");
logBalances("[TRANSFER][BEFORE_BALANCES]", timestamps.transfer - 1);
logTransferAudit(
  "[TRANSFER][SUCCESS]",
  {
    fromAccountId: "1",
    toAccountId: "2",
    amount: 20,
    timestamp: timestamps.transfer,
  },
  true,
);
logBalances("[TRANSFER][AFTER_BALANCES]", timestamps.transfer);
logTransactionHistory("[TRANSFER][ALICE_TRANSACTIONS]", 1);
logTransactionHistory("[TRANSFER][BOB_TRANSACTIONS]", 2);
logTransferAudit(
  "[EDGE][TRANSFER_UNKNOWN_ACCOUNT]",
  {
    fromAccountId: "1",
    toAccountId: "999",
    amount: 20,
    timestamp: timestamps.transferUnknownAccount,
  },
  false,
);
logTransferAudit(
  "[EDGE][TRANSFER_SELF]",
  {
    fromAccountId: "1",
    toAccountId: "1",
    amount: 10,
    timestamp: timestamps.transferSelf,
  },
  false,
);
logTransferAudit(
  "[EDGE][TRANSFER_INSUFFICIENT_FUNDS]",
  {
    fromAccountId: "1",
    toAccountId: "2",
    amount: 10_000,
    timestamp: timestamps.transferInsufficientFunds,
  },
  false,
);

console.log("\n[FINAL_STATE] Historical balances after transfer");
logStep(
  "[FINAL_STATE][ALICE_BALANCE_AT]",
  "Alice final historical balance",
  { accountId: 1, timestamp: timestamps.finalProbe },
  bank.getBalanceAt(1, timestamps.finalProbe),
  50,
);
logStep(
  "[FINAL_STATE][BOB_BALANCE_AT]",
  "Bob final historical balance",
  { accountId: 2, timestamp: timestamps.finalProbe },
  bank.getBalanceAt(2, timestamps.finalProbe),
  220,
);
console.log("[FINAL_STATE][TOP_SPENDERS]", {
  limit: 5,
  spenders: bank.getTopSpenders(5),
});
console.log("[FINAL_STATE][AUDIT_SUMMARY]", {
  expectedBalances: {
    alice: 50,
    bob: 220,
  },
  actualBalances: {
    alice: readBalance(1, timestamps.finalProbe),
    bob: readBalance(2, timestamps.finalProbe),
  },
  transactionCounts: {
    alice: bank.getTransactionHistory(1).length,
    bob: bank.getTransactionHistory(2).length,
  },
  topSpenders: bank.getTopSpenders(2),
});

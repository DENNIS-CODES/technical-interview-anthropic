import { describe, expect, it } from "vitest";
import BankingSystem from "./bankingSystem.js";

describe("BankingSystem", () => {
  it("creates accounts and rejects duplicate account ids", () => {
    const bank = new BankingSystem();

    expect(bank.createAccount(1, "Alice")).toEqual({ id: 1, name: "Alice" });
    expect(bank.createAccount(2, "Bob")).toEqual({ id: 2, name: "Bob" });
    expect(bank.createAccount(1, "Alice Clone")).toBeNull();
    expect(bank.createAccount(0, "Invalid")).toBeNull();
    expect(bank.createAccount(3, "")).toBeNull();
  });

  it("deposits and withdraws money from an existing account", () => {
    const bank = new BankingSystem();
    const depositTime = Date.now() + 1_000;
    const firstWithdrawTime = Date.now() + 2_000;
    const secondWithdrawTime = Date.now() + 3_000;

    bank.createAccount(1, "Alice");

    expect(bank.deposit(1, 100, depositTime)).toBe(true);
    expect(bank.withdraw(1, 30, firstWithdrawTime)).toBe(70);
    expect(bank.withdraw(1, 70, secondWithdrawTime)).toBe(0);
    expect(bank.getBalanceAt(1, firstWithdrawTime)).toBe(70);
    expect(bank.getBalanceAt(1, secondWithdrawTime)).toBe(0);
  });

  it("rejects invalid deposits and withdrawals", () => {
    const bank = new BankingSystem();
    const depositTime = Date.now() + 1_000;

    bank.createAccount(1, "Alice");

    expect(bank.deposit(1, 0, depositTime)).toBe(false);
    expect(bank.deposit(1, -50, depositTime)).toBe(false);
    expect(bank.deposit(1, 10.5, depositTime)).toBe(false);
    expect(bank.deposit(1, Number.NaN, depositTime)).toBe(false);
    expect(bank.deposit(999, 50, depositTime)).toBe(false);
    expect(bank.withdraw(1, 1)).toBeNull();
    expect(bank.withdraw(1, 0)).toBeNull();
    expect(bank.withdraw(1, 1.5)).toBeNull();
    expect(bank.withdraw(999, 1)).toBeNull();
  });

  it("transfers money between accounts and updates historical balances", () => {
    const bank = new BankingSystem();
    const aliceDepositTime = Date.now() + 1_000;
    const bobDepositTime = Date.now() + 2_000;
    const transferTime = Date.now() + 3_000;
    const finalProbeTime = Date.now() + 4_000;

    bank.createAccount(1, "Alice");
    bank.createAccount(2, "Bob");

    expect(bank.deposit(1, 100, aliceDepositTime)).toBe(true);
    expect(bank.deposit(2, 200, bobDepositTime)).toBe(true);
    expect(bank.transfer(1, 2, 40, transferTime)).toBe(true);

    expect(bank.getBalanceAt(1, aliceDepositTime)).toBe(100);
    expect(bank.getBalanceAt(2, bobDepositTime)).toBe(200);
    expect(bank.getBalanceAt(1, finalProbeTime)).toBe(60);
    expect(bank.getBalanceAt(2, finalProbeTime)).toBe(240);
  });

  it("rejects invalid transfers", () => {
    const bank = new BankingSystem();
    const depositTime = Date.now() + 1_000;
    const transferTime = Date.now() + 2_000;

    bank.createAccount(1, "Alice");
    bank.createAccount(2, "Bob");
    bank.deposit(1, 50, depositTime);

    expect(bank.transfer("1", "2", 0, transferTime)).toBe(false);
    expect(bank.transfer("1", "2", 10.5, transferTime)).toBe(false);
    expect(bank.transfer("1", "2", 100, transferTime)).toBe(false);
    expect(bank.transfer("1", "1", 10, transferTime)).toBe(false);
    expect(bank.transfer("abc", "2", 10, transferTime)).toBe(false);
    expect(bank.transfer("1", "999", 10, transferTime)).toBe(false);
    expect(bank.transfer("999", "2", 10, transferTime)).toBe(false);
  });

  it("returns null when asking for an unknown account balance", () => {
    const bank = new BankingSystem();

    expect(bank.getBalanceAt(999, Date.now() + 1_000)).toBeNull();
  });

  it("rejects stale operation timestamps to keep historical lookup monotonic", () => {
    const bank = new BankingSystem();
    const firstTime = Date.now() + 1_000;
    const secondTime = Date.now() + 2_000;

    bank.createAccount(1, "Alice");

    expect(bank.deposit(1, 100, secondTime)).toBe(true);
    expect(bank.deposit(1, 50, firstTime)).toBe(false);
    expect(bank.withdraw(1, 25, firstTime)).toBeNull();

    expect(bank.getBalanceAt(1, secondTime)).toBe(100);
  });

  it("ranks top spenders by money moved out, then by account id", () => {
    const bank = new BankingSystem();
    const depositTime = Date.now() + 1_000;
    const aliceWithdrawTime = Date.now() + 2_000;
    const bobWithdrawTime = Date.now() + 3_000;
    const transferTime = Date.now() + 4_000;

    bank.createAccount(1, "Alice");
    bank.createAccount(2, "Bob");
    bank.createAccount(3, "Chloe");

    bank.deposit(1, 500, depositTime);
    bank.deposit(2, 500, depositTime);
    bank.deposit(3, 500, depositTime);
    bank.withdraw(1, 100, aliceWithdrawTime);
    bank.withdraw(2, 100, bobWithdrawTime);
    bank.transfer(3, 1, 150, transferTime);

    expect(bank.getTopSpenders(2)).toEqual([
      { id: 3, name: "Chloe", spentTotal: 150 },
      { id: 1, name: "Alice", spentTotal: 100 },
    ]);
  });

  it("returns defensive copies of transaction history", () => {
    const bank = new BankingSystem();
    const depositTime = Date.now() + 1_000;

    bank.createAccount(1, "Alice");
    bank.deposit(1, 100, depositTime);

    const history = bank.getTransactionHistory(1);
    history[0]!.amount = 999;

    expect(bank.getTransactionHistory(1)[0]).toMatchObject({
      id: "txn-1",
      type: "DEPOSIT",
      amount: 100,
      timestamp: depositTime,
      balanceAfter: 100,
    });
  });
});

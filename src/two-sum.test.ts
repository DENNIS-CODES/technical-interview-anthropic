import { describe, expect, it } from "vitest";
import { twoSum } from "./two-sum.js";

describe("twoSum", () => {
  it("returns the indices of the first pair that reaches the target", () => {
    expect(twoSum([2, 7, 11, 15], 9)).toEqual([0, 1]);
  });

  it("works when the matching values are repeated", () => {
    expect(twoSum([3, 3], 6)).toEqual([0, 1]);
  });

  it("returns null when no pair exists", () => {
    expect(twoSum([1, 2, 4], 8)).toBeNull();
  });
});
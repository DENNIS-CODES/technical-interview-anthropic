export function twoSum(nums: readonly number[], target: number): [number, number] | null {
  const seen = new Map<number, number>();

  for (let index = 0; index < nums.length; index += 1) {
    const current = nums[index]!;
    const complement = target - current;
    const match = seen.get(complement);

    if (match !== undefined) {
      return [match, index];
    }

    seen.set(current, index);
  }

  return null;
}
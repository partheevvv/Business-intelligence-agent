export function formatINR(n: number): string {
  // No decimals for exec summary; change if you need paise.
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
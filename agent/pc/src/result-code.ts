/** Operator result codes A–E. Pure helper for tests. */

export type ResultCode = "A" | "B" | "C" | "D" | "E";

export function classifyAgentError(message: string): Exclude<ResultCode, "A" | "B"> {
  if (message.startsWith("CAPTCHA_DETECTED")) return "C";
  if (message.startsWith("OPENBELL_") || /unauthorized/i.test(message) || message.includes("OPENBELL")) {
    return "E";
  }
  return "D";
}

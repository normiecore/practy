/** One input problem, located by its path in the command input (e.g. "specialDamages.0.amountCents"). */
export interface InputIssue {
  path: string;
  message: string;
}

export class PractyError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid" | "conflict",
    message: string,
    readonly issues?: InputIssue[],
  ) {
    super(message);
    this.name = "PractyError";
  }
}

export const notFound = (what: string) => new PractyError("not_found", `${what} not found`);
export const forbidden = (why: string) => new PractyError("forbidden", why);
export const invalid = (why: string, issues?: InputIssue[]) => new PractyError("invalid", why, issues);
export const conflict = (why: string) => new PractyError("conflict", why);

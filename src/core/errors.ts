export class PractyError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PractyError";
  }
}

export const notFound = (what: string) => new PractyError("not_found", `${what} not found`);
export const forbidden = (why: string) => new PractyError("forbidden", why);
export const invalid = (why: string) => new PractyError("invalid", why);
export const conflict = (why: string) => new PractyError("conflict", why);

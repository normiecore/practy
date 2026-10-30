/** Shared test fixtures: every test fails on an uncaught page error or an unexpected 5xx from the server. */
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export { ADMIN_EMAIL, AUTH_STATE } from "./constants";

export const test = base.extend<{ failOnErrors: void }>({
  failOnErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
      page.on("response", (res) => {
        if (res.status() >= 500) problems.push(`${res.status()} from ${res.request().method()} ${res.url()}`);
      });
      await use();
      expect(problems, "page errors and server errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

let seq = 0;
/** A matter number no other test (or retry) uses on the shared in-memory server. */
export const matterNumber = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${process.pid}-${++seq}`.toUpperCase();

const word = () =>
  Array.from({ length: 9 }, (_, i) => String.fromCharCode((i ? 97 : 65) + Math.floor(Math.random() * 26))).join("");
/** A client name unlikely to match any other test's parties in the conflict search. */
export const clientName = () => `${word()} ${word()}`;

export interface NewMatter {
  number: string;
  title: string;
  client: string;
  clientDateOfBirth?: string;
  scheme?: string;
  injuryDate?: string;
}

/** Opens a matter through the Matters page dialog, the way a practitioner would. */
export async function openMatterInApp(page: Page, m: NewMatter) {
  await page.goto("/#/matters");
  await page.getByRole("button", { name: "Open a matter" }).click();
  const dialog = page.getByRole("dialog", { name: "Open a matter" });
  await dialog.getByRole("textbox", { name: "Number", exact: true }).fill(m.number);
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill(m.title);
  await dialog.getByRole("combobox", { name: "Scheme" }).selectOption(m.scheme ?? "icwa_mva");
  if (m.injuryDate) await dialog.getByLabel("Injury Date").fill(m.injuryDate);
  await dialog.getByRole("group", { name: "Client" }).getByRole("textbox", { name: "Name", exact: true }).fill(m.client);
  await dialog.getByRole("button", { name: "Open matter" }).click();
  return dialog;
}

/** Runs a command through the REST API as the signed-in user, as the web app does. */
export async function runCommand<T = any>(request: APIRequestContext, name: string, input: unknown): Promise<T> {
  const session = await request.get("/api/session");
  expect(session.ok()).toBe(true);
  const { csrf } = (await session.json()) as { csrf: string };
  const res = await request.post(`/api/commands/${name}`, { data: input, headers: { "x-practy-csrf": csrf } });
  const body = await res.json();
  expect(res.ok(), `${name}: ${JSON.stringify(body)}`).toBe(true);
  expect(body.status).toBe("executed");
  return body.result as T;
}

/** Opens a matter through the API, for tests about later screens. */
export async function createMatter(request: APIRequestContext, m: NewMatter): Promise<{ id: string }> {
  const out = await runCommand<{ matter: { id: string } }>(request, "create_matter", {
    number: m.number,
    title: m.title,
    scheme: m.scheme ?? "icwa_mva",
    ...(m.injuryDate ? { injuryDate: m.injuryDate } : {}),
    client: { name: m.client, ...(m.clientDateOfBirth ? { dateOfBirth: m.clientDateOfBirth } : {}) },
  });
  return out.matter;
}

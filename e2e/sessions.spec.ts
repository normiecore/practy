/** Sign-in sessions: ending a lost phone's session from another device, and a principal signing someone out everywhere. */
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

/**
 * A new staff member, added and approved by the shared principal. Tests here sign in as their own
 * user, never as the principal, so ending sessions cannot sign out the session every other test uses.
 */
async function addStaff(request: APIRequestContext, name: string): Promise<{ email: string; name: string }> {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { csrf } = (await (await request.get("/api/session")).json()) as { csrf: string };
  const post = async (command: string, data: unknown) => (await request.post(`/api/commands/${command}`, { data, headers: { "x-practy-csrf": csrf } })).json();
  const asked = await post("upsert_user", { email, displayName: name, roles: ["solicitor"] });
  expect(asked.status).toBe("pending_approval");
  const decided = await post("decide_approval", { approvalId: asked.approvalId, decision: "approve" });
  expect(decided.result.status).toBe("executed");
  return { email, name };
}

/** Signs in through the development sign-in in a fresh browser (no shared cookies), as a separate device would. */
async function signInOnDevice(browser: Browser, baseURL: string, staff: { email: string; name: string }, userAgent?: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, ...(userAgent ? { userAgent } : {}) });
  const page = await context.newPage();
  await page.goto("/auth/login/dev");
  await page.getByLabel("Email").fill(staff.email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText(staff.name);
  return page;
}

/** The device's next request, from moving to another page, finds it signed out and sends it to sign in. */
async function expectSignedOut(device: Page) {
  await device.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Matters" }).click();
  await expect(device).toHaveURL(/\/auth\/login/);
  await expect(device.getByRole("heading", { name: "Sign in to Practy" })).toBeVisible();
}

test("a user ends a lost phone's session from their computer, then signs out all other devices", async ({ browser, baseURL, request }) => {
  const staff = await addStaff(request, "Session Tester");
  const computer = await signInOnDevice(browser, baseURL!, staff);
  const phone = await signInOnDevice(browser, baseURL!, staff, IPHONE);
  const laptop = await signInOnDevice(browser, baseURL!, staff, FIREFOX_LINUX);

  await computer.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await computer.getByRole("tab", { name: "Sign-in sessions" }).click();
  await expect(computer).toHaveURL(/#\/settings\/sessions$/);
  const rows = computer.getByRole("main").getByRole("row");
  const thisDevice = rows.filter({ hasText: "This device" });
  await expect(thisDevice).toHaveCount(1);
  // The current session has no End button: ending it is the normal Sign out.
  await expect(thisDevice.getByRole("button")).toHaveCount(0);
  await expect(thisDevice).toContainText("To end this one, use Sign out.");
  const phoneRow = rows.filter({ hasText: "Safari on iPhone" });
  await expect(phoneRow).toHaveCount(1);
  await expect(phoneRow).toContainText(/\d+\.\d+\.\d+\.0\/24|::\/48/);

  await phoneRow.getByRole("button", { name: "End session on Safari on iPhone" }).click();
  await expect(computer.getByRole("status")).toContainText("Session ended");
  await expect(phoneRow).toHaveCount(0);
  await expectSignedOut(phone);

  // The laptop is still signed in until the computer signs out all other devices.
  await expect(rows.filter({ hasText: "Firefox on Linux" })).toHaveCount(1);
  await computer.getByRole("button", { name: "Sign out all other devices" }).click();
  await expect(computer.getByRole("status")).toContainText("Signed out 1 other device");
  await expect(rows.filter({ hasText: "Firefox on Linux" })).toHaveCount(0);
  await expect(computer.getByRole("button", { name: "Sign out all other devices" })).toBeDisabled();
  await expectSignedOut(laptop);

  // The computer itself stays signed in.
  await computer.reload();
  await expect(computer.getByRole("main").getByRole("row").filter({ hasText: "This device" })).toHaveCount(1);
  await Promise.all([computer, phone, laptop].map((p) => p.context().close()));
});

test("a principal signs a staff member out everywhere from the Users tab", async ({ page, browser, baseURL, request }) => {
  const staff = await addStaff(request, "Leaving Staffer");
  const phone = await signInOnDevice(browser, baseURL!, staff, IPHONE);

  await page.goto("/#/settings/users");
  const row = page.getByRole("main").getByRole("row").filter({ hasText: staff.email });
  await row.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page.getByRole("status")).toContainText(`Signed ${staff.name} out everywhere: 1 session ended`);
  await expectSignedOut(phone);
  // A principal does not sign themselves out from this list.
  const me = (await (await request.get("/api/session")).json()) as { user: { email: string } };
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: me.user.email }).getByRole("button")).toHaveCount(0);
  await phone.context().close();
});

/** Signs in once through the development sign-in and saves the session for the other tests. */
import { ADMIN_EMAIL, AUTH_STATE, expect, test } from "./fixtures";

test("signs in with the development sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/login/);
  await page.goto("/auth/login/dev");
  await expect(page.getByRole("heading", { name: "Development sign-in" })).toBeVisible();
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText(ADMIN_EMAIL);
  await page.context().storageState({ path: AUTH_STATE });
});

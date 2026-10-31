import { describe, expect, it } from "vitest";
import { defaultSettings, settingsFor, tenantSettingsSchema } from "../src/admin/settings.js";
import { as, setup, TENANT, users } from "./helpers.js";

describe("firm settings", () => {
  it("accepts the defaults", () => {
    expect(tenantSettingsSchema.safeParse(defaultSettings(TENANT)).success).toBe(true);
  });

  it("applies a valid change once a principal approves it", async () => {
    const { app, run, exec } = setup();
    const req = await run("update_settings", { patch: { firmAddress: "1 Hay St, Perth WA 6000", mail: { autoFileCap: 40 } } }, as(users.principal));
    expect(req.status).toBe("pending_approval");
    if (req.status !== "pending_approval") throw new Error();
    expect(settingsFor(app.store, TENANT).mail.autoFileCap).toBe(60);
    await exec("decide_approval", { approvalId: req.approvalId, decision: "approve" }, as(users.principal));
    const s = settingsFor(app.store, TENANT);
    expect(s).toMatchObject({ firmAddress: "1 Hay St, Perth WA 6000", mail: { autoFileCap: 40, filingMode: "off" } });
  });

  it("refuses a wrong type or a misspelt key before it reaches the approvals inbox, naming the field", async () => {
    const { run, exec } = setup();
    const refused = run("update_settings", { patch: { mail: { autoFileCap: "sixty", autofile: true }, timezone: "Perth" } }, as(users.principal));
    await expect(refused).rejects.toMatchObject({ code: "invalid" });
    const err = await refused.catch((e) => e);
    expect(err.issues.map((i: { path: string }) => i.path).sort()).toEqual(["patch.mail", "patch.mail.autoFileCap", "patch.timezone"]);
    expect(await exec("list_approvals", { status: "pending" }, as(users.principal))).toEqual([]);
    // The id and tenant cannot be changed through a patch.
    const req = await run("update_settings", { patch: { tenantId: "t-other", id: "t-other" } }, as(users.principal));
    expect(req.status).toBe("pending_approval");
  });
});

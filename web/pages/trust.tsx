import { FormButton } from "./matter";
import { Loading, useAct, useLoad, Value } from "../ui";

export function Trust() {
  const integrations = useLoad<{ trust: { source: string; configured: boolean } }>("list_integrations", {});
  const recs = useLoad<{ id: string; status?: string; signedOffBy?: string }[]>("list_trust_reconciliations", {});
  const act = useAct();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trust</h1>
          <p className="muted">
            Shadow ledger. The firm's trust records ({integrations.data?.trust.source ?? "…"}) stay the record of truth during the pilot; Practy reconciles against them.
          </p>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => void act("sync_trust_records", {}, "Trust records synced")}>
            Sync records
          </button>
          <FormButton label="Upload cashbook export" secondary name="upload_trust_export" />
          <FormButton label="Prepare reconciliation" name="prepare_trust_reconciliation" />
        </div>
      </div>
      {integrations.data && !integrations.data.trust.configured && (
        <div className="notice warn">No trust source is configured. Connect Xero or set a cashbook source in Settings → Integrations.</div>
      )}
      <h2>Reconciliations</h2>
      <Loading state={recs}>
        {() => (
          <>
            <Value value={recs.data} />
            <div className="row" style={{ marginTop: "0.5rem" }}>
              {recs.data!
                .filter((r) => !r.signedOffBy)
                .map((r) => (
                  <button key={r.id} className="secondary" onClick={() => void act("sign_off_trust_reconciliation", { reconciliationId: r.id })}>
                    Sign off {r.id.slice(0, 8)}
                  </button>
                ))}
            </div>
          </>
        )}
      </Loading>
      <p className="muted small">Matter balances and payment requests are on each matter's Trust tab.</p>
    </>
  );
}

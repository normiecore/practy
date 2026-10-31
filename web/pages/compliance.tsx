import type { ReactNode } from "react";
import { FormButton, SectionTabs } from "./matter";
import { href, Loading, useLoad, Value } from "../ui";

const TABS: [string, string][] = [
  ["privacy", "Privacy requests"],
  ["breaches", "Data breaches"],
  ["adm", "Automated decisions"],
  ["aml", "AML/CTF"],
  ["retention", "Retention"],
  ["ai", "AI use log"],
];

export function Compliance({ tab = "privacy" }: { tab?: string }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compliance</h1>
          <p className="muted">Privacy Act requests and breaches, automated decision register, AML/CTF screening, retention and the AI use log.</p>
        </div>
      </div>
      <SectionTabs tabs={TABS} current={tab} onSelect={(k) => (location.hash = href("compliance", k))} />
      {tab === "privacy" && (
        <Panel list="list_privacy_requests" input={{ openOnly: false }} intro="Access and correction requests under APPs 12 and 13. Respond within 30 days.">
          <FormButton label="Log request" name="log_privacy_request" />
          <FormButton label="Close request" secondary name="close_privacy_request" />
        </Panel>
      )}
      {tab === "breaches" && (
        <Panel list="list_breaches" intro="Notifiable Data Breaches: assess within 30 days. Ransomware payments must be reported within 72 hours.">
          <FormButton label="Report breach" name="report_breach" />
          <FormButton label="Assess" secondary name="assess_breach" />
          <FormButton label="Record notification" secondary name="record_breach_notification" />
          <FormButton label="Ransomware payment" secondary name="record_ransomware_payment" />
        </Panel>
      )}
      {tab === "adm" && (
        <>
          <Panel list="list_adm_register" intro="Systems that make or substantially assist decisions using personal information.">
            <FormButton label="Add or change entry" name="upsert_adm_entry" />
          </Panel>
          <Panel list="privacy_policy_adm_clause" title="Privacy policy clause" />
        </>
      )}
      {tab === "aml" && <Panel list="aml_status" intro="Matters screened for designated services at intake. Screen a matter from its Overview tab." />}
      {tab === "retention" && <Panel list="retention_report" intro="Closed matters due for destruction review. Matters on legal hold are excluded." />}
      {tab === "ai" && <Panel list="export_ai_use_log" intro="Every AI run: who, what, which model and which documents." />}
    </>
  );
}

function Panel({ list, input = {}, intro, title, children }: { list: string; input?: object; intro?: string; title?: string; children?: ReactNode }) {
  const data = useLoad(list, input);
  return (
    <section className="stack">
      {title && <h2>{title}</h2>}
      {intro && <p className="muted small">{intro}</p>}
      {children && <div className="row">{children}</div>}
      <Loading state={data}>{() => <Value value={data.data} />}</Loading>
    </section>
  );
}

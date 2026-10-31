import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { usersOf } from "../admin/commands.js";
import type { User } from "../auth/model.js";
import { DevOidcProvider } from "../auth/oidc.js";
import { actorFor, AuthService } from "../auth/service.js";
import type { Approval } from "../core/approvals.js";
import { addDays, addMonths, type IsoDate } from "../core/calendar.js";
import { MemoryPersistence } from "../core/persistence.js";
import type { InvocationContext, Role } from "../core/types.js";
import type { TimeEntry } from "../costs/time.js";
import type { MatterDocument } from "../documents/model.js";
import type { KeyDate, Matter } from "../domain/model.js";
import type { EvidenceRequest } from "../work/commands.js";
import { createApp, type App } from "./app.js";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";

/**
 * Sample data for previews (`npm run demo`): a fictional WA plaintiff personal injury firm.
 *
 * Everything after the first principal is entered through the command bus as the firm's staff
 * would enter it in the app, including the approval inbox, so the records pass the same rules as
 * real use. Dates are relative to today so the demo always looks current. No network, AI model,
 * Box, Gmail or Xero is needed: documents go to a throwaway local folder.
 *
 * Every name, address, phone number and reference here is invented. Never point this at a real
 * firm's data: it refuses production, a DATABASE_URL, a durable store and a firm that has data.
 */

export const DEMO_FIRM_NAME = "Example Law (sample data)";

export const DEMO_STAFF = {
  principal: { email: "principal@example.com", displayName: "Alex Demo", roles: ["principal", "trust_authoriser"], feeEarnerCategory: "SP" },
  solicitor: { email: "solicitor@example.com", displayName: "Sam Demo", roles: ["solicitor"], feeEarnerCategory: "JP" },
  paralegal: { email: "paralegal@example.com", displayName: "Jordan Demo", roles: ["paralegal"], feeEarnerCategory: "CPL" },
} as const satisfies Record<string, { email: string; displayName: string; roles: readonly Role[]; feeEarnerCategory: "SP" | "JP" | "CPL" }>;

type Staff = keyof typeof DEMO_STAFF;

/** Why the demo must not run in this environment, or undefined when it may. */
export function demoRefusal(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV === "production") return "The demo never runs in production (NODE_ENV=production).";
  if (env.DATABASE_URL?.trim()) return "The demo keeps its sample data in memory and never seeds a real database: unset DATABASE_URL to run it.";
  return undefined;
}

export interface DemoSummary {
  tenantId: string;
  firmName: string;
  /** The principal to sign in as. */
  signInEmail: string;
  staff: { email: string; displayName: string; roles: Role[] }[];
  matters: { id: string; number: string; title: string }[];
  pendingApprovals: number;
}

/** Runs commands as the demo staff on the app's own surface, the way they would in the web app. */
class Seeder {
  readonly users = {} as Record<Staff, User>;

  constructor(private readonly app: App) {}

  private ctx(who: Staff): InvocationContext {
    return { actor: actorFor(this.users[who]), surface: "ui" };
  }

  async run<T = unknown>(who: Staff, name: string, input: unknown): Promise<T> {
    const out = await this.app.bus.execute(name, input, this.ctx(who));
    if (out.status !== "executed") throw new Error(`Demo data: ${name} was not executed (${out.status})`);
    return out.result as T;
  }

  /** A tier 2 request, left in the approval inbox. */
  async request(who: Staff, name: string, input: unknown): Promise<string> {
    const out = await this.app.bus.execute(name, input, this.ctx(who));
    if (out.status !== "pending_approval") throw new Error(`Demo data: ${name} did not go to the approval inbox`);
    return out.approvalId;
  }

  /** A tier 2 request decided in the approval inbox, as a practitioner would. */
  async approved<T = unknown>(requester: Staff, approver: Staff, name: string, input: unknown): Promise<T> {
    const approvalId = await this.request(requester, name, input);
    const decided = await this.run<Approval>(approver, "decide_approval", { approvalId, decision: "approve" });
    if (decided.status !== "executed") throw new Error(`Demo data: approving ${name} ended ${decided.status}${decided.error ? `: ${decided.error}` : ""}`);
    return decided.result as T;
  }
}

/** A small one-page PDF, marked as fictional, standing in for a document on the matter file. */
async function samplePdf(title: string, lines: string[]): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("Practy demo");
  pdf.setSubject("Fictional sample document");
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("SAMPLE DOCUMENT: FICTIONAL DATA FOR THE PRACTY DEMO", { x: 50, y: 790, size: 10, font: bold, color: rgb(0.7, 0.1, 0.1) });
  page.drawText(title, { x: 50, y: 760, size: 11, font: bold, maxWidth: 495, lineHeight: 15 });
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 715 - i * 18, size: 11, font, maxWidth: 495 }));
  return Buffer.from(await pdf.save()).toString("base64");
}

const ruleDate = (keyDates: KeyDate[], ruleId: string): KeyDate => {
  const kd = keyDates.find((k) => k.ruleId === ruleId);
  if (!kd) throw new Error(`Demo data: no ${ruleId} key date was proposed`);
  return kd;
};

/**
 * Seeds the sample firm into a fresh, in-memory app. Returns who to sign in as and what was made.
 * Throws (and seeds nothing) in production, with DATABASE_URL set, on a durable store, or when the
 * firm already has users or matters.
 */
export async function seedDemo(app: App, opts: { tenantId?: string; env?: NodeJS.ProcessEnv } = {}): Promise<DemoSummary> {
  const refusal = demoRefusal(opts.env ?? process.env);
  if (refusal) throw new Error(refusal);
  if (!(app.store.queue.persistence instanceof MemoryPersistence)) throw new Error("The demo only seeds an in-memory store, never a database.");
  const tenantId = opts.tenantId ?? "default";
  if (usersOf(app.store).list(tenantId).length || app.store.mattersFor(tenantId).length) {
    throw new Error(`The firm "${tenantId}" already has users or matters; the demo only seeds an empty firm.`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const day = (n: number): IsoDate => addDays(today, n);
  const monthsAgo = (n: number): IsoDate => addMonths(today, -n).date;
  /** A time on that day in the firm's working hours (Perth is UTC+8). */
  const at = (n: number, hourUtc = 2) => `${day(n)}T${String(hourUtc).padStart(2, "0")}:30:00Z`;
  const s = new Seeder(app);

  // ---------------------------------------------------------------- staff and settings
  // The first principal is created directly, as `npm start` does on first run; everyone else goes
  // through the approval inbox like any other new user.
  const p = DEMO_STAFF.principal;
  s.users.principal = usersOf(app.store).set({
    id: randomUUID(),
    tenantId,
    email: p.email,
    displayName: p.displayName,
    roles: [...p.roles],
    feeEarnerCategory: p.feeEarnerCategory,
    active: true,
    createdAt: new Date().toISOString(),
  });
  for (const who of ["solicitor", "paralegal"] as const) {
    const u = DEMO_STAFF[who];
    s.users[who] = await s.approved<User>("principal", "principal", "upsert_user", {
      email: u.email,
      displayName: u.displayName,
      roles: [...u.roles],
      feeEarnerCategory: u.feeEarnerCategory,
    });
  }
  await s.approved("principal", "principal", "update_settings", {
    patch: {
      firmName: DEMO_FIRM_NAME,
      firmAddress: "Level 1, 1 Example Street, Sampletown WA",
      privacy: { officerName: p.displayName, officerEmail: "privacy@example.com" },
      letter: { senderName: p.displayName, senderTitle: "Principal", senderEmail: p.email, senderPhone: "08 5550 0100" },
    },
  });

  /** Uploads a sample PDF named by the firm's naming convention. */
  const document = async (who: Staff, matterId: string, spec: Record<string, unknown> & { date: IsoDate }, subfolder: string, lines: string[]) => {
    const { name } = await s.run<{ name: string }>(who, "suggest_document_name", { spec });
    return s.run<MatterDocument>(who, "upload_document", {
      matterId,
      name: `${name}.pdf`,
      base64: await samplePdf(name, lines),
      contentType: "application/pdf",
      subfolder,
      docDate: spec.date,
      category: subfolder,
    });
  };
  const confirm = (requester: Staff, approver: Staff, matterId: string, kd: KeyDate) =>
    s.approved<KeyDate>(requester, approver, "confirm_key_date", { matterId, keyDateId: kd.id });
  const open = (who: Staff, input: Record<string, unknown>) => s.run<{ matter: Matter; keyDates: KeyDate[] }>(who, "create_matter", input);

  // ---------------------------------------------------------------- 1. ICWA, early stage
  const m1 = await open("solicitor", {
    number: "DEMO-1001",
    title: "Sample v Example Insurer",
    scheme: "icwa_mva",
    injuryDate: monthsAgo(8),
    client: { name: "Riley Sample", dateOfBirth: "1988-04-12", email: "riley.sample@example.com", phone: "0491 570 156", address: "12 Sample Street, Exampleton WA" },
    otherParties: [
      { name: "Example Insurer Pty Ltd", role: "insurer", kind: "organisation", email: "claims@example.net" },
      { name: "Morgan Otherdriver", role: "driver", kind: "person" },
    ],
    references: ["EXI-CLM-10001"],
  });
  const m1Id = m1.matter.id;
  // Established matters have every rule date confirmed (limitation, its reminders and the notice).
  for (const kd of m1.keyDates) await confirm("solicitor", "principal", m1Id, kd);
  await s.run("solicitor", "add_file_note", {
    matterId: m1Id,
    kind: "attendance",
    occurredAt: at(-30),
    minutes: 75,
    text: "Initial conference. Client was stopped at lights when struck from behind. Neck and lower back pain since; seen at Example Hospital ED the same day. Off work for three weeks, now on light duties.",
  });
  await s.run("paralegal", "add_file_note", {
    matterId: m1Id,
    kind: "phone",
    occurredAt: at(-5, 3),
    minutes: 6,
    text: "Called Example Hospital medical records. Request received and being processed; they expect to send the records within two weeks.",
  });
  await s.run("paralegal", "log_evidence_request", {
    matterId: m1Id,
    kind: "medical_records",
    provider: "Example Hospital",
    providerEmail: "records@example.org",
    description: "ED and outpatient records",
    requestedOn: day(-20),
  });
  await s.run("paralegal", "log_evidence_request", {
    matterId: m1Id,
    kind: "police_report",
    provider: "Sample Police Records Office",
    description: "Crash report",
    requestedOn: day(-35),
  });
  await s.run("paralegal", "create_task", { matterId: m1Id, title: "Send the client's signed medical authority to the GP", dueOn: day(1) });
  await document("paralegal", m1Id, { kind: "email", direction: "received", externalParty: "Example Insurer", re: "claim acknowledgement", date: day(-5) }, "Emails", [
    "From: claims@example.net",
    "We acknowledge the claim for Riley Sample and have allocated claim number EXI-CLM-10001.",
  ]);

  // ---------------------------------------------------------------- 2. ICWA, settling (damages and Authority to Settle)
  const m2Injury = monthsAgo(28);
  const m2 = await open("solicitor", {
    number: "DEMO-1002",
    title: "Specimen v Example Insurer",
    scheme: "icwa_mva",
    injuryDate: m2Injury,
    client: { name: "Morgan Specimen", dateOfBirth: "1979-09-23", email: "morgan.specimen@example.com", phone: "0491 570 157", address: "4 Placeholder Road, Sampletown WA" },
    otherParties: [
      { name: "Example Insurer Pty Ltd", role: "insurer", kind: "organisation", email: "claims@example.net" },
      { name: "Chris Otherdriver", role: "driver", kind: "person" },
      { name: "Pat Witness", role: "witness", kind: "person" },
    ],
    references: ["EXI-CLM-10002"],
  });
  const m2Id = m2.matter.id;
  for (const kd of m2.keyDates) await confirm("solicitor", "principal", m2Id, kd);
  const nopbIssued = day(-172);
  await s.run("paralegal", "record_clearance", { matterId: m2Id, kind: "medicare", event: { type: "requested", date: day(-190), reference: "MCR-DEMO-0002" } });
  await s.run("paralegal", "record_clearance", { matterId: m2Id, kind: "medicare", event: { type: "nopb_received", issueDate: nopbIssued, pastBenefitsCents: 412_350 } });
  const [nopbExpiry] = await s.run<KeyDate[]>("paralegal", "record_matter_event", { matterId: m2Id, event: { type: "nopb_received", issueDate: nopbIssued } });
  if (nopbExpiry) await confirm("paralegal", "principal", m2Id, nopbExpiry);
  const conference = await s.run<KeyDate>("solicitor", "propose_key_date", { matterId: m2Id, title: "Settlement conference with Example Insurer", date: day(12), kind: "reminder", note: "By video; client to attend." });
  await confirm("solicitor", "principal", m2Id, conference);
  await s.run("solicitor", "log_evidence_request", {
    matterId: m2Id,
    kind: "medical_report",
    provider: "Example Orthopaedics",
    providerEmail: "reports@example.org",
    description: "Independent medical examination report",
    requestedOn: day(-60),
  });
  const ime = await document("solicitor", m2Id, { kind: "ime", author: "Dr Quinn Example", profession: "Orthopaedic Surgeon", practice: "Example Orthopaedics", sierNumber: "12", date: day(-40) }, "Medical Reports", [
    "Examined Morgan Specimen. Persisting right shoulder and neck symptoms following the collision.",
    "Partial capacity for her pre-injury retail work. Ongoing GP review and physiotherapy recommended.",
  ]);
  const imeRequest = (await s.run<EvidenceRequest[]>("solicitor", "list_evidence_requests", { matterId: m2Id })).find((r) => r.provider === "Example Orthopaedics");
  if (imeRequest) await s.run("solicitor", "mark_evidence_received", { matterId: m2Id, requestId: imeRequest.id, documentId: ime.id, invoiceCents: 165_000, receivedOn: day(-40) });
  await s.run("paralegal", "log_evidence_request", { matterId: m2Id, kind: "medical_records", provider: "Sample Physio Clinic", description: "Updated treatment notes", requestedOn: day(-10) });
  await document("paralegal", m2Id, { kind: "invoice", service: "Physiotherapy", practice: "Sample Physio Clinic", amountCents: 16_500, date: day(-60) }, "Tax Documents", [
    "Physiotherapy consultation for Morgan Specimen: $165.00",
  ]);
  await document("solicitor", m2Id, { kind: "email", direction: "received", externalParty: "Example Insurer", re: "offer of settlement", date: day(-6) }, "Emails", [
    "From: claims@example.net",
    "Our client offers $82,500 plus costs and disbursements in full settlement of the claim.",
  ]);
  await s.run("solicitor", "compute_damages", {
    matterId: m2Id,
    plaintiff: { sex: "female", background: "retail work background" },
    calculationDate: today,
    preInjuryEarnings: { grossWeeklyCents: 128_500, source: "Sample payslips before the accident" },
    unindemnifiedPeriods: [{ from: m2Injury, to: addDays(m2Injury, 111), note: "Off work, then returned on reduced hours" }],
    specialDamages: [
      { from: addDays(m2Injury, 7), providerPayer: "Example Insurer Pty Ltd", item: "Physiotherapy (Sample Physio Clinic)", amountCents: 186_000, paidBy: "insurer" },
      { from: addDays(m2Injury, 1), providerPayer: "Plaintiff", item: "Pharmacy", amountCents: 23_480, paidBy: "plaintiff" },
    ],
    pastGratuitousServices: [
      { from: m2Injury, to: addDays(m2Injury, 83), provider: "Partner", service: "Domestic help", hourlyRateCents: 3_500, hoursPerWeek: 7, hoursDescription: "1 hour a day" },
    ],
    futureMedical: [
      { service: "GP review", costCents: 9_500, frequencyPerYear: 4, frequency: "4 times a year", evidence: "IME report of Dr Quinn Example" },
      { service: "Physiotherapy", costCents: 9_000, frequencyPerYear: 12, frequency: "monthly", evidence: "IME report of Dr Quinn Example" },
    ],
    futureLossPercent: 20,
    generalDamagesCents: 3_500_000,
    lifeExpectancy: { years: 38.6, citation: "Sample figure for the demo (use the current ABS life tables)" },
    note: "First draft for the settlement conference",
  });
  await s.run("solicitor", "compute_authority_to_settle", {
    matterId: m2Id,
    settlementOfferCents: 8_250_000,
    legalCostsCents: 2_420_000,
    disbursementsCents: 386_000,
    medicalAccountsCents: 186_000,
    centrelink: "nil",
    otherTerms: "Release in the insurer's usual form",
  });
  const m2Time = await s.run<TimeEntry[]>("solicitor", "propose_time_entry", {
    matterId: m2Id,
    entries: [
      { category: "JP", date: day(-40), unitsFrom: { kind: "perusal", pages: 14, density: "clinical" }, description: "Peruse IME report of Dr Quinn Example" },
      { category: "JP", date: day(-21), units: 18, description: "Draft particulars of damages" },
      { category: "JP", date: day(-9), units: 5, description: "Conference with client about the insurer's offer" },
    ],
  });
  await s.approved("solicitor", "principal", "approve_time_entries", { matterId: m2Id, entryIds: m2Time.map((e) => e.id) });
  await s.run("solicitor", "propose_time_entry", {
    matterId: m2Id,
    entries: [{ category: "JP", date: day(-2), unitsFrom: { kind: "email", direction: "sent", words: 220 }, description: "Email to the insurer about the offer" }],
  });
  await s.run("principal", "propose_time_entry", { matterId: m2Id, entries: [{ category: "SP", date: day(-3), units: 5, description: "Review particulars and settlement position" }] });
  await s.run("solicitor", "add_file_note", {
    matterId: m2Id,
    kind: "conference",
    occurredAt: at(-9),
    minutes: 45,
    text: "Explained the insurer's offer and the draft particulars. Client wants to attend the settlement conference before deciding. Discussed the Medicare charge and how the Authority to Settle works.",
  });
  await s.run("solicitor", "add_file_note", {
    matterId: m2Id,
    kind: "phone",
    occurredAt: at(-2, 6),
    minutes: 12,
    text: "Insurer's claims officer expects a further offer once the particulars are served.",
  });
  await s.run("principal", "create_task", { matterId: m2Id, title: "Review the particulars of damages before the settlement conference", dueOn: day(-1) });
  await s.run("solicitor", "create_task", { matterId: m2Id, title: "Prepare the Authority to Settle for the client to sign", dueOn: day(3) });

  // ---------------------------------------------------------------- 3. WorkCover, election date waiting for approval
  const m3 = await open("solicitor", {
    number: "DEMO-1003",
    title: "Placeholder v Sample Logistics Pty Ltd",
    scheme: "workcover_wa",
    injuryDate: monthsAgo(13),
    client: { name: "Taylor Placeholder", dateOfBirth: "1985-02-17", email: "taylor.placeholder@example.com", phone: "0491 570 158" },
    otherParties: [
      { name: "Sample Logistics Pty Ltd", role: "employer", kind: "organisation" },
      { name: "Example Workers Comp Insurer Pty Ltd", role: "insurer", kind: "organisation", email: "workers.comp@example.net" },
    ],
    references: ["WC-SL-20001"],
  });
  const m3Id = m3.matter.id;
  const election = await s.run<KeyDate>("paralegal", "propose_key_date", {
    matterId: m3Id,
    keyDateId: ruleDate(m3.keyDates, "workcover.common_law_election").id,
    date: day(45),
    note: "From the insurer's letter; check against the Act before confirming",
  });
  const reply = await s.run<KeyDate>("paralegal", "propose_key_date", { matterId: m3Id, title: "Reply to the insurer's request for further information", date: day(-2), kind: "deadline" });
  await confirm("paralegal", "solicitor", m3Id, reply);
  await s.run("paralegal", "log_evidence_request", { matterId: m3Id, kind: "wage_records", provider: "Sample Logistics Pty Ltd", description: "Wage records for the 12 months before the injury", requestedOn: day(-35) });
  await s.run("paralegal", "log_evidence_request", { matterId: m3Id, kind: "medical_report", provider: "Example Occupational Health", description: "Whole person impairment assessment", requestedOn: day(-15) });
  await s.run("paralegal", "add_file_note", {
    matterId: m3Id,
    kind: "phone",
    occurredAt: at(-12, 5),
    minutes: 10,
    text: "Insurer's case manager confirmed weekly payments continue and asked for the client's updated medical certificate.",
  });
  await document("paralegal", m3Id, { kind: "letter", author: "Example Workers Comp Insurer", date: day(-12) }, "Correspondence", [
    "Re: Taylor Placeholder, claim WC-SL-20001",
    "Please provide an updated certificate of capacity and the information listed below.",
  ]);
  const m3Time = await s.run<TimeEntry[]>("paralegal", "propose_time_entry", {
    matterId: m3Id,
    entries: [
      { category: "CPL", forum: "workcover", date: day(-15), units: 3, description: "Prepare request to Example Occupational Health" },
      { category: "CPL", forum: "workcover", date: day(-12), units: 2, description: "Telephone attendance on the insurer's case manager" },
      { category: "CPL", forum: "workcover", date: day(-7), units: 4, description: "Collate medical certificates for the insurer" },
    ],
  });
  // Waiting in the inbox: a paralegal cannot confirm a legal date or approve time.
  await s.request("paralegal", "confirm_key_date", { matterId: m3Id, keyDateId: election.id });
  await s.request("paralegal", "approve_time_entries", { matterId: m3Id, entryIds: m3Time.map((e) => e.id) });
  await s.run("principal", "create_task", { matterId: m3Id, title: "Advise the client on the common-law election", dueOn: day(9) });

  // ---------------------------------------------------------------- 4. WorkCover, conciliation coming up
  const m4 = await open("solicitor", {
    number: "DEMO-1004",
    title: "Fictional v Example Constructions Pty Ltd",
    scheme: "workcover_wa",
    injuryDate: monthsAgo(26),
    client: { name: "Jamie Fictional", dateOfBirth: "1992-11-05", email: "jamie.fictional@example.com", phone: "0491 570 159" },
    otherParties: [
      { name: "Example Constructions Pty Ltd", role: "employer", kind: "organisation" },
      { name: "Example Workers Comp Insurer Pty Ltd", role: "insurer", kind: "organisation", email: "workers.comp@example.net" },
    ],
    references: ["WC-EC-20002"],
  });
  const m4Id = m4.matter.id;
  await s.run("paralegal", "propose_key_date", { matterId: m4Id, title: "Serve medical reports on the insurer", date: day(-3), kind: "deadline", note: "Agreed timetable" });
  const conciliation = await s.run<KeyDate>("paralegal", "propose_key_date", { matterId: m4Id, title: "Conciliation conference", date: day(6), kind: "deadline" });
  await confirm("paralegal", "principal", m4Id, conciliation);
  await s.run("principal", "add_file_note", {
    matterId: m4Id,
    kind: "note",
    occurredAt: at(-20),
    text: "Dispute is about the client's capacity for pre-injury duties. Two treating reports support our position; serve both before the conciliation conference.",
  });
  await document("paralegal", m4Id, { kind: "report", author: "Dr Robin Sample", profession: "Occupational Physician", practice: "Example Occupational Health", date: day(-25) }, "Medical Reports", [
    "Jamie Fictional has partial capacity for work with lifting restrictions of 10 kg.",
  ]);
  await s.run("principal", "create_task", { matterId: m4Id, title: "Settle the outline for the conciliation conference", dueOn: day(4) });

  // ---------------------------------------------------------------- 5. ICWA, opened this week
  const m5 = await open("solicitor", {
    number: "DEMO-1005",
    title: "Testcase v Example Insurer",
    scheme: "icwa_mva",
    injuryDate: day(-21),
    client: { name: "Drew Testcase", dateOfBirth: "2001-06-30", email: "drew.testcase@example.com", phone: "0491 570 110" },
    otherParties: [{ name: "Example Insurer Pty Ltd", role: "insurer", kind: "organisation", email: "claims@example.net" }],
  });
  const m5Id = m5.matter.id;
  await s.run("solicitor", "add_file_note", {
    matterId: m5Id,
    kind: "phone",
    occurredAt: at(0, 1),
    minutes: 20,
    text: "New enquiry. Cyclist struck by a turning car three weeks ago; fractured wrist. Explained the ICWA claim process; costs agreement and disclosure to follow.",
  });
  await s.run("solicitor", "create_task", { matterId: m5Id, title: "Send the costs agreement and disclosure to the client", dueOn: day(2) });
  await s.run("paralegal", "log_evidence_request", { matterId: m5Id, kind: "police_report", provider: "Sample Police Records Office", description: "Crash report" });

  // ---------------------------------------------------------------- firm-wide
  await s.run("principal", "create_task", { title: "Sign off the monthly trust reconciliation", dueOn: day(2) });

  return {
    tenantId,
    firmName: DEMO_FIRM_NAME,
    signInEmail: DEMO_STAFF.principal.email,
    staff: Object.values(s.users).map((u) => ({ email: u.email, displayName: u.displayName, roles: u.roles })),
    matters: [m1, m2, m3, m4, m5].map(({ matter }) => ({ id: matter.id, number: matter.number, title: matter.title })),
    pendingApprovals: app.bus.approvals.list(tenantId, "pending").length,
  };
}

export interface DemoServer {
  url: string;
  /** Where to sign in with the development sign-in. */
  signInUrl: string;
  summary: DemoSummary;
  /** False when dist/web has no build, so only the API is served. */
  webBuilt: boolean;
  server: Server;
  close(): Promise<void>;
}

/**
 * Starts Practy on the sample firm: in-memory store, documents in a temporary folder removed on
 * close, and the development sign-in as the only way in. Uses PORT, PRACTY_BASE_URL,
 * PRACTY_TENANT_ID and PRACTY_WEB_DIR like `npm start`; no other configuration is read.
 */
export async function startDemo(env: NodeJS.ProcessEnv = process.env): Promise<DemoServer> {
  const refusal = demoRefusal(env);
  if (refusal) throw new Error(refusal);
  const { port, baseUrl, tenantId, webDir } = loadConfig({ PORT: env.PORT, PRACTY_BASE_URL: env.PRACTY_BASE_URL, PRACTY_TENANT_ID: env.PRACTY_TENANT_ID, PRACTY_WEB_DIR: env.PRACTY_WEB_DIR });
  const documentsRoot = mkdtempSync(join(tmpdir(), "practy-demo-"));
  const removeDocuments = () => rmSync(documentsRoot, { recursive: true, force: true });
  try {
    const app = createApp({ localDocumentsRoot: documentsRoot });
    const summary = await seedDemo(app, { tenantId, env });
    const auth = new AuthService(app.store, new Map([["dev", new DevOidcProvider()]]), { baseUrl, defaultTenantId: tenantId });
    const server = createHttpServer(app, { auth, baseUrl, webDir, secureCookies: baseUrl.startsWith("https://") }).listen(port);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    return {
      url: baseUrl,
      signInUrl: `${baseUrl}/auth/login/dev`,
      summary,
      webBuilt: existsSync(join(webDir, "index.html")),
      server,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        removeDocuments();
      },
    };
  } catch (err) {
    removeDocuments();
    throw err;
  }
}

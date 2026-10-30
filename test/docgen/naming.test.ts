import { describe, expect, it } from "vitest";
import {
  checkDocumentName,
  fixDocumentName,
  formatDocumentName,
  NamingError,
  sanitiseFileName,
  SOUL_LEGAL_PROFILE,
  type DocumentNameSpec,
  type NamingProfile,
} from "../../src/docgen/naming.js";

const STAFF = ["Pat Example", "Sam Sample"];

// Every example from the firm's written convention, with the spec that produces it.
const EXAMPLES: [DocumentNameSpec, string][] = [
  [{ kind: "referral", date: "2023-05-24", sierNumber: "26", author: "Prof Panegyres", recipient: "Hollywood Medical Centre" }, "2023.05.24 SIER26 – Referral by Prof Panegyres to Hollywood Medical Centre"],
  [{ kind: "letter", date: "2023-05-24", sierNumber: "SIER26", author: "Professor Panegyres", recipient: "John Smith" }, "2023.05.24 SIER26 – LTR by Prof Panegyres to John Smith"],
  [{ kind: "referral", date: "2023-05-24", author: "Prof Panegyres", recipient: "Dr Finch" }, "2023.05.24 Referral by Prof Panegyres to Dr Finch"],
  [{ kind: "email", date: "2023-05-24", direction: "sent", externalParty: "Hollywood Medical Centre", re: "surgery on 12.12.2023" }, "2023.05.24 EM to Hollywood Medical Centre re surgery on 12.12.2023"],
  [{ kind: "email", date: "2023-05-24", direction: "received", externalParty: "ICWA", re: "liability" }, "2023.05.24 EM from ICWA re liability"],
  [{ kind: "email", date: "2023-05-24", direction: "chain", externalParty: "Hollywood Medical Centre", re: "outstanding invoice" }, "2023.05.24 EMC with Hollywood Medical Centre re outstanding invoice"],
  [{ kind: "email", date: "2023-05-24", direction: "external", externalParty: "Hollywood Medical Centre", otherParty: "Prof Panegyres", re: "surgery" }, "2023.05.24 EM from Hollywood Medical Centre to Prof Panegyres re surgery"],
  [{ kind: "report", date: "2024-08-20", description: "Medical Report", author: "Doctor Smith", profession: "Occupational Physician", practice: "Smith Street Medical" }, "2024.08.20 Medical Report – by Dr Smith – Occupational Physician – Smith Street Medical"],
  [{ kind: "invoice", date: "2024-01-13", service: "Physiotherapy", practice: "Spark Physio", amountCents: 22000 }, "2024.01.13 Physiotherapy Invoice for Spark Physio – $220.00"],
  [{ kind: "invoice", date: "2024-01-13", practice: "Spark Physio", amountCents: 22000 }, "2024.01.13 Tax Invoice – Spark Physio – $220.00"],
  [{ kind: "invoice", date: "Various", practice: "Spark Physio", amountCents: 44000 }, "Various Invoices – Spark Physio – $440.00"],
];

describe("formatDocumentName (Soul Legal profile)", () => {
  it.each(EXAMPLES)("formats %j", (spec, expected) => {
    expect(formatDocumentName(spec, { feeEarnerNames: STAFF })).toBe(expected);
  });

  it("every example passes the checker cleanly", () => {
    for (const [, name] of EXAMPLES) expect(checkDocumentName(name, { feeEarnerNames: STAFF }), name).toEqual([]);
  });

  it("uses a space after the date and en dashes between fields", () => {
    const name = formatDocumentName({ kind: "ime", date: "2025-02-03", author: "Dr Jones", practice: "Perth IME" });
    expect(name).toBe("2025.02.03 IME Report – by Dr Jones – Perth IME");
    expect(name).not.toContain(" - ");
    expect(name).not.toContain("—");
  });

  it("abbreviates WorkCover, courts and titles", () => {
    expect(formatDocumentName({ kind: "email", date: "2025-01-01", direction: "received", externalParty: "WorkCover WA", re: "District Court listing" })).toBe(
      "2025.01.01 EM from WC WA re DC listing",
    );
    expect(formatDocumentName({ kind: "letter", date: "2025-01-01", author: "Supreme Court" })).toBe("2025.01.01 LTR – by SC");
  });

  it("formats amounts with thousands separators and invoice detail", () => {
    expect(formatDocumentName({ kind: "invoice", date: "2024-03-01", service: "IME", practice: "Perth IME", practitioner: "Dr Jones", invoiceNumber: "4471", amountCents: 165050 })).toBe(
      "2024.03.01 IME Invoice for Perth IME – Dr Jones – Inv 4471 – $1,650.50",
    );
  });

  it("omits unknown fields instead of writing placeholders", () => {
    expect(formatDocumentName({ kind: "payslip", date: "2024-06-30", practice: "Acme Pty Ltd" })).toBe("2024.06.30 Payslip – Acme Pty Ltd");
    expect(formatDocumentName({ kind: "report", date: "2024-06-30" })).toBe("2024.06.30 Report");
  });

  it("never names the fee earner or the firm in an email", () => {
    expect(() => formatDocumentName({ kind: "email", date: "2024-01-01", direction: "sent", externalParty: "Pat Example" }, { feeEarnerNames: STAFF })).toThrow(NamingError);
    expect(() => formatDocumentName({ kind: "email", date: "2024-01-01", direction: "sent", externalParty: "Soul Legal" })).toThrow(/never name/);
    expect(formatDocumentName({ kind: "email", date: "2024-01-01", direction: "sent", externalParty: "ICWA", re: "Pat Example's offer" }, { feeEarnerNames: STAFF })).toBe(
      "2024.01.01 EM to ICWA re offer",
    );
  });

  it("validates dates", () => {
    expect(() => formatDocumentName({ kind: "report", date: "2024-02-30" })).toThrow(/calendar/);
    expect(() => formatDocumentName({ kind: "report", date: "20/08/2024" })).toThrow(/ISO/);
    expect(() => formatDocumentName({ kind: "email", date: "2024-01-01", direction: "external", externalParty: "A" })).toThrow(/otherParty/);
  });

  it("sanitises characters illegal in Box and Windows file names", () => {
    expect(formatDocumentName({ kind: "email", date: "2024-01-01", direction: "received", externalParty: "Lavan", re: 'claim 1/2: "urgent"?' })).toBe(
      "2024.01.01 EM from Lavan re claim 1-2 - 'urgent'",
    );
    expect(sanitiseFileName("report. ")).toBe("report");
    expect(sanitiseFileName("CON")).toBe("_CON");
  });
});

describe("naming profiles", () => {
  it("lets another firm define its own convention", () => {
    const other: NamingProfile = {
      ...SOUL_LEGAL_PROFILE,
      id: "other",
      name: "Other Firm",
      dateFormat: "YYYY-MM-DD",
      separator: " - ",
      labels: { ...SOUL_LEGAL_PROFILE.labels, letter: "Letter" },
      email: { ...SOUL_LEGAL_PROFILE.email, single: "Email" },
      firmNames: ["Other Firm"],
    };
    expect(formatDocumentName({ kind: "letter", date: "2024-05-01", author: "Dr Lee", recipient: "Insurer" }, { profile: other })).toBe("2024-05-01 Letter by Dr Lee to Insurer");
    expect(formatDocumentName({ kind: "report", date: "2024-05-01", author: "Dr Lee", practice: "Clinic" }, { profile: other })).toBe("2024-05-01 Report - by Dr Lee - Clinic");
    expect(formatDocumentName({ kind: "email", date: "2024-05-01", direction: "sent", externalParty: "ICWA" }, { profile: other })).toBe("2024-05-01 Email to ICWA");
    expect(checkDocumentName("2024-05-01 Report - by Dr Lee - Clinic", { profile: other })).toEqual([]);
  });

  it("accepts a fully custom renderer", () => {
    const custom: NamingProfile = { ...SOUL_LEGAL_PROFILE, render: (spec) => `${spec.date}_${spec.kind}` };
    expect(formatDocumentName({ kind: "report", date: "2024-05-01" }, { profile: custom })).toBe("2024-05-01_report");
  });
});

describe("checkDocumentName", () => {
  const codes = (name: string) => checkDocumentName(name, { feeEarnerNames: STAFF }).map((i) => i.code);

  it("flags the fee earner and 'by' in email names, and fixes them", () => {
    const bad = "2023.05.24 EM by Pat Example to Dr Smith";
    expect(codes(bad)).toEqual(expect.arrayContaining(["email-by", "email-fee-earner"]));
    expect(fixDocumentName(bad, { feeEarnerNames: STAFF })).toBe("2023.05.24 EM to Dr Smith");
    expect(codes("2023.05.24 EM from Soul Legal to ICWA")).toContain("email-firm-name");
    expect(codes("2023.05.24 EM re liability")).toContain("email-direction");
  });

  it("flags date problems", () => {
    expect(codes("Medical Report – by Dr Smith")).toContain("date-missing");
    expect(codes("2024-08-20 Medical Report")).toContain("date-format");
    expect(codes("20.08.2024 Medical Report")).toContain("date-format");
    expect(codes("2024.13.20 Medical Report")).toContain("date-invalid");
    expect(codes("2024.08.20 – Medical Report")).toContain("date-separator");
  });

  it("flags separators, placeholders, counters and abbreviations", () => {
    expect(codes("2024.08.20 Medical Report - by Dr Smith")).toContain("hyphen-separator");
    expect(codes("2024.08.20 Medical Report — by Dr Smith")).toContain("em-dash");
    expect(codes("2024.08.20 Medical Report – by Unknown")).toContain("placeholder");
    expect(codes("2024.08.20 Physiotherapy Invoice for Spark Physio – $220.00 (2)")).toContain("counter");
    expect(codes("2024.08.20 Medical Report – by Professor Smith")).toContain("abbreviation");
    expect(codes("2024.08.20 LTR from WorkCover")).toContain("abbreviation");
  });

  it("flags invoices without a proper amount", () => {
    expect(codes("2024.01.13 Physiotherapy Invoice for Spark Physio")).toContain("invoice-amount-missing");
    expect(codes("2024.01.13 Physiotherapy Invoice for Spark Physio – $220")).toContain("amount-format");
  });

  it("flags SIER and illegal characters", () => {
    expect(codes("2023.05.24 SIER 26 Referral by Prof Panegyres to Dr Finch")).toContain("sier-format");
    expect(codes("2023.05.24 EM from ICWA re: liability")).toContain("illegal-character");
  });

  it("ignores the file extension and fixes common mistakes", () => {
    expect(codes("2024.08.20 Medical Report – by Dr Smith.pdf")).toEqual([]);
    expect(fixDocumentName("2024-08-20 - Medical Report - by Doctor Smith - Smith Street Medical.pdf")).toBe("2024.08.20 Medical Report – by Dr Smith – Smith Street Medical.pdf");
    expect(fixDocumentName("2023.05.24 SIER 26 - Referral by Professor Panegyres to Dr Finch")).toBe("2023.05.24 SIER26 – Referral by Prof Panegyres to Dr Finch");
  });
});

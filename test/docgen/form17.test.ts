import { describe, expect, it } from "vitest";
import { docxText } from "../../src/docgen/docx.js";
import { buildListOfDocuments, categoriseForForm17, form17ItemCount, PRIVILEGED_ITEMS, type Form17Config } from "../../src/docgen/form17.js";
import { readPart } from "./fixtures.js";

const CONFIG: Form17Config = {
  court: { actionNumber: "CIV 501 of 2026" },
  parties: [
    { name: "Sam Plaintiff", role: "Plaintiff" },
    { name: "Example Security Pty Ltd (ABN 00 000 000 000)", role: "First Defendant" },
  ],
  firmName: "Example Firm",
  inspectionAddress: "1 Example Street, Perth WA",
  categories: [
    { name: "Privileged Documents", items: PRIVILEGED_ITEMS("plaintiff") },
    { name: "Medical Reports", items: [{ description: "CT scan cervical spine – Example Radiology", date: "08.03.2023" }, { description: "Report – by Dr Smith", date: "01.05.2023" }] },
    { name: "Economic Loss", items: [{ description: "Payslips – Acme", date: "Various" }] },
  ],
};

describe("buildListOfDocuments", () => {
  it("renders the Form 17 layout", async () => {
    const xml = readPart(await buildListOfDocuments(CONFIG), "word/document.xml");
    const text = docxText(xml);
    expect(text).toContain("District Court of Western Australia\nHeld at Perth\nNo: CIV 501 of 2026\n\nList of documents");
    expect(text).toContain("Sam Plaintiff\nPlaintiff");
    expect(text).toContain("List of documents — Part 1A");
    // Continuous numbering across categories.
    expect(text).toMatch(/1\.\nConfidential correspondence[^\n]*\nVarious\n2\.\nNotes, memoranda/);
    expect(text).toMatch(/3\.\nCT scan cervical spine – Example Radiology\n08\.03\.2023\n4\.\nReport – by Dr Smith\n01\.05\.2023\nEconomic Loss\n5\.\nPayslips – Acme\nVarious/);
    // Column-header row only after the first category.
    expect(text.match(/No\.\nDescription of document\nDate/g)).toHaveLength(1);
    // Defaults: 1B privilege objection over items 1 – 2; Nil in 2A and 2B.
    expect(text).toContain("1 – 2\nThe plaintiff objects to producing these documents on the grounds of legal professional privilege");
    expect(text).toMatch(/Part 2A[^]*Nil[^]*Part 2B[^]*Nil/);
    expect(text).toContain("Notes to Form No. 17 —");
    expect(text).toContain("served on the defendants on ____________ by the plaintiff.");
    expect(text).toContain("Example Firm");

    // Fixed format: Times New Roman, A4, 1-inch margins, no shading.
    expect(readPart(await buildListOfDocuments(CONFIG), "word/styles.xml")).toContain("Times New Roman");
    expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect(xml).toMatch(/<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/);
    expect(xml).not.toContain("<w:shd");
    // Header row's left cell spans two grid columns and two rows.
    expect(xml).toMatch(/<w:gridSpan w:val="2"\/>[^]*?<w:vMerge w:val="restart"\/>|<w:vMerge w:val="restart"\/>[^]*?<w:gridSpan w:val="2"\/>/);
    expect(form17ItemCount(CONFIG)).toBe(5);
  });

  it("adapts the wording for a defendant's list", async () => {
    const text = docxText(readPart(await buildListOfDocuments({ ...CONFIG, party: "defendant", part1bObjections: [] }), "word/document.xml"));
    expect(text).toContain("custody or power of the defendant.");
    expect(text).toContain("served on the plaintiff on ____________ by the defendant.");
    expect(text).toMatch(/No\. in Part 1A\nGrounds for objecting to producing the document\nNil/);
  });
});

describe("categoriseForForm17", () => {
  const files = [
    { name: "2023.05.01 Report – by Dr Smith – Orthopaedic Surgeon.pdf", folder: "Medical Reports" },
    { name: "2023.03.08 CT scan cervical spine – Example Radiology.pdf", folder: "Medical Reports" },
    { name: "2023.03.08 CT scan cervical spine – Example Radiology.jpg", folder: "Medical Reports" },
    { name: "2023.03.08 CT scan cervical spine – Example Radiology.pdf", folder: "Emails" },
    { name: "2023.04.02 Certificate of Capacity – Dr Lee.pdf" },
    { name: "2023.02.01 Hospital discharge summary – Fiona Stanley.pdf" },
    { name: "2023.06.01 Psychology clinical notes – Example Clinic.pdf" },
    { name: "2023.07.01 Payslip – Acme Pty Ltd.pdf" },
    { name: "2022.07.01 Notice of Assessment.pdf", folder: "Tax Documents" },
    { name: "2023.01.15 Crash report – Police.pdf" },
    { name: "2023.08.01 Claims history – Example Insurer.pdf" },
    { name: "2023.09.01 Vocational assessment – RTW Provider.pdf" },
    { name: "2024.01.13 Physiotherapy Invoice for Spark Physio – $220.00.pdf" },
    { name: "2023.05.24 EM from ICWA re liability.pdf", folder: "Emails" },
    { name: "2023.10.01 Statement of Claim.pdf", folder: "Court Documents" },
    { name: "scan0001.pdf", folder: "Medical Reports" },
  ];

  it("maps files to the standard categories in order, dated DD.MM.YYYY, de-duplicated", () => {
    const { categories, excluded } = categoriseForForm17(files, { actionNumber: "CIV 501 of 2026" });
    expect(categories.map((c) => c.name)).toEqual([
      "Privileged Documents",
      "Court Documents and Correspondence between the plaintiff and the defendants' solicitors",
      "Medical Reports",
      "Progress Medical Certificates",
      "Mental Health Records",
      "Hospital and Clinical Records",
      "Workers' Compensation Documents",
      "Vocational Rehabilitation",
      "Economic Loss",
      "Liability",
      "Other",
    ]);
    const byName = Object.fromEntries(categories.map((c) => [c.name, c.items]));
    expect(byName["Court Documents and Correspondence between the plaintiff and the defendants' solicitors"]![0]!.description).toBe(
      "Court documents in the District Court of Western Australia Action No. CIV 501 of 2026 common to the parties.",
    );
    expect(byName["Medical Reports"]).toEqual([
      { description: "CT scan cervical spine – Example Radiology", date: "08.03.2023" },
      { description: "Report – by Dr Smith – Orthopaedic Surgeon", date: "01.05.2023" },
      { description: "scan0001", date: "Undated" },
    ]);
    expect(byName["Economic Loss"]).toEqual([
      { description: "Notice of Assessment", date: "01.07.2022" },
      { description: "Payslip – Acme Pty Ltd", date: "01.07.2023" },
    ]);
    expect(byName["Progress Medical Certificates"]![0]!.date).toBe("02.04.2023");
    expect(byName["Mental Health Records"]![0]!.description).toBe("Psychology clinical notes – Example Clinic");
    expect(byName["Liability"]![0]!.description).toBe("Crash report – Police");
    expect(byName["Other"]![0]!.description).toBe("Physiotherapy Invoice for Spark Physio – $220.00");

    const reasons = excluded.map((e) => `${e.file.name} | ${e.reason.split(" (")[0]}`);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "2023.03.08 CT scan cervical spine – Example Radiology.jpg | duplicate of 2023.03.08 CT scan cervical spine – Example Radiology.pdf",
        "2023.03.08 CT scan cervical spine – Example Radiology.pdf | duplicate of 2023.03.08 CT scan cervical spine – Example Radiology.pdf",
        "2023.05.24 EM from ICWA re liability.pdf | correspondence",
        "2023.10.01 Statement of Claim.pdf | court document",
      ]),
    );
  });

  it("feeds straight into the builder", async () => {
    const { categories } = categoriseForForm17(files);
    const text = docxText(readPart(await buildListOfDocuments({ ...CONFIG, categories }), "word/document.xml"));
    expect(text).toContain("CT scan cervical spine – Example Radiology");
  });
});

/**
 * Synthetic .docx fixtures built in code. Firm templates are tenant assets and are
 * never committed, so tests rebuild their structure (tokens, labels, value cells,
 * header/footer references) from scratch.
 */
import PizZip from "pizzip";
import { xmlEscape } from "../../src/docgen/docx.js";

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
export const p = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
export const tc = (...paras: string[]) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paras.join("") || "<w:p/>"}</w:tc>`;
export const tr = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
export const tbl = (...rows: string[]) => `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="6000"/><w:gridCol w:w="2400"/></w:tblGrid>${rows.join("")}</w:tbl>`;

// 1x1 transparent PNG standing in for a firm logo.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

export const SECT_PR =
  '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2552" w:right="1134" w:bottom="1135" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';

export interface DocxFixture {
  body: string;
  headerText?: string;
  footerText?: string;
  settings?: string;
  extraParts?: Record<string, string>;
  extraRels?: string;
  extraContentTypes?: string;
}

export function makeDocx(f: DocxFixture): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${f.extraContentTypes ?? ""}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${f.extraRels ?? ""}</Relationships>`,
  );
  zip.file(
    "word/_rels/header1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
  );
  zip.file("word/media/image1.png", PNG);
  zip.file(
    "word/header1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdLogo"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>${r(f.headerText ?? "EXAMPLE FIRM")}</w:p></w:hdr>`,
  );
  zip.file("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}>${p(r(f.footerText ?? "Example footer address"))}</w:ftr>`);
  zip.file(
    "word/settings.xml",
    f.settings ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W_NS}><w:zoom w:percent="100"/></w:settings>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${f.body}${SECT_PR}</w:body></w:document>`);
  for (const [path, xml] of Object.entries(f.extraParts ?? {})) zip.file(path, xml);
  return zip.generate({ type: "uint8array" });
}

export function readPart(bytes: Uint8Array, path: string): string {
  const f = new PizZip(bytes).file(path);
  if (!f) throw new Error(`missing part ${path}`);
  return f.asText();
}

const row = (letter: string, label: string, value: string) => tr(tc(p(r(letter))), tc(p(r(label))), tc(p(r(value))));

/**
 * Same structure as a firm Authority to Settle form: header tokens (with one split
 * across runs, as Word does), labelled rows with "$"/"E$" value cells, the two inline
 * underscore blanks, and bank/signature lines that must stay blank.
 */
export function syntheticAuthorityForm(): Uint8Array {
  const body = [
    p(r("AUTHORITY TO SETTLE PERSONAL INJURY CLAIM(S)", "<w:b/>")),
    p(r("I "), r("{{CLIENT_"), r("NAME}}", "<w:b/>"), r(" DIRECT You TO SETTLE my claim arising from my injury sustained on or about "), r("{{INJURY_DATE}}"), r(" as follows:")),
    tbl(
      tr(tc(p(r("A."))), tc(p(r("Terms of Total Offer"))), tc()),
      row("(a)", "settlement offer  ", "$   "),
      row("(b)", "contribution towards legal costs (including GST)", "$"),
      row("(c)", "contribution towards disbursements", "$"),
      row("(d)", "contribution towards medical accounts", "$"),
      row("(e)", "contribution towards Medicare Australia", "$"),
      tr(tc(p(r("(f)"))), tc(p(r("other terms: ______________________________________________"))), tc()),
      row("", "TOTAL OFFER ", "$"),
      tr(tc(p(r("B."))), tc(p(r("Deductions from Total Offer"), r(" "), r("[“E” means estimated]"))), tc(p(r("$")))),
      row("(a)", "workers compensation refund/indemnity (if applicable)", "E$"),
      row("(b)", "medical/other accounts: _____________________________________", "E$"),
      row("(c)", "Medicare Australia [10% advance payment, subject to refund, if any]", "E$"),
      row("", "(d)      Tax (if applicable)", "E$"),
      row("(e)", "Centrelink refund – you to ascertain", "E$"),
      row("(f)", "Legal Aid Refund, (if applicable) ", "E$"),
      row("(g)", "other solicitors’/ barrister’s fees: _______________________________", "E$"),
      row("(h)", "other debts: ________________________________________________", "E$"),
      row("(i)", "outstanding disbursements to be paid", "E$"),
      row("(j)", "Soul Legal fees (including disbursements of $____________________)", "E$"),
      tr(tc(p(r("C."))), tc(p(r("Net “In Hand”"))), tc()),
      row("(a)", "estimated net in hand cash settlement (subject to unknown figures above)", "E$"),
      row("(b)", "plus Medicare/other benefits (if any, up to)", "E$"),
      row("(c)", "plus residual balance held in trust", "E$"),
      row("(c)", "total", "E$"),
    ),
    p(r("Account Holders Name:"), r("____________________________________________________")),
    p(r("BSB: __________________________Account No. ________________________________")),
    p(r("DATED this ________ day of __________________________20____")),
    p(r("{{CLIENT_NAME}}")),
    p(r("Solicitor: {{SOLICITOR}} ")),
  ].join("");
  return makeDocx({ body });
}

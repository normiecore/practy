import { describe, expect, it } from "vitest";
import { CsvMatterImporter } from "../../src/connectors/importers/csv.js";
import { schemeFromMatterType, statusFromText } from "../../src/connectors/importers/matter-type.js";
import { PracticePantherImporter } from "../../src/connectors/importers/practicepanther.js";
import { fakeFetch, token } from "./fake-fetch.js";

describe("matter type and status mapping", () => {
  it.each([
    ["MVA", "icwa_mva"],
    ["Motor Vehicle Accident", "icwa_mva"],
    ["ICWA claim", "icwa_mva"],
    ["WorkCover", "workcover_wa"],
    ["Workers' Compensation", "workcover_wa"],
    ["WC", "workcover_wa"],
    ["Public Liability", undefined],
    ["WorkCover – motor vehicle at work", undefined],
    [undefined, undefined],
  ])("%s → %s", (text, scheme) => {
    expect(schemeFromMatterType(text)).toBe(scheme);
  });

  it("treats closed-like statuses as closed and everything else as open", () => {
    expect(["Closed", " archived ", "Finalised"].map(statusFromText)).toEqual(["closed", "closed", "closed"]);
    expect(["Open", "Pending", "", undefined].map(statusFromText)).toEqual(["open", "open", "open", "open"]);
  });
});

describe("CsvMatterImporter", () => {
  const CSV = `﻿Matter No,Client,Type,Status,Opened,Date of Injury,Email,Mobile,DOB,Insurer,Employer,Fee Earner
1998,"Priestley, Toni",MVA,Open,3/2/2025,14/01/2025,toni@example.com,0400 000 000,1/5/1980,Insurance Commission of WA,,Kevin Wong
2001,"Citizen, John",WorkCover,Closed,2024-06-01,2024-05-20,,,,,Acme Pty Ltd,
,,,,,,,,,,,
2002,"Doe, Jane",Public Liability,Pending,,,,,,,,
`;
  const columns = {
    number: "matter no",
    clientName: "Client",
    matterType: "Type",
    status: "Status",
    openedOn: "Opened",
    injuryDate: "Date of Injury",
    clientEmail: "Email",
    clientPhone: "Mobile",
    clientDateOfBirth: "DOB",
    responsibleStaff: "Fee Earner",
    otherParties: [
      { column: "Insurer", role: "insurer" },
      { column: "Employer", role: "employer" },
    ],
  };

  it("maps rows through the column mapping, parsing Australian dates and schemes", async () => {
    const matters = await new CsvMatterImporter({ text: CSV, columns }).listMatters();
    expect(matters).toHaveLength(3);
    expect(matters[0]).toEqual({
      externalId: "csv:1998",
      number: "1998",
      title: "1998 - Priestley, Toni",
      matterType: "MVA",
      scheme: "icwa_mva",
      status: "open",
      openedOn: "2025-02-03",
      injuryDate: "2025-01-14",
      client: { name: "Priestley, Toni", email: "toni@example.com", phone: "0400 000 000", dateOfBirth: "1980-05-01" },
      otherParties: [{ name: "Insurance Commission of WA", role: "insurer" }],
      responsibleStaff: "Kevin Wong",
    });
    expect(matters[1]).toMatchObject({ number: "2001", scheme: "workcover_wa", status: "closed", otherParties: [{ name: "Acme Pty Ltd", role: "employer" }] });
    expect(matters[2]).toMatchObject({ number: "2002", matterType: "Public Liability", status: "open" });
    expect(matters[2]).not.toHaveProperty("scheme");
  });

  it("reports bad dates with the row number and unknown columns by name", async () => {
    const bad = "Matter No,Client,Opened\n1998,X,31/31/2025\n";
    await expect(new CsvMatterImporter({ text: bad, columns: { number: "Matter No", clientName: "Client", openedOn: "Opened" } }).listMatters())
      .rejects.toThrow(/Row 2: unrecognised open date/);
    await expect(new CsvMatterImporter({ text: bad, columns: { number: "Number", clientName: "Client" } }).listMatters())
      .rejects.toThrow(/Column "Number" not found/);
  });
});

describe("PracticePantherImporter", () => {
  const API = "https://app.practicepanther.com/api/v2";
  const cf = (label: string, v: object) => ({
    custom_field_ref: { id: `cf-${label}`, label, value_type: "TextBox" },
    value_boolean: false,
    value_date_time: null,
    value_number: null,
    value_string: null,
    ...v,
  });
  const MATTERS = [
    {
      id: "m-1998",
      account_ref: { id: "a-toni", display_name: "Toni Priestley" },
      number: 1998,
      display_name: "1998 - Priestley, Toni - MVA",
      name: "Priestley, Toni - MVA",
      notes: "Rear-ended at Kwinana Fwy",
      open_date: "2025-02-03T00:00:00+00:00",
      close_date: null,
      tags: ["Litigation"],
      status: "Open",
      assigned_to_users: [{ id: "u1", display_name: "Kevin Wong", email_address: "kevin@soullegal.com.au" }],
      custom_field_values: [
        cf("Matter Type", { value_string: "Motor Vehicle Accident" }),
        cf("Date of Injury", { value_date_time: "2025-01-14T00:00:00+00:00" }),
      ],
      created_at: "2025-02-03T01:00:00+00:00",
      updated_at: "2026-10-01T01:00:00+00:00",
    },
    {
      id: "m-2001",
      account_ref: { id: "a-john", display_name: "John Citizen" },
      number: 2001,
      display_name: "2001 - Citizen, John - WC",
      status: "Closed",
      tags: [],
      custom_field_values: [],
    },
  ];
  const ACCOUNTS = [
    {
      id: "a-toni",
      display_name: "Toni Priestley",
      number: 512,
      address_street_1: "1 Example St",
      address_street_2: null,
      address_city: "Baldivis",
      address_state: "WA",
      address_zip_code: "6171",
      address_country: "Australia",
      primary_contact: {
        id: "c-toni",
        account_ref: { id: "a-toni", display_name: "Toni Priestley" },
        is_primary_contact: true,
        display_name: "Toni Priestley",
        first_name: "Toni",
        last_name: "Priestley",
        phone_mobile: "0400 000 000",
        email: "toni@example.com",
        custom_field_values: [cf("Date of Birth", { value_date_time: "1980-05-01T00:00:00+00:00" })],
      },
    },
    { id: "a-john", display_name: "John Citizen", primary_contact: null },
  ];
  const CONTACTS = [
    { id: "c-john", account_ref: { id: "a-john", display_name: "John Citizen" }, is_primary_contact: true, display_name: "John Citizen", phone_home: "08 9000 0000" },
  ];
  const RELATIONSHIPS = [
    { id: "r1", contact_ref: { id: "c-icwa", display_name: "Insurance Commission of WA", account_ref: { id: "a-icwa", display_name: "ICWA" } }, matter_ref: { id: "m-1998", display_name: "1998" }, name: "Insurer", notes: null },
    { id: "r2", contact_ref: { id: "c-drv", display_name: "Sam Driver" }, matter_ref: { id: "m-1998", display_name: "1998" }, name: "Driver" },
  ];

  it("joins matters, accounts, contacts and relationships from four list calls", async () => {
    const f = fakeFetch();
    f.on("GET", `${API}/matters`, MATTERS);
    f.on("GET", `${API}/accounts`, ACCOUNTS);
    f.on("GET", `${API}/contacts`, CONTACTS);
    f.on("GET", `${API}/relationships`, RELATIONSHIPS);
    const importer = new PracticePantherImporter({
      getAccessToken: token,
      fetch: f.fetch,
      status: "Open",
      customFields: { matterType: "matter type", injuryDate: "Date of Injury", clientDateOfBirth: "Date of Birth" },
    });
    const matters = await importer.listMatters();

    expect(f.calls.map((c) => c.url).sort()).toEqual([
      `${API}/accounts`,
      `${API}/contacts`,
      `${API}/matters?status=Open`,
      `${API}/relationships`,
    ]);
    expect(f.calls.every((c) => c.headers.Authorization === "Bearer test-token")).toBe(true);
    expect(matters[0]).toEqual({
      externalId: "m-1998",
      number: "1998",
      title: "1998 - Priestley, Toni - MVA",
      matterType: "Motor Vehicle Accident",
      scheme: "icwa_mva",
      status: "open",
      openedOn: "2025-02-03",
      injuryDate: "2025-01-14",
      client: {
        name: "Toni Priestley",
        email: "toni@example.com",
        phone: "0400 000 000",
        dateOfBirth: "1980-05-01",
        address: "1 Example St, Baldivis, WA 6171, Australia",
      },
      otherParties: [
        { name: "Insurance Commission of WA", role: "Insurer" },
        { name: "Sam Driver", role: "Driver" },
      ],
      responsibleStaff: "Kevin Wong",
      notes: "Rear-ended at Kwinana Fwy",
    });
    // No custom field: the scheme comes from the folder-style display name suffix; the
    // client contact comes from the contacts list when the account has none embedded.
    expect(matters[1]).toMatchObject({
      number: "2001",
      matterType: "WC",
      scheme: "workcover_wa",
      status: "closed",
      client: { name: "John Citizen", phone: "08 9000 0000" },
      otherParties: [],
    });
  });
});

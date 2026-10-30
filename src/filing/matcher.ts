/**
 * Decides where an email belongs, encoding the firm's filing sweep rules:
 * strong evidence files automatically; anything ambiguous goes to a human. A wrong
 * match puts a document in the wrong client's file, so under-filing is preferred.
 */

export interface MatterIndexEntry {
  matterId: string;
  number: string;
  status: "open" | "closed";
  clientName: string;
  /** Surname(s) of the client, lower-case. */
  surnames: string[];
  /** Known email addresses of the client and other parties on the matter. */
  emails: string[];
  /** Court action numbers, claim numbers etc. (normalised, lower-case). */
  references: string[];
}

export interface EmailFacts {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  body: string;
  threadId: string;
}

export interface MatchDecision {
  decision: "file" | "review" | "misc";
  matterId?: string;
  confidence: number;
  evidence: string[];
  candidates: string[];
}

export interface MatcherConfig {
  /** Firm domains (e.g. soullegal.com.au) for internal/external direction. */
  firmDomains: string[];
  /** Sender patterns that are never matter mail (system notifications, marketing). */
  miscSenders: RegExp[];
  miscSubjects: RegExp[];
}

export const DEFAULT_MISC: Pick<MatcherConfig, "miscSenders" | "miscSubjects"> = {
  miscSenders: [/no-?reply@/i, /notifications?@/i, /@practicepanther\.com$/i, /@receiptbank\.me$/i, /mailer-daemon@/i, /newsletter/i, /@.*\.(mailchimp|sendgrid)\./i, /calendar-notification@google\.com/i],
  miscSubjects: [/\bnewsletter\b/i, /\bwebinar\b/i, /\bCPD\b/, /\bunsubscribe\b/i, /^(accepted|declined|tentative):/i, /\bseminar\b/i, /New Client Enquiry/i],
};

const ACTION = /\b(civ|dc|sc|gda)\s*-?\s*(\d{1,6})\s*(?:of|\/)\s*(\d{4})\b/gi;
const domainOf = (email: string) => email.toLowerCase().split("@")[1] ?? "";
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ");

export function normaliseActionNumber(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(ACTION)) out.push(`${m[1]!.toLowerCase()} ${Number(m[2])} of ${m[3]}`);
  return out;
}

export function matchEmail(email: EmailFacts, index: MatterIndexEntry[], threadMatter: string | undefined, cfg: MatcherConfig): MatchDecision {
  const evidence: string[] = [];
  const subject = email.subject ?? "";
  const subj = words(subject);
  const text = `${subj} ${words(email.body.slice(0, 4000))}`;
  const all = [email.from, ...email.to, ...email.cc].map((a) => a.toLowerCase());
  const external = all.filter((a) => !cfg.firmDomains.includes(domainOf(a)));

  // 1. Thread already filed: the strongest signal.
  if (threadMatter && index.some((m) => m.matterId === threadMatter)) {
    return { decision: "file", matterId: threadMatter, confidence: 0.99, evidence: ["thread previously filed to this matter"], candidates: [threadMatter] };
  }

  // 2. Court action number resolving to exactly one matter.
  const actions = normaliseActionNumber(`${subject} ${email.body.slice(0, 4000)}`);
  if (actions.length) {
    const hits = index.filter((m) => actions.some((a) => m.references.includes(a)));
    if (hits.length === 1) return { decision: "file", matterId: hits[0]!.matterId, confidence: 0.95, evidence: [`action number ${actions[0]}`], candidates: [hits[0]!.matterId] };
    if (hits.length > 1) evidence.push(`action number matches ${hits.length} matters`);
  }

  // 3. Matter number in the subject, corroborated by the client's surname.
  const numbers = new Set<string>();
  for (const m of subject.matchAll(/(?:^|[\s[(#:-])(\d{3,5})(?=\s*[-–\])]|\s*$|\s)/g)) numbers.add(String(Number(m[1])));
  const byNumber = index.filter((m) => numbers.has(m.number));
  const corroborated = byNumber.filter((m) => m.surnames.some((s) => new RegExp(`\\b${s}\\b`).test(text)));
  if (corroborated.length === 1) {
    const m = corroborated[0]!;
    return { decision: "file", matterId: m.matterId, confidence: 0.97, evidence: [`matter number ${m.number} with surname ${m.surnames[0]}`], candidates: [m.matterId] };
  }
  if (byNumber.length) evidence.push(`number ${[...numbers].join(", ")} without a corroborating surname`);

  // 4. A client surname in the subject that resolves to exactly one matter.
  const bySurname = index.filter((m) => m.surnames.some((s) => s.length >= 3 && new RegExp(`\\b${s}\\b`).test(subj)));
  if (bySurname.length === 1) {
    const m = bySurname[0]!;
    return { decision: "file", matterId: m.matterId, confidence: 0.9, evidence: [...evidence, `unique surname ${m.surnames[0]} in subject`], candidates: [m.matterId] };
  }
  if (bySurname.length > 1) evidence.push(`surname matches ${bySurname.length} matters (client may have several matters)`);

  // 5. Party email addresses: useful but not enough to file automatically.
  const byAddress = index.filter((m) => m.emails.some((e) => external.includes(e)));
  const candidates = [...new Set([...byNumber, ...bySurname, ...byAddress].map((m) => m.matterId))];
  if (byAddress.length) evidence.push(`party address on ${byAddress.length} matter(s)`);

  if (candidates.length) return { decision: "review", confidence: 0.5, evidence, candidates };

  // 6. Non-matter mail.
  if (cfg.miscSenders.some((r) => r.test(email.from)) || cfg.miscSubjects.some((r) => r.test(subject))) {
    return { decision: "misc", confidence: 0.9, evidence: ["system, marketing or administrative sender/subject"], candidates: [] };
  }
  if (!external.length) return { decision: "misc", confidence: 0.7, evidence: ["internal email naming no matter"], candidates: [] };
  return { decision: "review", confidence: 0.2, evidence: ["no matter evidence"], candidates: [] };
}

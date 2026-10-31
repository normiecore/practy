/**
 * `npm run demo`: Practy with a fictional sample firm, for previews. Data is held in memory and
 * lost when the demo stops. Refuses to run in production or with DATABASE_URL set.
 */
import { startDemo } from "./demo.js";

try {
  const demo = await startDemo();
  const { summary } = demo;
  const others = summary.staff.filter((u) => u.email !== summary.signInEmail);
  console.log(`Practy demo: ${summary.firmName}, ${summary.matters.length} matters of fictional sample data (held in memory, lost when you stop the demo).`);
  console.log(`  Open         ${demo.signInUrl}`);
  console.log(`  Sign in as   ${summary.signInEmail} (principal)`);
  console.log(`  Other staff  ${others.map((u) => `${u.email} (${u.roles.join(", ")})`).join(", ")}`);
  if (!demo.webBuilt) console.warn("The web app is not built, so only the API is served. Run npm run build:web, or start with npm run demo, which builds it.");
  const stop = () => void demo.close().finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (err) {
  console.error(`The demo did not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

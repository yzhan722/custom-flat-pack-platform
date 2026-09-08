import Link from "next/link";
import { Pill } from "@/components/Badges";
import { dateTime, money } from "@/lib/format";
import { listAllServiceCases } from "@/server/queries";

export default async function CasesPage() {
  const cases = await listAllServiceCases();
  const open = cases.filter((c) => c.status !== "closed" && c.status !== "resolved");
  const byCause = new Map<string, number>();
  for (const c of cases) byCause.set(c.cause ?? "unattributed", (byCause.get(c.cause ?? "unattributed") ?? 0) + 1);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">After-sales</h1>
      <p className="text-sm text-ink-soft">Targets: first human response within 1 working day, plan within 2. “Responded” and “resolved” are counted separately (FR-12).</p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="card p-3"><p className="text-2xl font-semibold">{open.length}</p><p className="text-xs text-ink-soft">open or awaiting resolution</p></div>
        <div className="card p-3"><p className="text-2xl font-semibold">{cases.filter((c) => c.severity === "safety").length}</p><p className="text-xs text-ink-soft">safety-related (all time)</p></div>
        <div className="card p-3"><p className="text-2xl font-semibold">{money(cases.reduce((a, c) => a + c.costCents, 0))}</p><p className="text-xs text-ink-soft">recorded case cost</p></div>
        <div className="card p-3 text-xs"><p className="font-semibold">By cause</p>{[...byCause.entries()].map(([k, v]) => <p key={k}>{k.replace(/_/g, " ")}: {v}</p>)}</div>
      </div>
      <section className="card p-0">
        <table className="table">
          <thead><tr><th className="pl-5">Case</th><th>Order</th><th>Part</th><th>Severity</th><th>Symptom</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td className="pl-5 font-mono text-xs">{c.id}</td>
                <td><Link href={`/admin/orders/${c.orderId}#cases`} className="underline">{c.orderId}</Link></td>
                <td className="font-mono text-xs">{c.partRef}</td>
                <td><Pill tone={c.severity === "safety" ? "bad" : c.severity === "blocking" ? "warn" : "neutral"}>{c.severity}</Pill></td>
                <td className="max-w-md text-xs">{c.symptom}</td>
                <td><Pill tone={c.status === "resolved" || c.status === "closed" ? "good" : c.status === "responded" ? "info" : "warn"}>{c.status}</Pill></td>
                <td className="text-xs text-ink-soft">{dateTime(c.createdAt)}</td>
              </tr>
            ))}
            {cases.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-sm text-ink-soft">No cases.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

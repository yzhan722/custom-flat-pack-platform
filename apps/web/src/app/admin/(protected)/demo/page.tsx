import Link from "next/link";
import { notFound } from "next/navigation";
import { ORDER_STATUS_LABELS } from "@cfp/core";
import { ActionForm } from "@/components/ActionForm";
import { EngineeringBadge, OrderStatusBadge, PaymentBadge } from "@/components/Badges";
import { CopyButton } from "@/components/CopyButton";
import { DEMO_CUSTOMER_ID, DEMO_ENQUIRY_NOTE, DEMO_STAGE_ORDER, demoToolsEnabled, type DemoStageKey } from "@/lib/demo";
import { money } from "@/lib/format";
import { adoptDemoIdentity, seedDemoOrders } from "@/server/actions/admin";
import { listAllOrders, listEnquiries, loadOrderBundle } from "@/server/queries";

export const dynamic = "force-dynamic";

const STAGES: Record<
  DemoStageKey,
  {
    n: string;
    title: string;
    titleZh: string;
    size: string;
    talkZh: string;
    talkEn: string;
    customerPath: (id: string, token: string) => string;
  }
> = {
  "demo:draft": {
    n: "1",
    title: "Configurator — still a draft",
    titleZh: "配置器草稿",
    size: "Open shelves · 900 × 600 × 350 mm · Melbourne 3000",
    talkZh: "从这里改宽度、层板、看三维和规则实时变化。强调：AI 只提允许字段的改动，从不直接写设计。",
    talkEn: "Change width and shelves; 3D, drawing, rules and price update live. Natural language only proposes allowed fields — it never writes a design.",
    customerPath: (id, t) => `/design/${id}?t=${t}`,
  },
  "demo:submitted": {
    n: "2",
    title: "Waiting for engineering",
    titleZh: "待工程复核",
    size: "Doors · 1500 × 750 × 450 mm · alcove measured · 3100",
    talkZh: "750 mm 必须墙体固定。三处宽度与踢脚线已记录，但照片/扫描尺寸永远不会升成生产数据。PASS 仍需人工批准。",
    talkEn: "750 mm needs wall restraint. Three widths and skirting are on the measurement record. Photo/scan sizes never become production data. Automated PASS still needs a human approval.",
    customerPath: (id, t) => `/orders/${id}?t=${t}`,
  },
  "demo:quoted": {
    n: "3",
    title: "Formal quote — customer can confirm",
    titleZh: "已正式报价",
    size: "Doors · 1200 × 600 mm · delivery 3000",
    talkZh: "报价由服务器重算。客户可付 10% 意向金（不启动生产），再逐项确认并签名。付款、工程、订单三条状态独立。",
    talkEn: "Quote is recomputed on the server. A 10% intent deposit does not start production. Confirmation stores a snapshot hash. Paid ≠ approved.",
    customerPath: (id, t) => `/orders/${id}/confirm?t=${t}`,
  },
  "demo:confirmed": {
    n: "4",
    title: "Paid — release gate open, not released",
    titleZh: "已确认已结清，尚未放行",
    size: "Doors · 1000 mm · settled",
    talkZh: "放行门槛逐条列出：确认版本、批准、结清、材料和产能。打开后台订单，指出还没点 Release。",
    talkEn: "The release gate lists every condition (confirmed version, approval, settled funds, materials, capacity). Do not click Release yet — this is the pause before the factory packet exists.",
    customerPath: (id, t) => `/orders/${id}?t=${t}`,
  },
  "demo:qc": {
    n: "5",
    title: "Shop floor — QC incomplete, dispatch blocked",
    titleZh: "质检进行中，出库被挡住",
    size: "Open shelves · 1800 mm · pickup",
    talkZh: "前 6 块板已检，其余未检。出库校验会列出缺项。说明标签、开料单、包装单都绑在不可变发布包上。",
    talkEn: "Only the first six panels are inspected, so dispatch lists blockers. Labels, cut-list and packing list belong to an immutable release — not the live catalogue.",
    customerPath: (id, t) => `/orders/${id}?t=${t}`,
  },
  "demo:delivered": {
    n: "6",
    title: "Delivered — assembly guide and QR",
    titleZh: "已交付，装配指南可用",
    size: "Doors · 1200 × 750 mm · anti-tip kit included",
    talkZh: "打开装配指南和公开 QR：只有步骤和板件，没有姓名、电话、付款。按板件编号反查步骤。",
    talkEn: "Open the assembly guide and the public QR. It is steps and part numbers only — no name, phone or payment. Look up a panel id to jump to its step.",
    customerPath: (id, t) => `/orders/${id}/assembly?t=${t}`,
  },
  "demo:aftersales": {
    n: "7",
    title: "After-sales — replacement copied from the original release",
    titleZh: "售后补件（从原发布包复制）",
    size: "Doors · 1500 × 750 mm · chipped door remake",
    talkZh: "补件不能重跑当前模板。一块门从原始发布包逐字复制，新的补件发布号，质检包装后单独发运，主订单仍停留在售后。",
    talkEn: "Replacement does not recompile the current template. One door is copied verbatim from the original packet, gets a new release key, and ships without moving the order out of after-sales.",
    customerPath: (id, t) => `/orders/${id}/support?t=${t}`,
  },
};

export default async function DemoPresenterPage() {
  if (!demoToolsEnabled()) notFound();
  const all = await listAllOrders();
  const demo = all.filter((o) => o.customerId === DEMO_CUSTOMER_ID);
  const byRef = new Map(demo.map((o) => [o.referralSource, o]));
  const bundles = await Promise.all(demo.map((o) => loadOrderBundle(o)));
  const bundleById = new Map(bundles.map((b) => [b.order.id, b]));
  const enquiry = (await listEnquiries()).find((e) => e.notes === DEMO_ENQUIRY_NOTE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Presenter script</p>
          <h1 className="text-2xl font-semibold tracking-tight">Demo pipeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Seeded orders are real workflow rows (review, quote, confirmation, release, QC, replacement) under customer{" "}
            <code className="font-mono text-xs">{DEMO_CUSTOMER_ID}</code>. Re-seeding wipes only those rows and rebuilds the same seven stages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={seedDemoOrders} submitLabel={demo.length ? "Reset demo pipeline" : "Seed demo pipeline"} submitClassName="btn-primary btn-sm" confirmText={demo.length ? "Replace the current demo orders with a fresh pipeline?" : undefined} />
          <ActionForm action={adoptDemoIdentity} submitLabel="Open My orders as demo customer" submitClassName="btn-secondary btn-sm" />
        </div>
      </div>

      <section className="card text-sm">
        <h2 className="font-semibold">How to run the room</h2>
        <ol className="mt-3 grid gap-3 md:grid-cols-2">
          <li>
            <p className="font-medium">1. 先后台，再客户</p>
            <p className="text-ink-soft">Stay signed in as staff in this tab. Use the customer links (they carry <code>?t=</code>) or “Open My orders as demo customer” in another tab.</p>
          </li>
          <li>
            <p className="font-medium">2. 空白路径用无痕窗口</p>
            <p className="text-ink-soft">
              For a live “I just arrived on the site” walk, open <Link href="/start" className="underline">/start</Link> in a private window: TV or postcode 2000 is refused and kept as an enquiry; 3000 + storage continues.
            </p>
          </li>
          <li>
            <p className="font-medium">3. 不要承诺目录已投产</p>
            <p className="text-ink-soft">Every order carries rule CAT-002. SKUs are provisional. Automated PASS is not a production release.</p>
          </li>
          <li>
            <p className="font-medium">4. 三条状态分开讲</p>
            <p className="text-ink-soft">Order status, engineering status and payment status are independent. Paid and confirmed still sit behind the release gate.</p>
          </li>
        </ol>
      </section>

      {demo.length === 0 ? (
        <section className="card">
          <p className="font-semibold">Nothing seeded yet</p>
          <p className="mt-1 text-sm text-ink-soft">Click “Seed demo pipeline”. It takes about half a minute: seven cabinets are compiled, quoted and walked through the real actions.</p>
        </section>
      ) : (
        <ol className="space-y-4">
          {DEMO_STAGE_ORDER.map((key) => {
            const meta = STAGES[key];
            const order = byRef.get(key);
            if (!order) {
              return (
                <li key={key} className="card border-amber-200 bg-amber-50 text-sm">
                  <p className="font-semibold">
                    {meta.n}. {meta.title}
                  </p>
                  <p className="mt-1">Missing — re-seed the pipeline.</p>
                </li>
              );
            }
            const bundle = bundleById.get(order.id);
            const token = order.accessToken;
            const customerHref = meta.customerPath(order.id, token);
            const staffHref = `/admin/orders/${order.id}`;
            const rel = bundleById.get(order.id)?.release;
            const replacement = bundle?.releases.find((r) => r.kind === "replacement");
            return (
              <li key={order.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-brand">
                      Stage {meta.n} · {meta.titleZh}
                    </p>
                    <h2 className="text-lg font-semibold">{meta.title}</h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {order.customerName} · {meta.size}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <OrderStatusBadge status={order.status} />
                    <EngineeringBadge status={order.engineeringStatus} />
                    <PaymentBadge status={order.paymentStatus} />
                  </div>
                </div>
                <p className="mt-3 text-sm">{meta.talkZh}</p>
                <p className="mt-1 text-sm text-ink-soft">{meta.talkEn}</p>
                {bundle?.quote ? <p className="mt-2 text-sm font-medium">Quote {money(bundle.quote.totalCents)} incl. GST</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={staffHref} className="btn-primary btn-sm">
                    Staff order
                  </Link>
                  <Link href={customerHref} className="btn-secondary btn-sm">
                    Customer view
                  </Link>
                  {order.status === "draft" ? (
                    <Link href={`/design/${order.id}?t=${token}`} className="btn-secondary btn-sm">
                      Configurator
                    </Link>
                  ) : null}
                  {order.status === "quoted" ? (
                    <Link href={`/orders/${order.id}?t=${token}`} className="btn-secondary btn-sm">
                      Quote + intent deposit
                    </Link>
                  ) : null}
                  {rel ? (
                    <>
                      <Link href={`/guide/${rel.releaseKey}`} className="btn-secondary btn-sm">
                        Public QR guide
                      </Link>
                      <Link href={`/admin/orders/${order.id}/release/${rel.releaseKey}/package`} className="btn-secondary btn-sm">
                        Release packet
                      </Link>
                    </>
                  ) : null}
                  {order.status === "delivered" || order.status === "aftersales" ? (
                    <Link href={`/orders/${order.id}/assembly?t=${token}`} className="btn-secondary btn-sm">
                      Assembly guide
                    </Link>
                  ) : null}
                  {replacement ? (
                    <Link href={`${staffHref}#replacement`} className="btn-secondary btn-sm">
                      Replacement {replacement.releaseKey}
                    </Link>
                  ) : null}
                  <CopyButton text={customerHref} label="Copy customer link" />
                </div>
                <p className="mt-2 font-mono text-[11px] text-ink-soft">
                  {order.id} · {ORDER_STATUS_LABELS[order.status].zh}
                  {rel ? ` · release ${rel.releaseKey}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <section className="card text-sm">
        <h2 className="font-semibold">Out-of-range enquiry (not an order)</h2>
        {enquiry ? (
          <>
            <p className="mt-1">
              {enquiry.contact} · TV unit · postcode {enquiry.postcode}
            </p>
            <p className="mt-1 text-ink-soft">{enquiry.reasons.join(" ")}</p>
            <Link href="/admin/enquiries" className="btn-secondary btn-sm mt-3">
              Enquiry log
            </Link>
          </>
        ) : (
          <p className="mt-1 text-ink-soft">Seed the pipeline to add Riley Hart’s TV / Sydney leftover, or walk /start yourself with purpose TV or postcode 2000.</p>
        )}
      </section>
    </div>
  );
}

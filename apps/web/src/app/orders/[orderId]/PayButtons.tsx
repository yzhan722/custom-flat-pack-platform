"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordCustomerPayment } from "@/server/actions/customer";
import { money } from "@/lib/format";

export function PayButtons({ orderId, depositCents, outstandingCents, depositPaid }: { orderId: string; depositCents: number; outstandingCents: number; depositPaid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pay = async (kind: "deposit" | "balance") => {
    setBusy(true);
    const res = await recordCustomerPayment(orderId, kind);
    setBusy(false);
    setMsg(res.ok ? res.message ?? "Recorded." : res.error ?? "Failed.");
    router.refresh();
  };
  if (outstandingCents <= 0) return <p className="text-sm text-emerald-800">Paid in full. Thank you.</p>;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-ink-soft">Pilot: payments are recorded here without a card gateway. Our team reconciles them against the bank before release.</p>
      <div className="flex flex-wrap gap-2">
        {!depositPaid && <button type="button" className="btn-primary" disabled={busy} onClick={() => pay("deposit")}>Pay 50% deposit — {money(depositCents)}</button>}
        {depositPaid && <button type="button" className="btn-primary" disabled={busy} onClick={() => pay("balance")}>Pay balance — {money(outstandingCents)}</button>}
      </div>
      {msg && <p className="text-ink-soft">{msg}</p>}
    </div>
  );
}

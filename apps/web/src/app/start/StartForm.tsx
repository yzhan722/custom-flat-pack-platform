"use client";

import { useActionState, useState } from "react";
import type { PurposeDefinition, Template } from "@cfp/core";
import { FormMessage, SubmitButton } from "@/components/ActionForm";
import { saveEnquiry, startOrder, type ActionState } from "@/server/actions/customer";

const INITIAL: ActionState = { ok: false };

export function StartForm({ purposes, templates, defaultTemplate }: { purposes: PurposeDefinition[]; templates: Template[]; defaultTemplate: string }) {
  const [state, action] = useActionState(startOrder, INITIAL);
  const [enquiryState, enquiryAction] = useActionState(saveEnquiry, INITIAL);
  const [purpose, setPurpose] = useState(purposes.find((p) => p.supported)?.id ?? "general_storage");
  const [postcode, setPostcode] = useState("");
  const [budget, setBudget] = useState("");
  const [timeframe, setTimeframe] = useState("1-3 months");
  const [install, setInstall] = useState(false);
  const [templateId, setTemplateId] = useState(defaultTemplate);
  const [delivery, setDelivery] = useState<"local_delivery" | "pickup">("local_delivery");
  const purposeDef = purposes.find((p) => p.id === purpose);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form action={action} className="card space-y-5">
        <div>
          <label className="label" htmlFor="purpose">What will the cabinet be used for?</label>
          <select id="purpose" name="purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
            <optgroup label="In the pilot range">
              {purposes.filter((p) => p.supported).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
            <optgroup label="Not in the pilot range">
              {purposes.filter((p) => !p.supported).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          </select>
          {purposeDef && !purposeDef.supported && <p className="mt-1 text-sm text-amber-800">{purposeDef.unsupportedReason}</p>}
        </div>

        <div>
          <span className="label">Structure</span>
          <div className="grid gap-2 md:grid-cols-2">
            {templates.map((t) => {
              const ok = t.supportedPurposes.includes(purpose as Template["supportedPurposes"][number]);
              return (
                <label key={t.id} className={`flex cursor-pointer gap-3 rounded-md border p-3 ${templateId === t.id ? "border-brand bg-brand-soft/40" : "border-line"} ${!ok ? "opacity-60" : ""}`}>
                  <input type="radio" name="templateId" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="mt-1" />
                  <span>
                    <span className="block font-medium">{t.name}</span>
                    <span className="block text-xs text-ink-soft">{t.description}</span>
                    {!ok && purposeDef?.supported && <span className="block text-xs text-amber-800">Not approved for this use.</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="postcode">Delivery postcode</label>
            <input id="postcode" name="postcode" className="input" inputMode="numeric" placeholder="e.g. 3000" value={postcode} onChange={(e) => setPostcode(e.target.value)} required />
            <p className="mt-1 text-xs text-ink-soft">Demo service area: 3000–3207.</p>
          </div>
          <div>
            <label className="label" htmlFor="deliveryMethod">Delivery</label>
            <select id="deliveryMethod" name="deliveryMethod" className="input" value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}>
              <option value="local_delivery">Local delivery to the door</option>
              <option value="pickup">I will pick up from the factory</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="width_mm">Rough width you have in mind (mm, optional)</label>
            <input id="width_mm" name="width_mm" className="input" inputMode="numeric" placeholder="600–1800" />
          </div>
          <div>
            <label className="label" htmlFor="budget">Budget (A$, optional)</label>
            <input id="budget" name="budget" className="input" inputMode="numeric" placeholder="e.g. 1500" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="timeframe">When do you want it?</label>
            <select id="timeframe" name="timeframe" className="input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option>As soon as possible</option>
              <option>1-3 months</option>
              <option>3-6 months</option>
              <option>Just exploring</option>
            </select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" name="needsInstallation" checked={install} onChange={(e) => setInstall(e.target.checked)} /> I would like professional installation / wall fixing
          </label>
        </div>

        <SubmitButton>Check and start designing</SubmitButton>
        <FormMessage state={state} />
      </form>

      <aside className="space-y-4">
        <div className="card text-sm">
          <p className="font-semibold">Why we ask first</p>
          <p className="mt-1 text-ink-soft">Every template is validated for specific uses, heights and a delivery radius. If we cannot make or deliver what you need, we tell you now rather than after you have configured it.</p>
        </div>
        {state.reasons?.length ? (
          <form action={enquiryAction} className="card space-y-3 text-sm">
            <p className="font-semibold">Leave your details instead</p>
            <p className="text-ink-soft">We keep enquiries we cannot serve yet and contact you if the range or service area changes. This does not create an order.</p>
            <input type="hidden" name="purpose" value={purpose} />
            <input type="hidden" name="postcode" value={postcode} />
            <input type="hidden" name="budget" value={budget} />
            <input type="hidden" name="timeframe" value={timeframe} />
            {install && <input type="hidden" name="needsInstallation" value="on" />}
            <input type="hidden" name="reasons" value={state.reasons.join("\n")} />
            <input name="contact" className="input" placeholder="Email or phone" required />
            <textarea name="notes" className="input min-h-20" placeholder="Anything else (optional)" />
            <SubmitButton className="btn-secondary">Keep my enquiry</SubmitButton>
            <FormMessage state={enquiryState} />
          </form>
        ) : null}
      </aside>
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/actions/customer";
import { cn } from "@/lib/format";

type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const INITIAL: ActionState = { ok: false };

/**
 * Wraps a server action so any server component can render a form with
 * pending state and result messages. Children are ordinary form fields.
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClassName = "btn-primary",
  confirmText,
  hideSubmit = false,
  encType,
}: {
  action: ServerAction;
  children?: React.ReactNode;
  className?: string;
  submitLabel?: string;
  submitClassName?: string;
  confirmText?: string;
  hideSubmit?: boolean;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  return (
    <form
      action={formAction}
      className={className}
      encType={encType}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      {!hideSubmit && <SubmitButton className={submitClassName}>{submitLabel ?? "Save"}</SubmitButton>}
      <FormMessage state={state} />
    </form>
  );
}

export function SubmitButton({ children, className = "btn-primary" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cn(className, "mt-3")} disabled={pending} aria-busy={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.error && !state.message && !state.reasons?.length) return null;
  return (
    <div className={cn("mt-3 rounded-md border px-3 py-2 text-sm", state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")} role="status">
      {state.error && <p className="font-medium">{state.error}</p>}
      {state.message && <p>{state.message}</p>}
      {state.reasons?.length ? (
        <ul className="mt-1 list-disc pl-5">
          {state.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {state.fieldErrors && (
        <ul className="mt-1 list-disc pl-5">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>
              <span className="font-mono text-xs">{k}</span>: {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

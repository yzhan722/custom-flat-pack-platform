import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { isAdmin } from "@/lib/auth";
import { adminLogin } from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Custom Flat-Pack</p>
        <h1 className="mt-1 text-xl font-semibold">Staff sign-in</h1>
        <p className="mt-1 text-sm text-ink-soft">Engineering review, quoting, production release and after-sales. Every action is recorded with the actor.</p>
        <ActionForm action={adminLogin} submitLabel="Sign in" className="mt-4 space-y-3">
          <input name="password" type="password" className="input" placeholder="Password" autoFocus required />
        </ActionForm>
        <p className="mt-4 text-xs text-ink-soft">Development default: <code>admin</code>. Set <code>ADMIN_PASSWORD</code> and <code>AUTH_SECRET</code> in <code>.env</code>.</p>
      </div>
    </main>
  );
}

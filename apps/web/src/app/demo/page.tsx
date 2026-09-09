import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { demoToolsEnabled } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** Easy-to-say URL for presenters; the script itself lives behind staff sign-in. */
export default async function DemoShortcutPage() {
  if (!demoToolsEnabled()) notFound();
  if (!(await isAdmin())) redirect("/admin/login");
  redirect("/admin/demo");
}

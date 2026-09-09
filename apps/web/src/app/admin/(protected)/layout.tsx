import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { adminLogout } from "@/server/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");
  return (
    <>
      <header className="no-print border-b border-line bg-stone-900 text-stone-100">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5 text-sm">
          <div className="flex items-center gap-5">
            <Link href="/admin" className="font-semibold">Back office</Link>
            {process.env.NODE_ENV !== "production" ? (
              <Link href="/admin/demo" className="text-amber-300 hover:text-white">Demo</Link>
            ) : null}
            <Link href="/admin/orders" className="text-stone-300 hover:text-white">Orders</Link>
            <Link href="/admin/cases" className="text-stone-300 hover:text-white">After-sales</Link>
            <Link href="/admin/enquiries" className="text-stone-300 hover:text-white">Enquiries</Link>
            <Link href="/admin/service-areas" className="text-stone-300 hover:text-white">Service area</Link>
            <Link href="/admin/catalog" className="text-stone-300 hover:text-white">Catalogue and rules</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-stone-300 hover:text-white">Storefront</Link>
            <form action={adminLogout}>
              <button type="submit" className="text-stone-300 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6">{children}</main>
    </>
  );
}

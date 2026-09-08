import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="no-print border-b border-line bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-6 w-6 rounded-sm bg-brand" aria-hidden />
          Custom Flat-Pack
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Pilot</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-ink-soft">
          <Link href="/templates" className="hover:text-ink">Templates</Link>
          <Link href="/#how" className="hover:text-ink">How it works</Link>
          <Link href="/orders" className="hover:text-ink">My orders</Link>
          <Link href="/start" className="btn-primary btn-sm">Start a design</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-ink-soft md:grid-cols-3">
        <div>
          <p className="font-semibold text-ink">Custom Flat-Pack (pilot)</p>
          <p className="mt-1">Low storage cabinets made to your width, delivered as labelled panels, numbered hardware bags and an order-specific guide.</p>
        </div>
        <div>
          <p className="font-semibold text-ink">Boundaries</p>
          <p className="mt-1">Indoor dry rooms only. Not for TVs, seating, kitchens, bathrooms, laundries, vehicles or wall-hung use. Cabinets 750 mm high must be restrained to the wall.</p>
        </div>
        <div>
          <p className="font-semibold text-ink">Your rights</p>
          <p className="mt-1">Made-to-order does not remove Australian Consumer Law guarantees. Faults and unsuitability are handled separately from change-of-mind.</p>
          <p className="mt-2"><Link href="/admin" className="underline">Staff sign-in</Link></p>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main className={`mx-auto w-full ${wide ? "max-w-[1400px]" : "max-w-6xl"} px-4 py-8`}>{children}</main>
      <SiteFooter />
    </>
  );
}

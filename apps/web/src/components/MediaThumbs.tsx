export function MediaThumbs({ refs }: { refs: string[] }) {
  const urls = refs.filter((r) => r.startsWith("/api/media/"));
  const other = refs.filter((r) => !r.startsWith("/api/media/"));
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Uploaded evidence" className="h-20 w-20 object-cover" />
            </a>
          ))}
        </div>
      )}
      {other.length > 0 && <p className="text-xs text-ink-soft">Other refs: {other.join(", ")}</p>}
    </div>
  );
}

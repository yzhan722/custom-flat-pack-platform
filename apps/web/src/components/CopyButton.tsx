"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setOk(true);
        window.setTimeout(() => setOk(false), 1600);
      }}
    >
      {ok ? "Copied" : label}
    </button>
  );
}

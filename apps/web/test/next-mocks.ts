import { vi } from "vitest";

/**
 * Minimal stand-ins for the request-scoped Next.js APIs so server actions can
 * run inside vitest against the in-memory database.
 */
export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT ${url}`);
  }
}

export const jar = {
  store: new Map<string, string>(),
  get(name: string) {
    const v = this.store.get(name);
    return v === undefined ? undefined : { name, value: v };
  },
  set(name: string, value: string) {
    this.store.set(name, value);
  },
  delete(name: string) {
    this.store.delete(name);
  },
  clear() {
    this.store.clear();
  },
};

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

export function form(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
  return fd;
}

export async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof RedirectSignal) return err.url;
    throw err;
  }
  throw new Error("Expected a redirect");
}

import { Sidebar } from "@/components/Sidebar";
import { requireAdminActor } from "@/lib/viz-admin-verify";
import { headers } from "next/headers";

/** Avoid build-time prerender when Supabase env is not available (e.g. first Vercel deploy). */
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const loginNext = headerStore.get("x-orsight-admin-next") || "/";
  const actor = await requireAdminActor(loginNext);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 text-slate-900">
      <Sidebar
        currentAdmin={{
          displayName: actor.displayName,
          identifier: actor.identifier,
        }}
      />
      <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1480px] px-4 py-4 lg:px-5 lg:py-5">
          {children}
        </div>
      </main>
    </div>
  );
}

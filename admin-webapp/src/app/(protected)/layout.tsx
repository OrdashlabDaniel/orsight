import { Sidebar } from "@/components/Sidebar";

/** Avoid build-time prerender when Supabase env is not available (e.g. first Vercel deploy). */
export const dynamic = "force-dynamic";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">
        <div className="mx-auto w-[80%] max-w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

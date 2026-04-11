import { UserNav } from "@/components/UserNav";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-h-[600px] flex-col">
      <UserNav />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

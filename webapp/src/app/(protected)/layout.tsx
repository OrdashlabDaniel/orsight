import { UserNav } from "@/components/UserNav";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UserNav />
      {children}
    </>
  );
}

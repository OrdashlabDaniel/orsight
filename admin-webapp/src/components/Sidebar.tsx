"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LayoutDashboard, Users, LogOut } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Users", href: "/users", icon: Users },
  ];

  return (
    <div className="flex flex-col w-64 bg-slate-900 text-white min-h-screen">
      <div className="p-6">
        <h1 className="text-2xl font-bold tracking-wider">OrSight Admin</h1>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-xl transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </div>
  );
}

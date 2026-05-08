"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Users,
} from "lucide-react";

type SidebarProps = {
  currentAdmin: {
    displayName: string;
    identifier: string;
  };
};

const SIDEBAR_STATE_STORAGE_KEY = "orsight-admin-sidebar-collapsed";

export function Sidebar({ currentAdmin }: SidebarProps) {
  const pathname = usePathname();
  const isAccountActive = pathname === "/account";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setIsCollapsed(window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY) === "1");
      setHasLoadedPreference(true);
    });
  }, []);

  useEffect(() => {
    if (!hasLoadedPreference) {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, isCollapsed ? "1" : "0");
  }, [hasLoadedPreference, isCollapsed]);

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Users", href: "/users", icon: Users },
    { name: "Billing", href: "/billing", icon: CreditCard },
    { name: "Usage Board", href: "/usage-board", icon: BarChart3 },
  ];

  return (
    <aside
      className={`flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-900 transition-all duration-200 ${
        isCollapsed ? "w-[5.25rem]" : "w-[15rem]"
      }`}
    >
      <div className={`border-b border-slate-200 ${isCollapsed ? "px-3 py-4" : "px-4 py-4"}`}>
        <div className={`flex items-start ${isCollapsed ? "justify-center" : "justify-between"} gap-3`}>
          <div className={`flex items-start gap-3 ${isCollapsed ? "justify-center" : ""}`}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-sm font-semibold tracking-[0.16em] text-white shadow-sm">
              OA
            </div>
            {!isCollapsed ? (
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  OrSight Admin
                </p>
                <h1 className="mt-1.5 text-[1.45rem] font-semibold tracking-tight text-slate-900">OrSight Console</h1>
              </div>
            ) : null}
          </div>
          {!isCollapsed ? (
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="rounded-xl border border-slate-300 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {!isCollapsed ? (
          <p className="mt-3 text-[13px] leading-6 text-slate-600">
            Operations, billing, and usage in the same visual language as the main product.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="mt-3 flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className={`flex-1 space-y-1.5 ${isCollapsed ? "px-2 py-4" : "px-3 py-4"}`}>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.name}
              className={`flex items-center gap-3 rounded-xl transition-colors ${
                isCollapsed
                  ? "justify-center px-0 py-3"
                  : "px-3.5 py-2.5"
              } ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {!isCollapsed ? <span className="text-[13px] font-medium">{item.name}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-slate-200 ${isCollapsed ? "px-2 py-3" : "p-3"}`}>
        <Link
          href="/account"
          title="Admin account"
          className={`mb-2 flex items-center gap-3 transition-colors ${
            isCollapsed
              ? "justify-center rounded-xl px-0 py-3"
              : "rounded-xl px-3 py-3"
          } ${
            isAccountActive
              ? "border border-slate-200 bg-slate-50 text-slate-900"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm">
            <UserRound className="h-4.5 w-4.5" />
          </div>
          {!isCollapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-slate-900">{currentAdmin.displayName}</p>
              <p className="truncate text-[11px] text-slate-500">{currentAdmin.identifier}</p>
            </div>
          ) : null}
        </Link>

        <form action="/auth/logout" method="post">
          <button
            type="submit"
            title="Sign out"
            className={`flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 ${
              isCollapsed ? "justify-center px-0 py-3" : "px-3 py-2.5"
            }`}
          >
            <LogOut className="h-4.5 w-4.5" />
            {!isCollapsed ? <span className="text-[13px] font-medium">Sign Out</span> : null}
          </button>
        </form>
      </div>
    </aside>
  );
}

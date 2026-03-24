import { createAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";

export default async function UserDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const userId = resolvedParams.id;
  const supabase = await createAdminClient();

  // Fetch user details
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const user = userData?.user;

  // Fetch user's usage logs
  const { data: logs } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (!user) {
    return (
      <div className="space-y-6">
        <div className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200">
          User not found.
        </div>
        <Link href="/users" className="text-blue-600 hover:underline flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/users" className="p-2 text-slate-500 hover:bg-slate-200 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{user.email}</h1>
          <p className="mt-1 text-slate-600">Detailed usage history</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-6 py-4">Date & Time</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Model</th>
                <th className="px-6 py-4 text-right">Images</th>
                <th className="px-6 py-4 text-right">Prompt Tokens</th>
                <th className="px-6 py-4 text-right">Completion Tokens</th>
                <th className="px-6 py-4 text-right">Total Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs?.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-slate-600">
                    {format(new Date(log.created_at), "MMM d, yyyy HH:mm:ss")}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-900">{log.action_type}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-xs font-medium text-slate-700">
                      {log.model_used}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.image_count}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.prompt_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-slate-600">{log.completion_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">{log.total_tokens.toLocaleString()}</td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    No usage logs found for this user.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

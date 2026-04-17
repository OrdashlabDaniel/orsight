import { createAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { format } from "date-fns";

const PRICING = {
  "gpt-4o-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  "gpt-4o": { prompt: 0.005 / 1000, completion: 0.015 / 1000 },
  "gpt-5-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  "gpt-5": { prompt: 0.005 / 1000, completion: 0.015 / 1000 },
};

export default async function UsersPage() {
  const supabase = await createAdminClient();

  // Fetch all users via SQL RPC so a single broken auth row does not break the whole page.
  const { data: usersData } = await supabase.rpc("list_registered_users");
  const users =
    ((usersData ?? []) as Array<{ id: string; email: string | null; created_at: string | null; pod_username?: string | null }>) ||
    [];

  // Fetch all usage logs
  const { data: logs } = await supabase.from("usage_logs").select("*");

  // Aggregate usage per user
  const userUsage = new Map<string, { images: number; tokens: number; cost: number }>();

  if (logs) {
    logs.forEach((log) => {
      const current = userUsage.get(log.user_id) || { images: 0, tokens: 0, cost: 0 };
      
      const model = log.model_used as keyof typeof PRICING;
      const rates = PRICING[model] || PRICING["gpt-4o-mini"];
      const promptCost = (log.prompt_tokens || 0) * rates.prompt;
      const completionCost = (log.completion_tokens || 0) * rates.completion;

      userUsage.set(log.user_id, {
        images: current.images + (log.image_count || 0),
        tokens: current.tokens + (log.total_tokens || 0),
        cost: current.cost + promptCost + completionCost,
      });
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Users & Usage</h1>
        <p className="mt-2 text-slate-600">View all registered users and their API consumption.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Registered</th>
                <th className="px-6 py-4 text-right">Images Processed</th>
                <th className="px-6 py-4 text-right">Tokens Used</th>
                <th className="px-6 py-4 text-right">Est. Cost</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((user) => {
                const usage = userUsage.get(user.id) || { images: 0, tokens: 0, cost: 0 };
                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">{user.email || user.id}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {user.created_at ? format(new Date(user.created_at), "MMM d, yyyy") : "-"}
                    </td>
                    <td className="px-6 py-4 text-right text-slate-600">{usage.images.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-slate-600">{usage.tokens.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-slate-900 font-medium">
                      ${usage.cost.toFixed(4)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link 
                        href={`/users/${user.id}`}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No users found. Ensure SUPABASE_SERVICE_ROLE_KEY is set correctly.
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

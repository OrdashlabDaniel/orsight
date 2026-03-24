import { createAdminClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Image as ImageIcon, Zap, DollarSign } from "lucide-react";

// Approximate pricing per 1K tokens (as of early 2024, adjust as needed)
// gpt-4o-mini: $0.00015 / 1K prompt, $0.0006 / 1K completion
const PRICING = {
  "gpt-4o-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  "gpt-4o": { prompt: 0.005 / 1000, completion: 0.015 / 1000 },
  "gpt-5-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 }, // Assuming same as 4o-mini for now
  "gpt-5": { prompt: 0.005 / 1000, completion: 0.015 / 1000 }, // Assuming same as 4o for now
};

export default async function Dashboard() {
  const supabase = await createAdminClient();

  // Fetch total users
  const { count: totalUsers } = await supabase
    .from("users") // Note: auth.users is not directly queryable via standard client sometimes, but we can query auth.users if we use service role, or we can just count distinct user_ids in usage_logs. Let's try auth.users first.
    .select("*", { count: "exact", head: true });

  // Fetch usage logs
  const { data: logs } = await supabase
    .from("usage_logs")
    .select("*");

  let totalImages = 0;
  let totalTokens = 0;
  let totalCost = 0;

  if (logs) {
    logs.forEach((log) => {
      totalImages += log.image_count || 0;
      totalTokens += log.total_tokens || 0;

      const model = log.model_used as keyof typeof PRICING;
      const rates = PRICING[model] || PRICING["gpt-4o-mini"]; // fallback
      
      const promptCost = (log.prompt_tokens || 0) * rates.prompt;
      const completionCost = (log.completion_tokens || 0) * rates.completion;
      totalCost += promptCost + completionCost;
    });
  }

  // If auth.users query fails due to schema restrictions, we can count unique users in logs
  const uniqueActiveUsers = new Set(logs?.map(l => l.user_id)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard Overview</h1>
        <p className="mt-2 text-slate-600">Monitor system usage and estimated costs.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-slate-600">Active Users</CardTitle>
            <Users className="w-4 h-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{uniqueActiveUsers}</div>
            <p className="text-xs text-slate-500 mt-1">Users with usage records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-slate-600">Images Processed</CardTitle>
            <ImageIcon className="w-4 h-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalImages.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Total images analyzed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-slate-600">Tokens Consumed</CardTitle>
            <Zap className="w-4 h-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalTokens.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Total OpenAI tokens used</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-slate-600">Estimated Cost</CardTitle>
            <DollarSign className="w-4 h-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">${totalCost.toFixed(4)}</div>
            <p className="text-xs text-slate-500 mt-1">Based on API pricing</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

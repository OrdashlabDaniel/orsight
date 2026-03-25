import { createAdminClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aggregateUsageLogs } from "@/lib/usage-metrics";
import { Users, Image as ImageIcon, Zap, DollarSign } from "lucide-react";

export default async function Dashboard() {
  const supabase = await createAdminClient();

  const { data: logs } = await supabase.from("usage_logs").select("*");
  const agg = aggregateUsageLogs(logs ?? []);
  const { totalImages, totalTokens, totalCost, uniqueActiveUsers } = agg;

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

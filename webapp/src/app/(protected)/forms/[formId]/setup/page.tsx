import { notFound } from "next/navigation";

import { FormSetupFlow } from "@/components/FormSetupFlow";
import { getFormById } from "@/lib/forms-store";
import { runWithResolvedStorageContext } from "@/lib/storage-tenant";

type PageProps = {
  params: Promise<{ formId: string }>;
};

export default async function FormSetupPage({ params }: PageProps) {
  return await runWithResolvedStorageContext(async () => {
    const { formId } = await params;
    const form = await getFormById(formId);
    if (!form || form.deletedAt) {
      notFound();
    }

    return <FormSetupFlow initialForm={form} />;
  });
}

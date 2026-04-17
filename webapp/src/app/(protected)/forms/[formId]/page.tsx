import { notFound, redirect } from "next/navigation";

import { buildFormFillHref, buildFormSetupHref } from "@/lib/forms";
import { getFormById } from "@/lib/forms-store";
import { resolveStorageTenantId, runWithStorageTenant } from "@/lib/storage-tenant";

type PageProps = {
  params: Promise<{ formId: string }>;
};

export default async function FormDetailPage({ params }: PageProps) {
  const tenantId = await resolveStorageTenantId();
  return await runWithStorageTenant(tenantId, async () => {
    const { formId } = await params;
    const form = await getFormById(formId);
    if (!form || form.deletedAt) {
      notFound();
    }

    redirect(form.ready ? buildFormFillHref(form.id) : buildFormSetupHref(form.id));
  });
}

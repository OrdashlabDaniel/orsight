import { notFound } from "next/navigation";

import { FormSetupClient } from "@/components/FormSetupClient";
import { getFormById } from "@/lib/forms-store";

type PageProps = {
  params: Promise<{ formId: string }>;
};

export default async function FormSetupPage({ params }: PageProps) {
  const { formId } = await params;
  const form = await getFormById(formId);
  if (!form || form.deletedAt) {
    notFound();
  }

  return <FormSetupClient initialForm={form} />;
}

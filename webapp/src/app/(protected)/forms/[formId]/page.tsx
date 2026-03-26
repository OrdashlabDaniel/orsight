import { notFound, redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ formId: string }>;
};

export default async function FormDetailPage({ params }: PageProps) {
  const { formId } = await params;
  if (formId === "form-1") {
    redirect("/");
  }
  if (formId === "form-2") {
    redirect("/forms");
  }
  if (formId !== "form-1" && formId !== "form-2") {
    notFound();
  }
  return null;
}

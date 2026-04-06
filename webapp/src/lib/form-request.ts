import { DEFAULT_FORM_ID, normalizeFormId } from "@/lib/forms";

export function getFormIdFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  return normalizeFormId(searchParams.get("formId") || DEFAULT_FORM_ID);
}

export function getFormIdFromFormData(formData: FormData) {
  const raw = formData.get("formId");
  return normalizeFormId(typeof raw === "string" ? raw : DEFAULT_FORM_ID);
}

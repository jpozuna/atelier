import { notFound } from "next/navigation";
// Imported from its own file, never from the index, so the synthetic fixture stays out of the /compare bundle.
import { CompareDemo } from "@/components/compare/CompareDemo";

// Dev-only preview of the comparison on a synthetic run and a fake model. No API call, no storage. The manager may move it
// to /dev/compare.
export default function ComparePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CompareDemo />;
}

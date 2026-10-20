import { notFound } from "next/navigation";
// Imported from its own file, never from the index, so the synthetic fixture stays out of the /picks bundle.
import { PicksDemo } from "@/components/deck/PicksDemo";

// Dev-only preview of the picks screen on a synthetic run. The manager may move it to /dev/picks.
export default function PicksPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PicksDemo />;
}

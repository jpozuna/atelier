import { notFound } from "next/navigation";
import { ReasoningDemo } from "@/components/reasoning";

// Dev-only preview of the reasoning panel on a synthetic trace.
export default function ReasoningDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ReasoningDemo />;
}

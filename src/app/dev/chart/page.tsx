import { notFound } from "next/navigation";
import { ChartDemo } from "@/components/chart";

// Dev-only preview of the attribute chart on synthetic data.
export default function ChartDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChartDemo />;
}

import type { Metadata } from "next";
import { CompareView } from "@/components/compare";

export const metadata: Metadata = {
  title: "Compare | Atelier",
};

export default function ComparePage() {
  return <CompareView />;
}

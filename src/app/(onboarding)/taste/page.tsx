import type { Metadata } from "next";
import { TasteView } from "@/components/onboarding";

export const metadata: Metadata = {
  title: "Your taste | Atelier",
};

export default function TastePage() {
  return <TasteView />;
}

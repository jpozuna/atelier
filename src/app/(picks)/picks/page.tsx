import type { Metadata } from "next";
import { PicksView } from "@/components/deck/PicksView";

export const metadata: Metadata = {
  title: "Your picks | Atelier",
};

export default function PicksPage() {
  return <PicksView />;
}

import type { Metadata } from "next";
import { PicksView } from "@/components/deck/PicksView";
import { PendingSave } from "@/components/reactions";

export const metadata: Metadata = {
  title: "Your picks | Atelier",
};

export default function PicksPage() {
  return (
    <PendingSave>
      <PicksView />
    </PendingSave>
  );
}

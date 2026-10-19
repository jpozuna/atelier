import { notFound } from "next/navigation";
import { CardDemo } from "@/components/card";

// Dev-only preview of the pick card on synthetic data.
export default function CardDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CardDemo />;
}

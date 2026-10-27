import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { COPY } from "@/components/onboarding/copy";
import styles from "@/components/onboarding/Onboarding.module.css";

export const metadata: Metadata = {
  title: "What do you love? | Atelier",
};

export default function StartPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{COPY.title}</h1>
      <p className={styles.lede}>{COPY.intro}</p>
      <OnboardingFlow />
    </div>
  );
}

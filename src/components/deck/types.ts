// Type-only imports from the server modules, so client code never pulls server code into the bundle.
import type { Axis } from "@/types";
import type { Profile, ProfileSeed } from "@/lib/profile/types";
import type { DomainResult, PublicPick } from "@/lib/agent/types";

export type { Axis, Band, Card, Field, Pick, Reaction, TraceEvent } from "@/types";
export type { Profile, ProfileSeed } from "@/lib/profile/types";
export type { DomainResult, DomainStatus, PublicPath, PublicPick, PublicRunResult, RunPlan } from "@/lib/agent/types";

/** One field's result as the browser receives it. */
export type PublicDomain = DomainResult<PublicPick>;

/** What the picks screen needs of the onboarding result (the stored taste session has these and a trace). */
export interface RunInputs {
  seeds: ProfileSeed[];
  profile: Profile;
  axes: Axis[];
}

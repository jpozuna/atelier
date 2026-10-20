// Type-only imports from the server modules, so client code never pulls server code into the bundle.
export type { Field, Axis, Seed, TraceEvent } from "@/types";
export type { ProfileSeed, WhyTag, Profile } from "@/lib/profile/types";

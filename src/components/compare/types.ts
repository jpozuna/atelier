import type { Field } from "@/types";

/** What the plain model sees of one thing the user named: the field, what they typed and their reason. Nothing else. */
export interface CompareSeed {
  field: Field;
  typed: string;
  why: string;
}

export interface CompareRequest {
  seeds: CompareSeed[];
  fields: Field[];
}

/** One pick from the plain model. Words only: no id, no number, no link. */
export interface PlainPick {
  name: string;
  field: Field;
  /** One line, in the model's own words. Not retrieved from anywhere. */
  why: string;
}

export type CompareErrorCode = "bad_request" | "model_off" | "upstream" | "unusable";

export interface CompareResponse {
  picks: PlainPick[];
}

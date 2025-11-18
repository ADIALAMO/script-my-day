// /lib/types.ts

export type Genre =
  | "drama"
  | "action"
  | "comedy"
  | "horror"
  | "romance"
  | "thriller"
  | "comic";

export interface ScriptResult {
  success: boolean;
  output?: string; // Full script text as returned by the LLM
  error?: string;
}

export const GENRES = [
  "drama",
  "action",
  "comedy",
  "horror",
  "romance",
  "thriller",
  "sci-fi"
] as const;

export type Genre = (typeof GENRES)[number];

export interface ScriptResult {
  success: boolean;
  output?: string;
  model?: string;
  error?: string;
}

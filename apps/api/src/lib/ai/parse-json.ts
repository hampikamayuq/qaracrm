// Some models wrap JSON responses in markdown fences despite response_format:
// json_object or explicit "no markdown" instructions. Strip before parsing so
// that quirk doesn't silently trigger a caller's fallback path.
export const stripJsonFences = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
};

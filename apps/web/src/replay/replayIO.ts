/**
 * Browser-side glue for downloading and uploading replay JSON. Keeps the
 * Blob / FileReader / `<input type=file>` plumbing out of the React UI so
 * components stay focused on render and store updates.
 */

import {
  parseReplay,
  serializeReplay,
  type Replay,
} from "@starship-catch-sim/physics";

/** Trigger a browser download of `replay` as a JSON file. */
export function downloadReplay(replay: Replay, filename?: string): void {
  const json = serializeReplay(replay);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename ?? defaultFilename(replay);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Read a `File` selected by the user and parse it into a `Replay`. */
export async function readReplayFile(file: File): Promise<Replay> {
  const text = await file.text();
  return parseReplay(text);
}

function defaultFilename(replay: Replay): string {
  const safeTs = replay.header.createdAt.replace(/[:.]/g, "-");
  const outcome = replay.header.outcome?.kind ?? "no-outcome";
  return `replay-${replay.header.scenarioId}-${outcome}-${safeTs}.json`;
}

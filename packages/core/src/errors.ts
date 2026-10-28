export type ErrorCode =
  | "STALE_REVISION"
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "OVERLAP"
  | "NOTHING_TO_UNDO"
  | "NOTHING_TO_REDO"
  | "INVALID_PATH"
  | "PROBE_FAILED"
  | "IO_ERROR"
  | "UNSUPPORTED_VERSION"
  | "EDITOR_UNAVAILABLE";

export class EditError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EditError";
  }
}

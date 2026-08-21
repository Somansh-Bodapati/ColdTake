// Thrown from API route handlers (CLAUDE.md: "thrown AppError with a status
// code in API routes"). src/lib/http.ts catches these at the handler
// boundary and turns them into a JSON Response with the matching status.
export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/**
 * Custom application error with HTTP status code
 */
export class AppError extends Error {
  /**
   * Create a new AppError
   * @param message - Error message
   * @param statusCode - HTTP status code
   * @param code - Machine-readable error code
   */
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: import("../constants").ErrorCode,
    public details?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

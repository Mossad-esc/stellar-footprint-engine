export class StellarFootprintError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StellarFootprintError";
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
    Object.setPrototypeOf(this, StellarFootprintError.prototype);
  }
}

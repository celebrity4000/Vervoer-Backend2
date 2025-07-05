export class ApiError extends Error {
  public statusCode: number;
  public data: null;
  public success: boolean;
  public message: string;
  public errors: unknown[] | unknown;

  constructor(
    statusCode: number,
    message = "Something went wrong",
    errors: unknown[] | unknown= [],
    stack = ""
  ) {
    super(message);
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export const validateRequest = (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.errors.map((err) => ({
      message: err.message,
      path: err.path,
    }));

    return res.status(401).json({
      success: false,
      message: "Validation failed",
      errors,
    });
  }

  next();
};

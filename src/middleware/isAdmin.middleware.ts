import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/apierror.js";

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new ApiError(401, "Token missing");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    if (decoded.role !== "admin") throw new ApiError(403, "Unauthorized admin access");

    req.user = decoded; 
    next();
  } catch (error) {
    throw new ApiError(401, "Invalid token");
  }
};

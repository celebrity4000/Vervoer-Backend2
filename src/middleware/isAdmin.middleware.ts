import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/apierror.js";

export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return next(new ApiError(401, "Token missing"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    
    if (!decoded || decoded.role !== "admin") {
      return next(new ApiError(403, "Unauthorized admin access"));
    }

    req.user = decoded;
    next();
    
  } catch (error) {
    // jwt.verify throws if token is invalid/expired
    return next(new ApiError(401, "Invalid or expired token"));
  }
};
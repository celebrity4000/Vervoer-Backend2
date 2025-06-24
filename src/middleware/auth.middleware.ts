import { NextFunction, Request, Response } from "express";
import { verifyAuthentication } from "./verifyAuthhentication.js";
import { ApiError } from "../utils/apierror.js";

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authUser = await verifyAuthentication(req);
    (req as any).authUser = authUser;
    next();
  } catch (err) {
    next(err);
  }
};

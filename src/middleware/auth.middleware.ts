import { Request, Response, NextFunction } from "express";
import { verifyAuthentication } from "./verifyAuthhentication.js";

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authUser = await verifyAuthentication(req);
    // @ts-ignore: extend request object
    req.authUser = authUser;
    next();
  } catch (error) {
    next(error);
  }
};

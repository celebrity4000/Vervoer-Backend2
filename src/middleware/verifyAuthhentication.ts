import { Request } from "express";
import { jwtDecode } from "../utils/jwt.js";
import z from "zod";
import { ApiError } from "../utils/apierror.js";
import { IUser, User } from "../models/normalUser.model.js";
import { Driver, IDriver } from "../models/driver.model.js";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
type MUserRes = mongoose.Document<mongoose.Types.ObjectId , {}, IUser> & IUser ;
type MMerchentRes = mongoose.Document<mongoose.Types.ObjectId , {}, IMerchant> & IUser ;
type MDriverRes = mongoose.Document<mongoose.Types.ObjectId , {}, IDriver> & IUser ;
type VerifyAuthReturn = {user : MUserRes , userType : "user"} | {user : MMerchentRes , userType : "merchant"} | {user : MDriverRes, userType : "driver"}

export async function verifyAuthentication(req: Request):Promise<VerifyAuthReturn> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new ApiError(401, "UNAVAILABLE_AUTHORIZATION");
    }

    // Strip Bearer prefix
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const rawDecode = jwtDecode(token);

    // Decode & Validate structure
    const decode = z
      .object({
        userId: z.string(),
        userType: z.enum(["user", "merchant", "driver"]),
      })
      .parse(jwtDecode(token));

    switch (decode.userType) {
      case "user":
        const fUser: MUserRes| null = await User.findById(decode.userId);
        if (!fUser) {
          throw new ApiError(401, "UNKNOWN_USER");
        }
        return { user: fUser, userType: "user" };

      case "driver":
        const dUser: MDriverRes| null = await Driver.findById(decode.userId);
        if (!dUser) {
          throw new ApiError(401, "UNKNOWN_USER");
        }
        return { user: dUser, userType: "driver" };
      case "merchant":
        const mUser: MMerchentRes| null = await Merchant.findById(decode.userId);
        if (!mUser) {
          throw new ApiError(401, "UNKNOWN_USER");
        }
        return { user: mUser, userType: "merchant" };

      default:
        throw new ApiError(401, "UNKNOWN_USERTYPE");
    }
    
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(400, "TOKEN_EXPIRED");
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "UNAUTHORIZED_ACCESS", error);
    } else if (error instanceof z.ZodError) {
      throw new ApiError(401, "UNKNOWN_TOKEN");
    }
    throw error;
  }
}

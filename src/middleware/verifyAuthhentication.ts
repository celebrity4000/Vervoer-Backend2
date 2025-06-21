import { NextFunction, Request, Response } from "express";
import { jwtDecode } from "../utils/jwt.js";
import z from "zod/v4"
import { ApiError } from "../utils/apierror.js";
import { IUser, User } from "../models/normalUser.model.js";
import { Driver } from "../models/driver.model.js";
import { Merchant } from "../models/merchant.model.js";
import jwt from "jsonwebtoken";
export async function verifyAuthentication(req: Request){
    try {
        const token = req.headers.authorization 
        console.log(token) ;
        if(!token){
            throw new ApiError(401,"UNAVAILABLE_AUTHORIZATION") ;
        }
        const decode = z.object({
            userId : z.string(),
            userType : z.enum(["user", "merchant" , "driver"])
        }).parse(jwtDecode(token));
        
        switch (decode.userType) {
            case "user":
                const fUser = await User.findById(decode.userId) ;
                if(!fUser){
                    throw new ApiError(401, "UNKNOWN_USER") ;
                }
                return {user : fUser, userType : "user"};
            case "driver" : 
                const dUser = await Driver.findById(decode.userId) ;
                if(!dUser){
                    throw new ApiError(401, "UNKNOWN_USER") ;
                }
                return {user : dUser , userType : "driver"} ;
            case "merchant" :
                const mUser = await Merchant.findById(decode.userId) ;
                if(!mUser){
                    throw new ApiError(401, "UNKNOWN_USER") ;
                }
                return {user : mUser , userType : "merchant"} ;
            default:
                throw new ApiError(401 , "UNKNOWN_USERTYPE");
                break;
        }
    } catch (error) {
        if(error instanceof jwt.TokenExpiredError){
            throw new ApiError(400, "TOKEN_EXPIRED")
        }else if (error instanceof jwt.JsonWebTokenError){
            throw new ApiError(401 , "UNAUTHORIZED_ACCESS") ;
        }else if(error instanceof z.ZodError){
            throw new ApiError(401, "UNKNOWN_TOKEN") ;
        }
    }
}
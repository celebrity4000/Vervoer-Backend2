import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "./apirespone.js";
import { ApiError } from "./apierror.js";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> | Promise<ApiResponse<any>> ;

export const asyncHandler = (requestHandler: AsyncRequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(requestHandler(req, res, next)).then(e => e && res.status(e.statusCode).json(e)).catch((err) => {
      if(err instanceof ApiError){
        res.status(err.statusCode).json(err) ;
      }else{
        res.status(500).json(new ApiError(500, "INTERNAL_SERVER_ERROR", err)) ;
      }
    });
  };
};

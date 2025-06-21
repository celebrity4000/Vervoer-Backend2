import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";





export const registerDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const rData = z.object({
        name: z.string(),
        address: z.string(),
        contactPerson: z.string(),
        phoneNumber: z.string(),
        image: z.string().optional(),
        hoursOfOperation: z.array(
          z.object({
            day: z.string(),
            open: z.string(),
            close: z.string(),
          })
        ),
        services: z.array(
          z.object({
            name: z.string(),
            category: z.string(),
            price: z.number().optional(),
            options: z.array(z.string()).optional(),
          })
        ),
      }).parse(req.body);

      const newDryCleaner = await DryCleaner.create(rData);
      res.status(201).json(new ApiResponse(201, { dryCleaner: newDryCleaner }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiError(400, "DATA VALIDATION", err.issues);
      }
      throw err;
    }
  } 
);
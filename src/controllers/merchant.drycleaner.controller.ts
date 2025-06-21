import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";

export const registerDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const rData = z
        .object({
          shopname: z.string(),
          address: z.string(),
          rating: z.number().optional(),
          about: z.string().optional(),
          contactPerson: z.string(),
          phoneNumber: z.string(),
          contactPersonImg: z.string().optional(),
          shopimage: z.array(z.string()).optional(),
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
              strachLevel: z.enum(["1", "2", "3", "4", "5"]).optional(),
              washOnly: z.boolean().optional(),
              additionalservice: z.enum(["zipper", "button", "wash/fold"]).optional(),
              price: z.number().optional(),
            })
          ),
          orders: z
            .array(
              z.object({
                serviceName: z.string(),
                quantity: z.number(),
                price: z.number(),
                status: z.enum(["active", "completed"]),
              })
            )
            .optional(),
        })
        .parse(req.body);

      const newDryCleaner = await DryCleaner.create(rData);

      res.status(201).json(new ApiResponse(201, { dryCleaner: newDryCleaner }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiError(400, "DATA VALIDATION ERROR", err.issues);
      }
      throw err;
    }
  }
);

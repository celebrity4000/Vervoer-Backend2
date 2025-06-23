import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";

export const registerDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Validate incoming data
      const rData = z
        .object({
          shopname: z.string(),
          address: z.string(),
          rating: z.number().optional(),
          about: z.string().optional(),
          contactPerson: z.string(),
          phoneNumber: z.string(),
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
        })
        .parse(req.body);

      // Upload contactPersonImg if provided
      let contactPersonImgUrl: string | undefined;
      if (req.files && "contactPersonImg" in req.files) {
        const file = (req.files as any).contactPersonImg[0];
        const result = await uploadToCloudinary(file.buffer);
        contactPersonImgUrl = result.secure_url;
      }

      // Upload shop images if any
      const shopImagesUrls: string[] = [];
      if (req.files && "shopimage" in req.files) {
        const files = (req.files as any).shopimage;
        for (const file of files) {
          const result = await uploadToCloudinary(file.buffer);
          shopImagesUrls.push(result.secure_url);
        }
      }

      // Create new DryCleaner document with empty orders
      const newDryCleaner = await DryCleaner.create({
        ...rData,
        contactPersonImg: contactPersonImgUrl,
        shopimage: shopImagesUrls,
        orders: [], // always empty initially
      });

      res.status(201).json(
        new ApiResponse(
          201,
          { dryCleaner: newDryCleaner },
          "Dry Cleaner registered successfully."
        )
      );
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiError(400, "DATA VALIDATION ERROR", err.issues);
      }
      throw err;
    }
  }
);

import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";

const dryCleanerSchema = z.object({
  shopname: z.string(),
  address: z.string(),
  rating: z.coerce.number().optional(),  
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
      strachLevel: z.union([z.string(), z.number()]).optional(),
      washOnly: z.coerce.boolean().optional(),
      additionalservice: z.enum(["zipper", "button", "wash/fold"]).optional(),
      price: z.coerce.number().optional(),
    })
  ),
});


export const registerDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
    try {
     
      if (typeof req.body.hoursOfOperation === "string") {
        req.body.hoursOfOperation = JSON.parse(req.body.hoursOfOperation);
      }
      if (typeof req.body.services === "string") {
        req.body.services = JSON.parse(req.body.services);
      }

      
      const rData = dryCleanerSchema.parse(req.body);


      let contactPersonImgUrl: string | undefined;
      if (req.files && "contactPersonImg" in req.files) {
        const file = (req.files as any).contactPersonImg[0];
        const result = await uploadToCloudinary(file.buffer);
        contactPersonImgUrl = result.secure_url;
      }

      const shopImagesUrls: string[] = [];
      if (req.files && "shopimage" in req.files) {
        const files = (req.files as any).shopimage;
        for (const file of files) {
          const result = await uploadToCloudinary(file.buffer);
          shopImagesUrls.push(result.secure_url);
        }
      }

      const newDryCleaner = await DryCleaner.create({
        ...rData,
        contactPersonImg: contactPersonImgUrl,
        shopimage: shopImagesUrls,
        orders: [],
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



// contactperon edit
export const updateDryCleanerContactDetails = asyncHandler(async (req: Request, res: Response) => {
  const { dryCleanerId } = req.params;

  
  const dryCleaner = await DryCleaner.findById(dryCleanerId);
  if (!dryCleaner) {
    throw new ApiError(404, "Dry cleaner not found");
  }

  
  if (req.files && "contactPersonImg" in req.files) {
    const file = (req.files as any).contactPersonImg[0];
    const result = await uploadToCloudinary(file.buffer);
    dryCleaner.contactPersonImg = result.secure_url;
  }
  
  if (req.body.contactPerson) {
    dryCleaner.contactPerson = req.body.contactPerson;
  }

  if (req.body.phoneNumber) {
    dryCleaner.phoneNumber = req.body.phoneNumber;
  }

  await dryCleaner.save();

  res.status(200).json(
    new ApiResponse(200, { dryCleaner }, "Contact details updated successfully.")
  );
});

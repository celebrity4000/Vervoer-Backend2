import { Request, Response } from "express";
import { asyncHandler } from "../utils/asynchandler.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { User } from "../models/normalUser.model.js";
import { Merchant } from "../models/merchant.model.js";
import { Driver } from "../models/driver.model.js";
import z from "zod";
import mongoose from "mongoose";

const querySchema = z.object({
  subject: z.string().min(3, "Subject is required"),
  message: z.string().min(5, "Message is required"),
});

export const submitQueryToAdmin = asyncHandler(async (req: Request, res: Response) => {
  const verified = await verifyAuthentication(req);
  console.log("Body received:", req.body);

  if (!verified?.user) {
    throw new ApiError(401, "UNAUTHORIZED");
  }

  const result = querySchema.safeParse(req.body);
  if (!result.success) {
    throw new ApiError(400, "DATA_VALIDATION_ERROR", result.error.issues);
  }

  const { subject, message } = result.data;

  let model: mongoose.Model<any>;

  switch (verified.userType) {
    case "user":
      model = User;
      break;
    case "merchant":
      model = Merchant;
      break;
    case "driver":
      model = Driver;
      break;
    default:
      throw new ApiError(400, "Invalid user type");
  }

  await model.findByIdAndUpdate(
    verified.user._id,
    {
      $push: {
        queries: {
          subject,
          message,
          status: "pending",
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  res.status(200).json(
    new ApiResponse(200, null, "Query submitted successfully to admin")
  );
});

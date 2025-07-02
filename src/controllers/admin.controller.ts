import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import jwt from "jsonwebtoken";
import { User } from "../models/normalUser.model.js";
import { Merchant } from "../models/merchant.model.js";


export const adminLogin = (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (
    email !== process.env.ADMIN_EMAIL ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    throw new ApiError(401, "Invalid admin credentials");
  }

  const token = jwt.sign(
    { role: "admin" }, 
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" }
  );

  res.status(200).json({
    success: true,
    message: "Admin logged in successfully",
    token,
  });
};


export const getAllUsers = async (req: Request, res: Response) => {
   const users = await User.find({}, "firstName email phoneNumber");

  res.status(200).json(
    new ApiResponse(200, { users }, "Fetched all user data")
  );
};

export const getAllMerchants = async (req: Request, res: Response) => {
  const merchants = await Merchant.find();

  res.status(200).json(
    new ApiResponse(200, { merchants }, "Fetched all merchant data")
  );
}

export const deleteUser = async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await User.findByIdAndDelete(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(
    new ApiResponse(200, {}, "User deleted successfully")
  );
}

export const deleteMerchant = async (req: Request, res: Response) => {
  const { merchantId } = req.params;

  const merchant = await Merchant.findByIdAndDelete(merchantId);
  if (!merchant) {
    throw new ApiError(404, "Merchant not found");
  }

  res.status(200).json(
    new ApiResponse(200, {}, "Merchant deleted successfully")
  );
}
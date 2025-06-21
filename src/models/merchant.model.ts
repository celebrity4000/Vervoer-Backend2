import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";

export interface IMerchant extends Document {
  phoneNumber: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  state: string;
  zipCode: string;
  otp?: string;
  otpExpiry?: Date;
  isVerified: boolean;
  haveGarage: boolean;
}

const MerchantSchema = new Schema(
  {
    ...UserBaseSchemaFields,
    haveGarage: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Merchant = mongoose.model<IMerchant>("Merchant", MerchantSchema, "merchants");

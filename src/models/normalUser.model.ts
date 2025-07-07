import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";
import { BankDetailsSchema } from "./bankDetails.model.js";

export interface IUser extends Document {
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
  carLicensePlateImage?: string;
   bankDetails?: {
    accountNumber?: string;
    ifscCode?: string;
    accountHolderName?: string;
    branch?: string;
  };
  
}

const UserSchema = new Schema(
  {
    ...UserBaseSchemaFields,
    carLicensePlateImage: { type: String,},
    bankDetails: BankDetailsSchema,
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema, "users");

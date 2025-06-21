import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";

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
}

const UserSchema = new Schema(
  {
    ...UserBaseSchemaFields,
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema, "users");

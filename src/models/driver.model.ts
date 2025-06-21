import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";

export interface IDriver extends Document {
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
  haveParkingLot: boolean;
}

const DriverSchema = new Schema(
  {
    ...UserBaseSchemaFields,
    haveParkingLot: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Driver = mongoose.model<IDriver>("Driver", DriverSchema, "drivers");

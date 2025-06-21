import { Schema } from "mongoose";

export const UserBaseSchemaFields = {
  phoneNumber: { type: String, required: true,  },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, },
  country: { type: String, required: true },
  state: { type: String, required: true },
  zipCode: { type: String, required: true },
  otp: { type: String },
  otpExpiry: { type: Date },
  isVerified: { type: Boolean, default: false },
};

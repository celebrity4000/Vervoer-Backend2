import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  phoneNumber: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  state: string;
  zipCode: string;
  userType: "user" | "merchant" | "driver";
  otp?: string;
  otpExpiry?: Date;
  isVerified: boolean;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    country: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    userType: { type: String, enum: ["user", "merchant", "driver"], required: true },
    otp: { type: String },
    otpExpiry: { type: Date },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);

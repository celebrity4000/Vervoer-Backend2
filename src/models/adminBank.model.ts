import mongoose, { Document, Schema } from "mongoose";
import { BankDetailsSchema } from "./bankDetails.model.js";

export interface IAdmin extends Document {
  email: string;
  bankDetails?: {
    accountNumber?: string;
    ifscCode?: string;
    accountHolderName?: string;
    branch?: string;
  };
}

const AdminSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    bankDetails: BankDetailsSchema,
  },
  { timestamps: true }
);

export const Admin = mongoose.model<IAdmin>("Admin", AdminSchema, "admins");

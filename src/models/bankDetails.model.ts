import { Schema } from "mongoose";
export interface IBankDetails {
  accountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
  branch?: string;
}
export const BankDetailsSchema = new Schema(
  {
    accountNumber: { type: String },
    ifscCode: { type: String },
    accountHolderName: { type: String },
    branch: { type: String },
  },
  { _id: false } 
);

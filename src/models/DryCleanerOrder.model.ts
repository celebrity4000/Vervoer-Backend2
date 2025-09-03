import mongoose, { Schema, Document } from "mongoose";

export interface IOrder extends Document {
  user: mongoose.Types.ObjectId;
  dryCleaner: mongoose.Types.ObjectId;
  items: {
    service: mongoose.Types.ObjectId;
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }[];
  totalAmount: number;
  status: "active" | "completed";
}

const orderSchema = new Schema<IOrder>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  dryCleaner: { type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },
  items: [
    {
      service: { type: Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      quantity: { type: Number, required: true },
      unitPrice: { type: Number, required: true },
      totalPrice: { type: Number, required: true },
    },
  ],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ["active", "completed"], default: "active" },
}, { timestamps: true });

export const DryCleanerOrder = mongoose.model<IOrder>("DryCleanerOrder", orderSchema);

import mongoose, { Document, Schema } from "mongoose";

export interface IBooking extends Document {
  user: mongoose.Types.ObjectId;
  driver: mongoose.Types.ObjectId;
  dryCleaner: mongoose.Types.ObjectId;
  pickupAddress: string;
  dropoffAddress: string;
  distance: number; 
  time: number; 
  price: number;
  cancellationReason?: string;
}

const BookingSchema = new Schema<IBooking>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
  dryCleaner: { type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },
  pickupAddress: { type: String, required: true },
  dropoffAddress: { type: String, required: true },
  distance: { type: Number, required: true },
  time: { type: Number, required: true },
  price: { type: Number, required: true },
  cancellationReason: { type: String },
}, { timestamps: true });

export const Booking = mongoose.model<IBooking>("Booking", BookingSchema);

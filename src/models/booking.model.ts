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
  status: 'active' | 'completed' | 'cancelled'; 
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
  dryCleaner: { type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },
  pickupAddress: { type: String, required: true },
  dropoffAddress: { type: String, required: true },
  distance: { type: Number, required: true, min: 0 },
  time: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
  status: { 
    type: String, 
    enum: ['active', 'completed', 'cancelled'], 
    default: 'active',
    required: true 
  },
  cancellationReason: { type: String },
}, { timestamps: true });
BookingSchema.index({ user: 1, status: 1 });
BookingSchema.index({ driver: 1, status: 1 });
BookingSchema.index({ dryCleaner: 1 });

export const Booking = mongoose.model<IBooking>("Booking", BookingSchema);
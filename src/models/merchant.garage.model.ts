import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";
import { StripeIntentData } from "../utils/stripePayments.js";

export interface IGarage {
  _id: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  garageName: string;
  about: string;
  address: string;
  location: { type: "Point"; coordinates: [number, number] };
  price: number;
  contactNumber: string;
  email?: string;
  generalAvailable: [
    {
      day: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
      isOpen?: boolean;
      openTime?: string;
      closeTime?: string;
      is24Hours: boolean;
    }
  ];
  images: string[];
  isVerified: boolean;
  isActive: boolean;
  vehicleType: "bike" | "car" | "both";
  spacesList: Map<string, { count: number; price: number }>;
  is24x7: boolean;
  emergencyContact?: { person: string; number: string };
  parking_pass: boolean;
  transportationAvailable: boolean;
  transportationTypes?: string[];
  coveredDrivewayAvailable: boolean;
  coveredDrivewayTypes?: string[];
  securityCamera: boolean;
  monthlyChargeEnabled: boolean;
  monthlyRate: number;
}

interface GarageMethods {
  isOpenNow: () => boolean;
  getAllSlots: () => Set<string>;
}

const garageSchema = new mongoose.Schema<IGarage, mongoose.Model<IGarage>, GarageMethods>(
  {
    owner: { type: mongoose.Schema.ObjectId, ref: "Merchant", required: true },
    price: { type: Number, required: true },
    garageName: { type: String, required: true, trim: true },
    about: { type: String, required: true },
    address: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true, default: [0, 0] }
    },
    contactNumber: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    generalAvailable: [{
      day: { type: String, enum: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], required: true },
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String,
      is24Hours: { type: Boolean, default: false }
    }],
    images: [String],
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    vehicleType: {
      type: String,
      enum: ["bike", "car", "both"],
      required: true,
      default: "both"
    },
    spacesList: {
      type: Map,
      of: new mongoose.Schema(
        { count: { type: Number, required: true }, price: { type: Number, required: true } },
        { _id: false }
      )
    },
    is24x7: { type: Boolean, default: false },
    emergencyContact: { person: String, number: String },
    parking_pass: { type: Boolean, default: false },
    transportationAvailable: { type: Boolean, default: false },
    transportationTypes: { type: [String], default: undefined },
    coveredDrivewayAvailable: { type: Boolean, default: false },
    coveredDrivewayTypes: { type: [String], default: undefined },
    securityCamera: { type: Boolean, default: false },
    monthlyChargeEnabled: { type: Boolean, default: false },
    monthlyRate: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    methods: {
      isOpenNow: function () {
        const now = new Date();
        const today = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3);
        const todayHours = this.generalAvailable.find(wh => wh.day === today);
        if (!todayHours || !todayHours.isOpen) return false;
        if (todayHours.is24Hours) return true;
        const currentTime = now.getHours() * 100 + now.getMinutes();
        const openTime = parseInt(todayHours.openTime?.replace(':', '') || '0');
        const closeTime = parseInt(todayHours.closeTime?.replace(':', '') || '0');
        return currentTime >= openTime && currentTime <= closeTime;
      },
      getAllSlots: function () {
        const res = new Set<string>();
        if (this.spacesList) {
          this.spacesList.forEach((value, key: string) => {
            for (let i = 1; i <= value.count; i++) {
              res.add(generateParkingSpaceID(key, i.toString()));
            }
          });
        }
        return res;
      }
    }
  }
);

garageSchema.index({ location: '2dsphere' });

// ── Extension subdocument schema ──────────────────────────────────────────────
const extensionSchema = new mongoose.Schema(
  {
    requestedAt:    { type: Date, default: Date.now },
    extraHours:     { type: Number, required: true },
    previousTo:     { type: Date, required: true },
    newTo:          { type: Date, required: true },
    hourlyRate:     { type: Number, required: true },
    doubleRate:     { type: Number, required: true },
    baseAmount:     { type: Number, required: true },
    serviceFee:     { type: Number, required: true },
    transactionFee: { type: Number, required: true },
    estimatedTaxes: { type: Number, required: true },
    totalAmount:    { type: Number, required: true },
    paymentMethod:  {
      type: String,
      enum: ["CASH", "CREDIT", "UPI"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "AWAITING_CONFIRMATION", "SUCCESS", "FAILED"],
      default: "PENDING",
    },
    paymentIntentId: { type: String, default: null },
    activatedAt:     { type: Date, default: null },
    stripeDetails: {
      type: new mongoose.Schema(
        {
          paymentIntent:   { type: String },
          ephemeralKey:    { type: String },
          paymentIntentId: { type: String },
          customerId:      { type: String },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { _id: true, timestamps: false }
);

interface IGarageBooking {
  garageId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  bookingPeriod: { from: Date | string; to: Date | string };
  vehicleNumber: string;
  bookedSlot: string;
  totalAmount: number;
  amountToPaid: number;
  serviceFee: number;
  transactionFee: number;
  estimatedTaxes: number;
  couponCode?: string;
  discount: number;
  priceRate: number;
  vehicleImage?: string;
  isMonthly?: boolean;
  months?: number;
  extensions?: any[];   // ← added
  paymentDetails: {
    transactionId?: string;
    amount: number;
    method: "CASH" | "CREDIT" | "DEBIT" | "STRIPE" | "PAYPAL";
    status: "PENDING" | "SUCCESS" | "FAILED";
    paymentGateway: "CASH" | "STRIPE" | "UPI";
    StripePaymentDetails?: StripeIntentData & { customerId: string };
    paidAt: string | Date | null;
  };
}

const garageBookingSchema = new mongoose.Schema<IGarageBooking>(
  {
    garageId: { type: mongoose.Schema.ObjectId, ref: "Garage", required: true },
    customerId: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    bookingPeriod: {
      from: { type: Date, required: true },
      to: { type: Date, required: true }
    },
    vehicleNumber: String,
    bookedSlot: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    amountToPaid: { type: Number, required: true },
    serviceFee: { type: Number, required: true, default: 0 },
    transactionFee: { type: Number, required: true, default: 0 },
    estimatedTaxes: { type: Number, required: true, default: 0 },
    couponCode: String,
    discount: { type: Number, default: 0 },
    priceRate: { type: Number, required: true },
    isMonthly: { type: Boolean, default: false },
    months: { type: Number, default: null },
    vehicleImage: { type: String, default: null },

    // ── THE FIX: extensions array ─────────────────────────────────────────
    extensions: { type: [extensionSchema], default: [] },

    paymentDetails: {
      transactionId: String,
      amount: Number,
      method: { type: String, enum: ["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"] },
      status: { type: String, enum: ["PENDING", "SUCCESS", "FAILED"], default: "PENDING" },
      paymentGateway: { type: String, enum: ["CASH", "STRIPE", "UPI"], default: "CASH" },
      paidAt: Date,
      StripePaymentDetails: {
        type: {
          paymentIntent: { type: String },
          ephemeralKey: String,
          paymentIntentId: { type: String },
          customerId: { type: String }
        },
        required: false,
        default: undefined
      }
    }
  },
  { timestamps: true }
);

export const Garage = mongoose.model("Garage", garageSchema);
export const GarageBooking = mongoose.model("GarageBooking", garageBookingSchema);
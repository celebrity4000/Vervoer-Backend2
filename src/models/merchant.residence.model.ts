import mongoose from "mongoose";
import { StripeIntentData } from "../utils/stripePayments.js";

export interface IResident {
  owner: mongoose.Types.ObjectId;
  residenceName: string;
  about: string;
  address: string;
  gpsLocation: { type: "Point"; coordinates: [number, number] };
  price: number;
  contactNumber: string;
  email?: string;
  
  vehicleType: "bike" | "car" | "both";
  generalAvailable: [
    {
      day: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
      isOpen?: boolean;
      openTime?: string;
      closeTime?: string;
      is24Hours: boolean;
    }
  ];
  // totalSlot? : number,
  images: string[];
  isVerified: boolean;
  isActive: boolean;
  is24x7: boolean;
  emergencyContact?: {
    person: string;
    number: string;
  };
  parking_pass: boolean;
  transportationAvailable: boolean;
  transportationTypes?: string[];
  coveredDrivewayAvailable: boolean;
  coveredDrivewayTypes?: string[];
  securityCamera: boolean;
}
interface ResidentMethods {
  isOpenNow: () => boolean;
}
const residenceSchema = new mongoose.Schema<
  IResident,
  mongoose.Model<IResident>,
  ResidentMethods
>(
  {
    images: [String],
    owner: {
      type: mongoose.Schema.ObjectId,
      ref: "Merchant",
    },
    contactNumber: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    vehicleType: {
      type: String,
      enum: ["bike", "car", "both"],
      required: true,
      default: "both"
    },
    // totalSlot : {
    //   type : Number ,
    // },
    residenceName: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    gpsLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number, Number],
        required: true,
      },
    },
    price: {
      type: Number,
      required: true,
    },
    about: {
      type: String,
      required: true,
    },
    generalAvailable: [
      {
        day: {
          type: String,
          enum: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
          required: true,
        },
        isOpen: {
          type: Boolean,
          default: true,
        },
        openTime: String,
        closeTime: String,
        is24Hours: {
          type: Boolean,
          default: false,
        },
      },
    ],
    is24x7: Boolean,
    isActive: { type: Boolean, default: true },
    emergencyContact: {
      person: String,
      number: String,
    },

    parking_pass: { type: Boolean, default: false },
    transportationAvailable: { type: Boolean, default: false },
    transportationTypes: { type: [String], default: undefined },
    coveredDrivewayAvailable: { type: Boolean, default: false },
    coveredDrivewayTypes: { type: [String], default: undefined },
    securityCamera: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    methods: {
      isOpenNow: function () {
        const now = new Date();
        const today = now
          .toLocaleDateString("en-US", { weekday: "short" })
          .toUpperCase()
          .slice(0, 3);

        const todayHours = this.generalAvailable.find((ga) => ga.day === today);

        if (!todayHours || !todayHours.isOpen) return false;
        if (todayHours.is24Hours) return true;

        const currentTime = now.getHours() * 100 + now.getMinutes();
        const openTime = parseInt(todayHours.openTime?.replace(":", "") || "0");
        const closeTime = parseInt(
          todayHours.closeTime?.replace(":", "") || "0"
        );

        return currentTime >= openTime && currentTime <= closeTime;
      },
    },
  }
);
residenceSchema.index({ gpsLocation: "2dsphere" });

export const ResidenceModel = mongoose.model("Residence", residenceSchema);


export interface IResidenceBooking {
  residenceId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  bookingPeriod: {
    from: Date | string;
    to: Date | string;
  };
  vehicleNumber: string;
  bookedSlot: string;
  totalAmount: number;
  amountToPaid: number;
  couponCode?: string;
  discount: number;
  priceRate: number;
  paymentDetails: {
    transactionId?: string;
    amount: number;
    method: "CASH" | "CREDIT" | "DEBIT" | "UPI" | "PAYPAL";
    status: "PENDING" | "SUCCESS" | "FAILED";
    paymentGateway: "CASH" | "STRIPE";
    paidAt: string | Date | null;
    StripePaymentDetails?: StripeIntentData & { customerId: string };
  };
}

const residenceBookingSchema = new mongoose.Schema<IResidenceBooking>(
  {
    residenceId: { type: mongoose.Schema.ObjectId, ref: "Residence", required: true },
    customerId: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    bookingPeriod: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    vehicleNumber: { type: String, required: true },
    bookedSlot: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    amountToPaid: { type: Number, required: true },
    couponCode: String,
    discount: { type: Number, default: 0 },
    priceRate: { type: Number, required: true },
    paymentDetails: {
      transactionId: String,
      amount: Number,
      method: { type: String, enum: ["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"], required: true },
      status: { type: String, enum: ["PENDING", "SUCCESS", "FAILED"], default: "PENDING" },
      paymentGateway: { type: String, enum: ["CASH", "STRIPE"], default: "STRIPE" },
      paidAt: Date,
      StripePaymentDetails: {
        paymentIntent: { type: String, required: true },
        ephemeralKey: String,
        paymentIntentId: { type: String, required: true },
        customerId: { type: String, required: true }
      }
    }
  },
  { timestamps: true }
);

export const ResidenceBookingModel = mongoose.model("ResidenceBooking", residenceBookingSchema);
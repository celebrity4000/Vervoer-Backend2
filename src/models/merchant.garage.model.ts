import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";

export interface IGarage {
  owner: mongoose.Types.ObjectId;
  garageName: string;
  about: string;
  address: string;
  location: { type: "Point"; coordinates: [number, number] };
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
  spacesList: Map<
    string,
    {
      count: number;
      price: number;
    }
  >;
  is24x7: boolean;
  emergencyContact?: {
    person: string;
    number: string;
  };
}

interface GarageMethods {
  isOpenNow: () => boolean;
  getAllSlots: () => Set<string>;
}

const garageSchema = new mongoose.Schema<IGarage, mongoose.Model<IGarage>, GarageMethods>(
  {
    owner: {
      type: mongoose.Schema.ObjectId,
      ref: "Merchant",
      required: true,
    },
    garageName: {
      type: String,
      required: true,
      trim: true,
    },
    about: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        default: [0, 0],
      },
    },
    contactNumber: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
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
    images: [String],
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    vehicleType: {
      type: String,
      enum: ["bike", "car", "both"],
      required: true,
      default: "both",
    },
    spacesList: {
      type: Map,
      of: new mongoose.Schema(
        {
          count: { type: Number, required: true },
          price: { type: Number, required: true },
        },
        { _id: false }
      ),
    },
    is24x7: {
      type: Boolean,
      default: false,
    },
    emergencyContact: {
      person: String,
      number: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

garageSchema.index({ location: "2dsphere" });

garageSchema.method("isOpenNow", function () {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase()
    .slice(0, 3);

  const todayHours = this.generalAvailable.find((wh) => wh.day === today);

  if (!todayHours || !todayHours.isOpen) return false;
  if (todayHours.is24Hours) return true;

  const currentTime = now.getHours() * 100 + now.getMinutes();
  const openTime = parseInt(todayHours.openTime?.replace(":", "") || "0");
  const closeTime = parseInt(todayHours.closeTime?.replace(":", "") || "0");

  return currentTime >= openTime && currentTime <= closeTime;
});

garageSchema.method("getAllSlots", function () {
  const res = new Set<string>();
  if (this.spacesList) {
    this.spacesList.forEach((value, key) => {
      for (let i = 1; i <= value.count; i++) {
        res.add(generateParkingSpaceID(key, i.toString()));
      }
    });
  }
  return res;
});

export const Garage = mongoose.model("Garage", garageSchema);



const garageBookingSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Types.ObjectId,
      ref: "Garage",
      required: true,
    },
    customerId: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      required: true,
    },
    bookingPeriod: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    vehicleNumber: {
      type: String,
    },
    bookedSlot: {
      type: String,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    amountToPaid: {
      type: Number,
      required: true,
    },
    couponCode: {
      type: String,
    },
    discount: {
      type: Number,
      default: 0,
    },
    paymentDetails: {
      transactionId: String,
      amount: Number,
      method: {
        type: String,
        enum: ["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"],
      },
      status: {
        type: String,
        enum: ["PENDING", "SUCCESS", "FAILED"],
      },
    },
  },
  { timestamps: true }
);

export const GarageBooking = mongoose.model("GarageBooking", garageBookingSchema);

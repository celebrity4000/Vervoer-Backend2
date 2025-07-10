import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";
import { BankDetailsSchema ,IBankDetails} from "./bankDetails.model.js";
import { StripeIntentData } from "../utils/stripePayments.js";
import { required } from "zod/v4-mini";

export interface IMerchant extends Document {
  phoneNumber: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  state: string;
  zipCode: string;
  otp?: string;
  otpExpiry?: Date;
  isVerified: boolean;
  haveGarage: boolean;
  haveDryCleaner: boolean;
  haveParkingLot: boolean;
  haveResidenceParking: boolean;
  bankDetails?: IBankDetails;
  stripeCustomerId?:string ;
}

const MerchantSchema = new Schema(
  {
    ...UserBaseSchemaFields,
    haveParkingLot: { type: Boolean, default: false },
    haveGarage: { type: Boolean, default: false },
    haveDryCleaner: { type: Boolean, default: false },
    haveResidenceParking: { type: Boolean, default: false },
    bankDetails: BankDetailsSchema,
  },
  { timestamps: true }
);

export const Merchant = mongoose.model<IMerchant>(
  "Merchant",
  MerchantSchema,
  "merchants"
);

export interface IParking {
  _id : mongoose.Types.ObjectId
  images : [string],
  owner : mongoose.Types.ObjectId ,
  contactNumber : string,
  email? : string ,
  totalSlot? : number ,
  parkingName : string ,
  address : string ,
  gpsLocation? : {type : "Point", coordinates : [number,number]},
  price : number ,
  about : string ,
  spacesList : Map<string,number>,
  generalAvailable : [{
    day : "SUN" |  "MON" |  "TUE" |  "WED" |  "THU" |  "FRI" |  "SAT",
    isOpen? : boolean,
    openTime? : string ,
    closeTime? : string ,
    is24Hours : boolean ,
  }],
  is24x7 : boolean,
  isActive: boolean,
}
interface IParkingMethods {
  isOpenNow: ()=>boolean ;
}
const parkingLotSchema = new mongoose.Schema<IParking,mongoose.Model<IParking> , IParkingMethods>({
    images : [String],
    owner : {
        type : mongoose.Schema.ObjectId,
        ref : "Merchant"
    },
    contactNumber : {
      type : String ,
      required : true
    },
    email : {
      type : String ,
    },
    totalSlot : {
      type : Number ,
    },
    parkingName : {
        type : String , 
        required: true
    },
    address : {
        type : String , 
        required: true
    },
    gpsLocation: {
      type : {
        type : String ,
        enum : "Point",
        default : "Point",
      },
      coordinates : {
        type : [Number],
        required : true ,
      },
  },
    price : {
        type: Number,
        required : true ,
    },
    about : {
        type : String ,
        required : true ,
    },
    spacesList : {
        type : mongoose.Schema.Types.Map ,
        of : Number,
    },
    generalAvailable: [{
      day: {
        type: String,
        enum: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
        required: true
      },
      isOpen: {
        type: Boolean,
        default: true
      },
      openTime: String,
      closeTime: String,
      is24Hours: {
        type: Boolean,
        default: false
      }
    }],
    is24x7: Boolean ,
    isActive : {type : Boolean , default : true },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  methods : {
    isOpenNow : function(){
      const now = new Date();
      const today = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3);
  
      const todayHours = this.generalAvailable.find(ga => ga.day === today);
  
      if (!todayHours || !todayHours.isOpen) return false;
      if (todayHours.is24Hours) return true;
  
      const currentTime = now.getHours() * 100 + now.getMinutes();
      const openTime = parseInt(todayHours.openTime?.replace(':', '') || '0');
      const closeTime = parseInt(todayHours.closeTime?.replace(':', '') || '0');
  
      return currentTime >= openTime && currentTime <= closeTime;
    }
  }
})

parkingLotSchema.index({ gpsLocation : '2dsphere' });
export interface ILotRecord {
  _id : mongoose.Types.ObjectId,
  lotId: mongoose.Types.ObjectId;
  renterInfo: mongoose.Types.ObjectId;
  rentedSlot: string;
  rentFrom: mongoose.Schema.Types.Date;
  rentTo: mongoose.Schema.Types.Date;
  totalHours : number ;
  totalAmount: number;
  priceRate : number ;
  amountToPaid: number;
  appliedCouponCode: string;
  discount: number;
  paymentDetails: {
    transactionId: string | null;
    paymentMethod: "CASH" | "CREDIT" | "DEBIT" | "STRIPE";
    status : "PENDING" | "FAILED" | "SUCCESS" ;
    amountPaidBy: number;
    paidAt : Date ,
    stripePaymentDetails: StripeIntentData;
  };
}
const lotRentRecordSchema = new mongoose.Schema<ILotRecord , mongoose.Model<ILotRecord>>({
  lotId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ParkingLot",
  },
  renterInfo: {
    type: mongoose.Schema.Types.ObjectId,
    // ref : "User"
  },
  rentedSlot: {
    type: String, // Zone + Number
    required: true,
  },
  rentFrom: {
    type: mongoose.Schema.Types.Date,
    required: true,
  },
  rentTo: {
    type: mongoose.Schema.Types.Date,
    required: true,
  },
  totalHours: {
    type: Number,
    required: true,
  },
  priceRate: {
    type: Number,
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
  appliedCouponCode: String,
  discount: {
    type: Number,
    required: true,
    default: 0,
  },
  paymentDetails: {
    type :  new mongoose.Schema(
    {
      transactionId: String,
      paymentMethod: {
        type: String,
        enums: ["CASH", "CREDIT", "DEBIT", "STRIP"],
        default: "STRIP",
      },
      paidAt : Date ,
      status : {
        type : String ,
        enums : ["PENDING" , "FAILED", "SUCCESS"],
        default : "PENDING" ,
      },
      amountPaidBy: Number,
      stripePaymentDetails:{type : new mongoose.Schema({
        paymentIntent: {type : String , required : true},
        ephemeralKey: String,
        paymentIntentId: {type :String, required : true},
      },{_id: false})}
    },
    { _id: false }
  ),}
});

export const ParkingLotModel = mongoose.model<IParking>("ParkingLot",parkingLotSchema) ;
export const LotRentRecordModel = mongoose.model<ILotRecord>("LotRentRecord", lotRentRecordSchema)

const addressSchema = new mongoose.Schema({
  street:   { type: String, required: true },
  city:     { type: String, required: true },
  state:    { type: String, required: true },
  zipCode:  { type: String, required: true },
  country:  { type: String, required: true },
}, { _id: false });

const dryCleanerSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Types.ObjectId,
    ref: "Merchant",
    required: true,
  },
  shopname: { type: String, required: true },

  address: { type: addressSchema, required: true },  

  rating: { type: Number, default: 0 },
  about: { type: String },
  contactPerson: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  contactPersonImg: { type: String },
  shopimage: [String],
  hoursOfOperation: [
    {
      day: { type: String },
      open: { type: String },
      close: { type: String },
    },
  ],
  services: [
    {
      name: { type: String, required: true },
      category: { type: String, required: true },
      strachLevel: { type: Number, enum: [1, 2, 3, 4, 5], default: 3 },
      washOnly: { type: Boolean, default: false },
      additionalservice: { type: String, enum: ["zipper", "button", "wash/fold"] },
      price: { type: Number },
    },
  ],
  orders: [
    {
      serviceName: String,
      quantity: Number,
      price: Number,
      status: { type: String, enum: ["active", "completed"], default: "active" },
    },
  ],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});



export const DryCleaner = mongoose.model("DryCleaner", dryCleanerSchema );




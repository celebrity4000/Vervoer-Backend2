import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";

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
}

const MerchantSchema = new Schema(
  {
    ...UserBaseSchemaFields,
    haveParkingLot: {
      type: Boolean,
      default: false,
    },
    haveGarage: {
      type: Boolean,
      default: false,
    },
    haveDryCleaner: {
      type: Boolean,
      default: false,
    },
    haveResidence: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const Merchant = mongoose.model<IMerchant>(
  "Merchant",
  MerchantSchema,
  "merchants"
);

export interface IParking {
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
const lotRentRecordSchema = new mongoose.Schema({
    lotId : {
        type: mongoose.Schema.Types.ObjectId,
        ref : "ParkingLot",
    },
    renterInfo : {
        type: mongoose.Schema.Types.ObjectId ,
        // ref : "User"
    },
    rentedSlot : {
        type: String , // Zone + Number
        required : true ,
    },
    rentFrom : {
        type : mongoose.Schema.Types.Date ,
        required : true ,
    },
    rentTo : {
        type: mongoose.Schema.Types.Date,
        required: true
    },
})

export const ParkingLotModel = mongoose.model("ParkingLot",parkingLotSchema) ;
export const LotRentRecordModel = mongoose.model("LotRentRecord", lotRentRecordSchema)

const drycleanerSchema = new mongoose.Schema(
  {
    shopname: { type: String, required: true },
    address: { type: String, required: true },
    rating: { type: Number, default: 0 },
    about: { type: String },
    contactPerson: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    contactPersonImg: { type: String },
    shopimage: [{ type: String }],
    hoursOfOperation: [
      {
        day: { type: String },
        open: { type: String },
        close: { type: String },
      },
    ],
    services: [
      {
        name: { type: String },
        category: { type: String , required: true },
        strachLevel: { type: Number, enum: [1, 2, 3, 4, 5], default: 3 },
        washOnly: { type: Boolean, default: false },
        additionalservice: { type:String,enum:["zipper","button","wash/fold"], },
        price: { type: Number },
      },
    ],
    orders: [
      {
        serviceName: { type: String },
        quantity: { type: Number },
        price: { type: Number },
        status: { type: String, enum: ["active", "completed"], default: "active" },
      },
    ],
  },
  { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
}
);

export const DryCleaner = mongoose.model("DryCleaner", drycleanerSchema );

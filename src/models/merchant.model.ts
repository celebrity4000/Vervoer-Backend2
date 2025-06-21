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
    haveResidenceParking: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const parkingLotSchema = new mongoose.Schema({
    owner : {
        type : mongoose.Types.ObjectId,
        ref : "Merchant"
    },
    parkingName : {
        type : String , 
        required: true
    },
    address : {
        type : String , 
        required: true
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
    }
}, {timestamps: true})

const lotRentRecordSchema = new mongoose.Schema({
    lotDetails : {
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

const dryCleanerSchema = new mongoose.Schema({
    name: { type: String, required: true },
  address: { type: String, required: true },
  rating: { type: Number, default: 0 },
  about: { type: String },
  contactName: { type: String, required: true },
  contactPhone: { type: String, required: true },
  imageUrl: { type: String },
  hours: [
    {
      day: { type: String, required: true },
      open: { type: String, required: true },
      close: { type: String, required: true },
    },
  ],
})

export const ParkingLotModel = mongoose.model("ParkingLot",parkingLotSchema) ;
export const LotRentRecordModel = mongoose.model("LotRentRecord", lotRentRecordSchema)

export const Merchant = mongoose.model<IMerchant>(
  "Merchant",
  MerchantSchema,
  "merchants"
);

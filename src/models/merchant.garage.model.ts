import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";


const garageSchema = new mongoose.Schema({
    owner: {
      type: mongoose.Types.ObjectId,
      ref: "Merchant",
      required: true
    },
    garageName: {
      type: String,
      required: true,
      trim: true
    },
    about: {
      type: String,
      required: true
    },
    address: {
      type: String,
      required: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
      }
    },
    contactNumber: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    workingHours: [{
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
    images: [String],
    isVerified: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    availableSlots: {
      type: Map,
      of: Number
    },
    is24x7: {
      type: Boolean,
      default: false
    },
    emergencyContact: {
      phone: String,
      available: Boolean
    },
    // tags: [String]
  }, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    methods : {
      isOpenNow : function(){
        const now = new Date();
        const today = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3);
    
        const todayHours = this.workingHours.find(wh => wh.day === today);
        
        if (!todayHours || !todayHours.isOpen) return false;
        if (todayHours.is24Hours) return true;
        
        const currentTime = now.getHours() * 100 + now.getMinutes();
        const openTime = parseInt(todayHours.openTime?.replace(':', '') || '0');
        const closeTime = parseInt(todayHours.closeTime?.replace(':', '') || '0');
        
        return currentTime >= openTime && currentTime <= closeTime;
      },
      getAllSlots : function(){
        let res = new Set<string>()
        if(this.availableSlots){
          this.availableSlots.forEach((value:number ,key:string)=>{
            for(let i = 1 ; i <= value ; i++){
                res.add(generateParkingSpaceID(key,i.toString())) ;
            }
        })
        }
        return res
      }
    },

  });
  
  // Create 2dsphere index for location-based queries
  garageSchema.index({ location: '2dsphere' });
  
  // Garage Booking Schema
  const garageBookingSchema = new mongoose.Schema({
    garageId: {
      type: mongoose.Types.ObjectId,
      ref: "Garage",
      required: true
    },
    customerId: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      required: true
    },
    bookingPeriod : {
      from : {type : Date, required : true} ,
      to : {type : Date, required : true} ,
    },
    bookedSlot : {type :String, required : true} ,
    amountToPaid : Number ,
    // paymentDetails : {
    //   transactionId : String ,
    //   amount : Number ,
    //   method : {type : String , enum: ["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"]},
    //   successful : {type : Boolean},
    // }
  }, { timestamps: true });
  
  export const Garage = mongoose.model("Garage", garageSchema);
  export const GarageBooking = mongoose.model("GarageBooking", garageBookingSchema);
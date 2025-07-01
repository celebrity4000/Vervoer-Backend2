import mongoose from "mongoose";

export interface IResident {
  owner : mongoose.Types.ObjectId,
  residenceName :string ,
  about : string ,
  address : string,
  gpsLocation : {type : "Point", coordinates : [number,number]},
  price: number,
  contactNumber : string ,
  email? : string ,
  generalAvailable : [{
    day : "SUN" |  "MON" |  "TUE" |  "WED" |  "THU" |  "FRI" |  "SAT",
    isOpen? : boolean,
    openTime? : string ,
    closeTime? : string ,
    is24Hours : boolean ,
  }]
  // totalSlot? : number,
  images : string[],
  isVerified : boolean,
  isActive : boolean,
  is24x7:boolean,
  emergencyContact? : {
    person : string ,
    number : string ,
  }
};
interface ResidentMethods {
  isOpenNow : ()=>boolean
}
const residenceSchema = new mongoose.Schema<IResident, mongoose.Model<IResident>, ResidentMethods>({
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
    // totalSlot : {
    //   type : Number ,
    // },
    residenceName : {
        type : String , 
        required: true
    },
    address : {
        type : String , 
        required: true
    },
    gpsLocation : {
      type : {
        type : String ,
        enum : ["Point"],
        default : "Point",
      },
      coordinates:{
        type : [Number,Number],
        required: true
      }
  },
    price : {
        type: Number,
        required : true ,
    },
    about : {
        type : String ,
        required : true ,
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
    emergencyContact : {
      person : String,
      number : String,
    }
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
});
residenceSchema.index({ gpsLocation : '2dsphere' });

export const ResidenceModel = mongoose.model("Residence",residenceSchema) ;
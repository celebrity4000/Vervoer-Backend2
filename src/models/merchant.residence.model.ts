import mongoose from "mongoose";

const residenceSchema = new mongoose.Schema({
    images : [String],
    owner : {
        type : mongoose.Types.ObjectId,
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
    residenceName : {
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
      coordinate : {
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
});


export const ResidenceModel = mongoose.model("Residence",residenceSchema) ;
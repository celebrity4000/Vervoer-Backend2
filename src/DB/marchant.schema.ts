import mongoose from "mongoose";

const merchantUserSchema = new mongoose.Schema({
  name: {
    type: String,
    require: true,
  },
  email: {
    type: String,
    require: true,
  },
  phoneNumber: {
    type: String,
    require: true,
  },
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
}, {timestamps : true});

const parkingLotSchema = new mongoose.Schema({
    owner : {
        type : mongoose.Types.ObjectId,
        ref : "MerchantUser"
    },
    name : {
        type : String , 
        require: true
    },
    address : {
        type : String , 
        require: true
    },
    price : {
        type: Number,
        require : true ,
    },
    about : {
        type : String ,
        require : true ,
    },
    spacesList : {
        type : mongoose.Schema.Types.Map ,
        of : Number,
    }
}, {timestamps: true})


const MerchantModel = mongoose.model("MerchantUser",merchantUserSchema) ;
const ParkingLotModel = mongoose.model("ParkingLot",parkingLotSchema) ;

export {MerchantModel , ParkingLotModel} ;
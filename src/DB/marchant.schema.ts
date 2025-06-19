import mongoose from "mongoose";

const merchantUserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
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

const MerchantModel = mongoose.model("MerchantUser",merchantUserSchema) ;
const ParkingLotModel = mongoose.model("ParkingLot",parkingLotSchema) ;
const LotRentRecordModel = mongoose.model("LotRentRecord", lotRentRecordSchema)

export {MerchantModel , ParkingLotModel, LotRentRecordModel} ;
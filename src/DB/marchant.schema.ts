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
});

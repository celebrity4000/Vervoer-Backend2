import mongoose, { Document, Schema } from "mongoose";
import { UserBaseSchemaFields } from "./user.model.js";

export interface IDriver extends Document {
  phoneNumber: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  country?: string;
  state?: string;
  zipCode?: string;
  userType: string;
  otp?: string;
  otpExpiry?: Date;
  isVerified: boolean;
  loginType: string;
  socialId?: string;

  isBooked?: boolean;
  middleName: string;
  licenseNumber: string;
  expirationDate: Date;
  driverLicenseImage: string;
  availability: string[];
  kidsFriendly: boolean;
  carSeatsAvailable: boolean;
  driveProfileImage?: string;
  backgroudCheck: {
    checker: boolean;
    safetHolder: boolean;
  };

  vehicleInfo: {
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: number;
    noOfDoors: number;
    vehicleColor: string;
    noOfSeats: number;
    noOfBooster: number;
    vehicleNumber: string;
    registrationNumber: string;
    vehicleInspectionImage: string;
    vehicleInsuranceImage: string;
    localCertificate: string;
    insuranceProviderCompany: string;
    insuranceNumber: string;
  };

  driverCertificationImage: string;

  bankDetails: {
    creditCardImage: string;
    accountHolderName: string;
    accountNumber: string;
    routingNumber: string;
    bankName: string;
  };

   attestation: {
    consentBackgroundCheck: boolean;
    completeASafetyHoldings: boolean;
    completeACheckInc: boolean;
    noDrivingUnderInfluence: boolean;
    noDiscriminateUser: boolean;
    willingVideoForSecurity: boolean;
    ongoingBackgroundAndLicenseCheck: boolean;
    obeyTrafficLaws: boolean;
    noAggressiveDriving: boolean;
    noUnsafeExperience: boolean;
    agreeToTerms: boolean;
    keepVehicleGoodCondition: boolean;
    completeOnboarding: boolean;
    noFightWithUser: boolean;
    infoProvidedIsTrue: boolean;
    electronicSignature: string;
    attestationDate: Date;
  };
}

const DriverSchema = new Schema<IDriver>(
  {
    ...UserBaseSchemaFields,

    isBooked: { type: Boolean, default: false },
    middleName: { type: String, default: "" },
    licenseNumber: { type: String, required: true },
    expirationDate: { type: Date, required: true },
    driverLicenseImage: { type: String, required: true },
    availability: [{ type: String, required: true }],
    kidsFriendly: { type: Boolean, default: false },
    carSeatsAvailable: { type: Boolean, default: false },
    driveProfileImage: { type: String, default: "" },

    backgroudCheck: {
      checker: { type: Boolean, default: false },
      safetHolder: { type: Boolean, default: false },
    },

    vehicleInfo: {
      vehicleBrand: { type: String, required: true },
      vehicleModel: { type: String, required: true },
      vehicleYear: { type: Number, required: true },
      noOfDoors: { type: Number, required: true },
      vehicleColor: { type: String, required: true },
      noOfSeats: { type: Number, required: true },
      noOfBooster: { type: Number, required: true },
      vehicleNumber: { type: String, required: true },
      registrationNumber: { type: String, required: true },
      vehicleInspectionImage: { type: String, required: true },
      vehicleInsuranceImage: { type: String, required: true },
      localCertificate: { type: String, required: true },
      insuranceProviderCompany: { type: String, required: true },
      insuranceNumber: { type: String, required: true },
    },

    driverCertificationImage: { type: String, required: true },

    bankDetails: {
      creditCardImage: { type: String, required: true },
      accountHolderName: { type: String, required: true },
      accountNumber: { type: String, required: true },
      routingNumber: { type: String, required: true },
      bankName: { type: String, required: true },
    },
    attestation: {
      consentBackgroundCheck: { type: Boolean, default: false },
      completeASafetyHoldings: { type: Boolean, default: false },
      completeACheckInc: { type: Boolean, default: false },
      noDrivingUnderInfluence: { type: Boolean, default: false },
      noDiscriminateUser: { type: Boolean, default: false },
      willingVideoForSecurity: { type: Boolean, default: false },
      ongoingBackgroundAndLicenseCheck: { type: Boolean, default: false },
      obeyTrafficLaws: { type: Boolean, default: false },
      noAggressiveDriving: { type: Boolean, default: false },
      noUnsafeExperience: { type: Boolean, default: false },
      agreeToTerms: { type: Boolean, default: false },
      keepVehicleGoodCondition: { type: Boolean, default: false },
      completeOnboarding: { type: Boolean, default: false },
      noFightWithUser: { type: Boolean, default: false },
      infoProvidedIsTrue: { type: Boolean, default: false },
      electronicSignature: { type: String, default: "" }, 
      attestationDate: { type: Date },
    },
  },
  { timestamps: true }
);

export const Driver = mongoose.model<IDriver>("Driver", DriverSchema, "drivers");

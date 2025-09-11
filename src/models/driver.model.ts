// models/driver.model.ts
import mongoose, { Document, Schema } from "mongoose";

// User Base Schema Fields (shared fields)
export const UserBaseSchemaFields = {
  phoneNumber: { type: String, required: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  country: { type: String },
  state: { type: String },
  zipCode: { type: String },
  userType: { 
    type: String, 
    enum: ["user", "driver", "merchant"], 
    default: "user",
    required: true 
  },
  otp: { type: String },
  otpExpiry: { type: Date },
  isVerified: { type: Boolean, default: false },
  profileImage: { type: String, default: "" },
  stripeCustomerId: { type: String },
  loginType: {
    type: String,
    enum: ["normal", "google", "facebook"],
    default: "normal"
  },
  socialId: { type: String },
  queries: [
    {
      subject: { type: String, required: true },
      message: { type: String, required: true },
      status: { 
        type: String, 
        enum: ["pending", "resolved"], 
        default: "pending" 
      },
      createdAt: { type: Date, default: Date.now },
    }
  ]
};

// Driver Interface
export interface IDriver extends Document {
   _id: mongoose.Types.ObjectId;
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
  profileImage?: string;
  stripeCustomerId?: string;
  queries?: Array<{
    subject: string;
    message: string;
    status: string;
    createdAt: Date;
  }>;

  // Driver specific fields
  isBooked?: boolean;
  middleName?: string;
  licenseNumber?: string;
  expirationDate?: Date;
  driverLicenseImage?: string;
  availability?: string[];
  kidsFriendly?: boolean;
  carSeatsAvailable?: boolean;
  driveProfileImage?: string;
  profileCompleted?: boolean; 
  
  backgroudCheck?: {
    checker: boolean;
    safetHolder: boolean;
  };

  vehicleInfo?: {
    vehicleBrand?: string;
    vehicleModel?: string;
    vehicleYear?: number;
    noOfDoors?: number;
    vehicleColor?: string;
    noOfSeats?: number;
    noOfBooster?: number;
    vehicleNumber?: string;
    registrationNumber?: string;
    vehicleInspectionImage?: string;
    vehicleInsuranceImage?: string;
    localCertificate?: string;
    insuranceProviderCompany?: string;
    insuranceNumber?: string;
  };

  driverCertificationImage?: string;

  bankDetails?: {
    creditCardImage?: string;
    accountHolderName?: string;
    accountNumber?: string;
    routingNumber?: string;
    bankName?: string;
  };

  attestation?: {
    consentBackgroundCheck?: boolean;
    completeASafetyHoldings?: boolean;
    completeACheckInc?: boolean;
    noDrivingUnderInfluence?: boolean;
    noDiscriminateUser?: boolean;
    willingVideoForSecurity?: boolean;
    ongoingBackgroundAndLicenseCheck?: boolean;
    obeyTrafficLaws?: boolean;
    noAggressiveDriving?: boolean;
    noUnsafeExperience?: boolean;
    agreeToTerms?: boolean;
    keepVehicleGoodCondition?: boolean;
    completeOnboarding?: boolean;
    noFightWithUser?: boolean;
    infoProvidedIsTrue?: boolean;
    electronicSignature?: string;
    attestationDate?: Date;
  };

  // Virtual fields
  fullName?: string;

  // Instance methods
  isProfileComplete(): boolean;
}

// Static methods interface
export interface IDriverModel extends mongoose.Model<IDriver> {
  findCompleteProfiles(): Promise<IDriver[]>;
  findIncompleteProfiles(): Promise<IDriver[]>;
}

// Driver Schema
const DriverSchema = new Schema<IDriver>(
  {
    // Base user fields (required for initial registration)
    ...UserBaseSchemaFields,

    // Driver specific fields (optional initially, completed in step 2)
    isBooked: { type: Boolean, default: false },
    middleName: { type: String, default: "" },
    licenseNumber: { type: String, default: "" },
    expirationDate: { type: Date },
    driverLicenseImage: { type: String, default: "" },
    availability: [{ type: String }],
    kidsFriendly: { type: Boolean, default: false },
    carSeatsAvailable: { type: Boolean, default: false },
    driveProfileImage: { type: String, default: "" },
    profileCompleted: { type: Boolean, default: false }, // Track completion status

    backgroudCheck: {
      checker: { type: Boolean, default: false },
      safetHolder: { type: Boolean, default: false },
    },

    vehicleInfo: {
      vehicleBrand: { type: String, default: "" },
      vehicleModel: { type: String, default: "" },
      vehicleYear: { type: Number, default: 0 },
      noOfDoors: { type: Number, default: 0 },
      vehicleColor: { type: String, default: "" },
      noOfSeats: { type: Number, default: 0 },
      noOfBooster: { type: Number, default: 0 },
      vehicleNumber: { type: String, default: "" },
      registrationNumber: { type: String, default: "" },
      vehicleInspectionImage: { type: String, default: "" },
      vehicleInsuranceImage: { type: String, default: "" },
      localCertificate: { type: String, default: "" },
      insuranceProviderCompany: { type: String, default: "" },
      insuranceNumber: { type: String, default: "" },
    },

    driverCertificationImage: { type: String, default: "" },

    bankDetails: {
      creditCardImage: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      routingNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
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
  { 
    timestamps: true
  }
);

// Add indexes for better performance (after schema definition)
DriverSchema.index({ email: 1 });
DriverSchema.index({ phoneNumber: 1 });
DriverSchema.index({ userType: 1 });
DriverSchema.index({ isVerified: 1 });
DriverSchema.index({ profileCompleted: 1 });
DriverSchema.index({ createdAt: -1 });
DriverSchema.index({ 'vehicleInfo.vehicleNumber': 1 });
DriverSchema.index({ 'bankDetails.accountNumber': 1 });

// Compound indexes for common queries
DriverSchema.index({ userType: 1, isVerified: 1 });
DriverSchema.index({ userType: 1, profileCompleted: 1 });
DriverSchema.index({ isVerified: 1, profileCompleted: 1 });

// Pre-save middleware to check profile completion
DriverSchema.pre('save', function(this: IDriver, next) {
  // Check if profile is complete before saving
  if (this.licenseNumber && 
      this.vehicleInfo?.vehicleBrand && 
      this.bankDetails?.accountHolderName && 
      this.attestation?.agreeToTerms &&
      this.driverLicenseImage &&
      this.vehicleInfo?.vehicleInspectionImage &&
      this.vehicleInfo?.vehicleInsuranceImage &&
      this.driverCertificationImage &&
      this.bankDetails?.creditCardImage) {
    this.profileCompleted = true;
    this.isVerified = true; // Mark as verified when profile is complete
  }
  next();
});

// Instance method to check if profile is complete
DriverSchema.methods.isProfileComplete = function(this: IDriver): boolean {
  return !!(
    this.licenseNumber &&
    this.vehicleInfo?.vehicleBrand &&
    this.bankDetails?.accountHolderName &&
    this.attestation?.agreeToTerms &&
    this.driverLicenseImage &&
    this.vehicleInfo?.vehicleInspectionImage &&
    this.vehicleInfo?.vehicleInsuranceImage &&
    this.driverCertificationImage &&
    this.bankDetails?.creditCardImage
  );
};

// Static method to find drivers with complete profiles
DriverSchema.statics.findCompleteProfiles = function() {
  return this.find({ profileCompleted: true });
};

// Static method to find drivers with incomplete profiles
DriverSchema.statics.findIncompleteProfiles = function() {
  return this.find({ profileCompleted: false });
};

// Virtual for full name
DriverSchema.virtual('fullName').get(function(this: IDriver) {
  if (this.middleName) {
    return `${this.firstName} ${this.middleName} ${this.lastName}`;
  }
  return `${this.firstName} ${this.lastName}`;
});

// Ensure virtual fields are serialized
DriverSchema.set('toJSON', { virtuals: true });

export const Driver = mongoose.model<IDriver, IDriverModel>("Driver", DriverSchema, "drivers");
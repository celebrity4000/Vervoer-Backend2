export const UserBaseSchemaFields = {
  phoneNumber: { type: String },
  password: { type: String },
  firstName: { type: String, required: true },
  lastName: { type: String },
  email: { type: String, required: true },
  country: { type: String },
  state: { type: String },
  zipCode: { type: String },
  userType: { type: String, enum: ["user", "driver", "merchant"], default: "user" },
  otp: { type: String },
  otpExpiry: { type: Date },
  isVerified: { type: Boolean, default: false },
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
      status: { type: String, enum: ["pending", "resolved"], default: "pending" },
      createdAt: { type: Date, default: Date.now },
    }
  ]
}

import { Request, Response } from "express";
import { Garage, GarageBooking, IGarage } from "../models/merchant.garage.model.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { IUser, User } from "../models/normalUser.model.js";
import { createStripeCustomer, initPayment, validateOrCreateCustomer,  
  stripe                       } from "../utils/stripePayments.js";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import QRCode from 'qrcode';

import { verifyPayment } from "../utils/stripePayments.js";

// Zod schemas for validation
const GarageData = z.object({
  garageName: z.string().min(1, "Garage name is required"),
  about: z.string().min(1, "About is required"),
  address: z.string().min(1, "Address is required"),
  price: z.coerce.number().optional(),
  location: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.coerce.number().gte(-180).lte(180),
      z.coerce.number().gte(-90).lte(90)
    ])
  }).optional(),
  images: z.array(z.string().url()).optional(),
  contactNumber: z.string().min(9, "Contact number is required"),
  email: z.string().email().optional(),
  generalAvailable: z.array(
    z.object({
      day: z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]),
      isOpen: z.coerce.boolean().default(true),
      openTime: z.string().optional(),
      closeTime: z.string().optional(),
      is24Hours: z.coerce.boolean().default(false),
    })
  ),
  is24x7: z.coerce.boolean().default(false),
  emergencyContact: z.object({
    person: z.string(),
    number: z.string()
  }).optional(),
  vehicleType: z.enum(["bike", "car", "both"]).default("both"),
  spacesList: z.record(
    z.string().regex(/^[A-Z]{1,3}$/), 
    z.object({
      count: z.number().min(1),
      price: z.number().min(0),
    })
  ).optional(),
  parking_pass: z.coerce.boolean().optional(),
  transportationAvailable: z.coerce.boolean().optional(),
  transportationTypes: z.array(z.string()).optional(),
  coveredDrivewayAvailable: z.coerce.boolean().optional(),
  coveredDrivewayTypes: z.array(z.string()).optional(),
  securityCamera: z.coerce.boolean().optional(),
});

const CheckoutData = z.object({
  garageId: z.string(),
  bookedSlot: z.object({
    zone: z.string().regex(/^[A-Z]{1,3}$/),
    slot: z.coerce.number().max(1000).min(1)
  }),
  bookingPeriod: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime()
  }),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"]).optional(),
  vehicleNumber: z.string().min(5).optional()
}).refine((data) => data.bookingPeriod.from < data.bookingPeriod.to, {
  message: "Booking period is invalid",
  path: ["bookingPeriod"],
});

const BookingData = z.object({
  transactionId: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"]).optional(),
  bookingId: z.string(),
});

/**
 * Register a new garage
 */
export const registerGarage = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Create a mutable copy of req.body to parse stringified JSON fields
      const requestBody = { ...req.body };

      // Manually parse fields that are sent as stringified JSON from FormData
      if (typeof requestBody.location === 'string') {
        requestBody.location = JSON.parse(requestBody.location);
      }
      if (typeof requestBody.generalAvailable === 'string') {
        requestBody.generalAvailable = JSON.parse(requestBody.generalAvailable);
      }
      
      if (requestBody.emergencyContact && typeof requestBody.emergencyContact === 'string') {
        requestBody.emergencyContact = JSON.parse(requestBody.emergencyContact);
      }
      if (typeof requestBody.spacesList === 'string') {
        requestBody.spacesList = JSON.parse(requestBody.spacesList);
      }

      // Also parse stringified arrays for newly added fields
      if (requestBody.transportationTypes && typeof requestBody.transportationTypes === 'string') {
        requestBody.transportationTypes = JSON.parse(requestBody.transportationTypes);
      }
      if (requestBody.coveredDrivewayTypes && typeof requestBody.coveredDrivewayTypes === 'string') {
        requestBody.coveredDrivewayTypes = JSON.parse(requestBody.coveredDrivewayTypes);
      }

      // Also ensure boolean and number types are correctly coerced if they arrive as strings
      if (typeof requestBody.is24x7 === 'string') {
        requestBody.is24x7 = requestBody.is24x7 === 'true';
      }
      if (typeof requestBody.price === 'string') {
        requestBody.price = parseFloat(requestBody.price);
      }
      if (typeof requestBody.transportationAvailable === 'string') {
        requestBody.transportationAvailable = requestBody.transportationAvailable === 'true';
      }
      if (typeof requestBody.coveredDrivewayAvailable === 'string') {
        requestBody.coveredDrivewayAvailable = requestBody.coveredDrivewayAvailable === 'true';
      }
      if (typeof requestBody.securityCamera === 'string') {
        requestBody.securityCamera = requestBody.securityCamera === 'true';
      }

      // Validate full request with Zod
      const rData = GarageData.parse(requestBody);

      const verifiedAuth = await verifyAuthentication(req);
      if (verifiedAuth?.userType !== "merchant") {
        throw new ApiError(400, "INVALID_USER");
      }

      const owner = verifiedAuth.user;
      if (!owner) {
        throw new ApiError(400, "UNKNOWN_USER");
      }

      // Upload images to Cloudinary if present
      let imageURL: string[] = [];

      if (req.files) {
        if (Array.isArray(req.files)) {
          imageURL = await Promise.all(
            req.files.map((file) => uploadToCloudinary(file.buffer))
          ).then((e) => e.map((e) => e.secure_url));
        } else if (req.files.images) {
          imageURL = await Promise.all(
            (req.files.images as Express.Multer.File[]).map((file: Express.Multer.File) =>
              uploadToCloudinary(file.buffer)
            )
          ).then((e) => e.map((e) => e.secure_url));
        }
      }

      // Create new Garage record with all fields
      const newGarage = await Garage.create({
        owner: owner._id,
        images: imageURL,
        ...rData
      });

      // Update Merchant document to mark they now have a garage
      await mongoose.model("Merchant").findByIdAndUpdate(owner._id, {
        haveGarage: true
      });

      res.status(201).json(new ApiResponse(201, { garage: newGarage }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.log(err.issues);
        throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
      }
      console.log(err);
      throw err;
    }
  }
);

/**
 * Edit an existing garage
 */
export const editGarage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);

    // Create a mutable copy of req.body to parse stringified JSON fields
    const requestBody = { ...req.body };

    // Manually parse fields that are sent as stringified JSON from FormData
    if (typeof requestBody.location === 'string') {
      requestBody.location = JSON.parse(requestBody.location);
    }
    if (typeof requestBody.generalAvailable === 'string') {
      requestBody.generalAvailable = JSON.parse(requestBody.generalAvailable);
    }
    if (requestBody.emergencyContact && typeof requestBody.emergencyContact === 'string') {
      requestBody.emergencyContact = JSON.parse(requestBody.emergencyContact);
    }
    if (typeof requestBody.spacesList === 'string') {
      requestBody.spacesList = JSON.parse(requestBody.spacesList);
    }
    // Also ensure boolean and number types are correctly coerced if they arrive as strings
    if (typeof requestBody.is24x7 === 'string') {
        requestBody.is24x7 = requestBody.is24x7 === 'true';
    }
    if (typeof requestBody.price === 'string') {
        requestBody.price = parseFloat(requestBody.price);
    }

    const updateData = GarageData.partial().parse(requestBody); // Pass the parsed object to Zod

    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) {
      throw new ApiError(400, "UNAUTHORIZED");
    }

    const garage = await Garage.findById(garageId);
    if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");

    if (garage.owner.toString() !== verifiedAuth.user._id.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    let newlyUploadedImageURLs: string[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        newlyUploadedImageURLs = await Promise.all(
          req.files.map((file) => uploadToCloudinary(file.buffer))
        ).then((results) => results.map((r) => r.secure_url));
      } else if (req.files.images) {
        newlyUploadedImageURLs = await Promise.all(
          (req.files.images as Express.Multer.File[]).map((file: Express.Multer.File) => uploadToCloudinary(file.buffer))
        ).then((results) => results.map((r) => r.secure_url));
      }
    }

    let finalImages: string[] = [];

    // Start with existing images from the garage model
    finalImages = [...garage.images];

    // Handle existing image URLs sent from frontend
    if (requestBody.existingImages && typeof requestBody.existingImages === 'string') {
      const existingImagesFromFrontend: string[] = JSON.parse(requestBody.existingImages);
      finalImages = finalImages.filter(url => existingImagesFromFrontend.includes(url));
    }

    // Add newly uploaded images to the final list
    if (newlyUploadedImageURLs.length > 0) {
      finalImages = [...new Set([...finalImages, ...newlyUploadedImageURLs])];
    }

    // Assign the combined images to updateData
    updateData.images = finalImages;

    const updatedGarage = await Garage.findByIdAndUpdate(
      garageId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedGarage) {
      throw new ApiError(500, "FAILED_TO_UPDATE_GARAGE");
    }

    res.status(200).json(new ApiResponse(200, { garage: updatedGarage }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.log("Validation Issues:", err.issues);
      throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    }
    throw err;
  }
});

/**
 * Get available slots for a garage
 */
export const getAvailableGarageSlots = asyncHandler(async (req: Request, res: Response) => {
  try {
    const startDate = z.iso.datetime().parse(req.query.startDate);
    const endDate = z.iso.datetime().parse(req.query.endDate);
    const garageId = z.string().parse(req.query.garageId);

    const garage = await Garage.findById(garageId);
    if (!garage) {
      console.log("ID:", garageId);
      throw new ApiError(400, "GARAGE_NOT_FOUND");
    }
    
    let totalSpace = 0;
    garage.spacesList?.forEach((e) => { totalSpace += e.count });

    // Get all bookings that overlap with the requested time period
    const bookings = await GarageBooking.find({
      garageId,
      "paymentDetails.status": { $ne: "PENDING" },
      $or: [
        {
          'bookingPeriod.from': { $lte: new Date(endDate) },
          'bookingPeriod.to': { $gte: new Date(startDate) }
        },
        {
          'bookingPeriod.from': { $gte: new Date(startDate), $lte: new Date(endDate) }
        },
        {
          'bookingPeriod.to': { $gte: new Date(startDate), $lte: new Date(endDate) }
        }
      ]
    }, "-customerId").exec();

    res.status(200).json(new ApiResponse(200, { 
      availableSpace: totalSpace - bookings.length,
      bookedSlot: bookings.map((e) => ({
        rentedSlot: e.bookedSlot, 
        rentFrom: e.bookingPeriod?.from, 
        rentTo: e.bookingPeriod?.to
      })),
      isOpen: garage.isOpenNow()
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", err.issues);
    }
    console.log(err);
    throw err;
  }
});

/**
 * Checkout and process payment for a parking booking
 * FIXED VERSION - Handles invalid Stripe customer IDs gracefully
 */
export const checkoutGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("🚀 New checkout request");
    console.log("🔐 Validating Auth");
    
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }

    console.log("✅ Auth validated. User:", verifiedAuth.user._id);
    console.log("📋 Validating request data");
    
    const rData = CheckoutData.parse(req.body);
    console.log("✅ Request data validated:", {
      garageId: rData.garageId,
      slot: rData.bookedSlot,
      paymentMethod: rData.paymentMethod,
      vehicleNumber: rData.vehicleNumber
    });
    
    console.log("🏢 Verifying garage");
    const garage = await Garage.findById(rData.garageId).populate<{owner : IMerchant }>("owner", "-password");
    
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }
    
    console.log("✅ Garage verified:", garage.garageName);
    
    // Verify slot
    const selectedZone = garage?.spacesList?.get(rData.bookedSlot.zone);
    console.log("🎯 Verifying slot:", rData.bookedSlot.slot, "in zone:", rData.bookedSlot.zone);
    console.log("📊 Zone capacity:", selectedZone);
    
    if (!selectedZone || rData.bookedSlot.slot > selectedZone.count) {
      throw new ApiError(400, "INVALID_SLOT");
    }
    
    // Check availability
    const bookedSlotId = generateParkingSpaceID(rData.bookedSlot.zone, rData.bookedSlot.slot.toString());
    console.log("🔍 Checking availability for slot:", bookedSlotId);
    
    const isNotAvailableSlot = await GarageBooking.findOne({
      garageId: rData.garageId,
      bookedSlot: bookedSlotId,
      "paymentDetails.status": "SUCCESS",
      $or: [
        {
          'bookingPeriod.from': { $lte: new Date(rData.bookingPeriod.to) },
          'bookingPeriod.to': { $gte: new Date(rData.bookingPeriod.from) }
        },
        {
          'bookingPeriod.from': { $gte: new Date(rData.bookingPeriod.from), $lte: new Date(rData.bookingPeriod.to) }
        },
        {
          'bookingPeriod.to': { $gte: new Date(rData.bookingPeriod.from), $lte: new Date(rData.bookingPeriod.to) }
        }
      ]
    }); 
    
    if (isNotAvailableSlot) {
      console.log("❌ Slot not available. Found existing booking:", isNotAvailableSlot._id);
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }
    
    console.log("✅ Slot is available");
    
    // Calculate pricing
    const startDate = new Date(rData.bookingPeriod.from);
    const endDate = new Date(rData.bookingPeriod.to);
    const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    let totalAmount = totalHours * (selectedZone.price || 0);
    let discount = 0;
    let couponApplied = false;
    let couponDetails = null;

    const platformCharge = totalAmount * 0.1;
    
    console.log("💰 Pricing calculated:", {
      totalHours,
      baseAmount: totalAmount,
      platformCharge,
      totalToPay: totalAmount + platformCharge
    });
    
    // Apply coupon if provided
    if (rData.couponCode) {
      const isValidCoupon = await validateCoupon(rData.couponCode, verifiedAuth?.user);
      
      if (isValidCoupon) {
        discount = totalAmount * 0.1;
        couponApplied = true;
        couponDetails = {
          code: rData.couponCode,
          discount: discount,
          discountPercentage: 10
        };
        console.log("🎟️ Coupon applied:", discount);
      }
    }
    
    // Determine payment method and initialize if needed
    let paymentGateway: "CASH" | "STRIPE" | "UPI";
    let stripeDetails = null;
    
    console.log("💳 Processing payment method:", rData.paymentMethod);
    
    if (rData.paymentMethod === 'CREDIT') {
      paymentGateway = 'STRIPE';
      console.log("💳 Initializing Stripe for card payment");
      
      try {
        // FIX: Use the new validateOrCreateCustomer function
        // This handles all edge cases: missing customer, deleted customer, invalid customer
        const validCustomerId = await validateOrCreateCustomer(
          verifiedAuth.user.stripeCustomerId,
          verifiedAuth.user.firstName + " " + verifiedAuth.user.lastName,
          verifiedAuth.user.email
        );
        
        // Update user with valid customer ID if it changed
        if (validCustomerId !== verifiedAuth.user.stripeCustomerId) {
          await User.findByIdAndUpdate(verifiedAuth.user._id, { 
            stripeCustomerId: validCustomerId 
          });
          console.log("✅ User updated with new Stripe customer ID:", validCustomerId);
        }

        // Initialize payment with validated customer ID
        console.log("💳 Initializing Stripe payment intent");
        stripeDetails = await initPayment(
          totalAmount + platformCharge - discount, 
          validCustomerId
        );
        
        console.log("✅ Stripe payment initialized:", {
          paymentIntentId: stripeDetails.paymentIntentId,
          customerId: stripeDetails.customerId
        });
        
      } catch (stripeError: any) {
        console.error("❌ Stripe initialization failed:", stripeError);
        throw new ApiError(500, "STRIPE_INITIALIZATION_FAILED", {
          message: stripeError.message || "Failed to initialize Stripe payment"
        });
      }
      
    } else if (rData.paymentMethod === 'UPI') {
      paymentGateway = 'UPI';
      console.log("📱 UPI payment method selected");
      
    } else {
      paymentGateway = 'CASH';
      console.log("💵 CASH payment method selected");
    }
    
    // Prepare booking data
    console.log("📝 Creating booking document...");
    
    const paymentDetailsData: any = {
      amount: totalAmount + platformCharge - discount,
      method: rData.paymentMethod,
      status: 'PENDING',
      transactionId: null,
      paidAt: null,
      paymentGateway: paymentGateway
    };

    // Only add Stripe details if using Stripe
    if (paymentGateway === 'STRIPE' && stripeDetails) {
      paymentDetailsData.StripePaymentDetails = {
        paymentIntent: stripeDetails.paymentIntent,
        ephemeralKey: stripeDetails.ephemeralKey,
        paymentIntentId: stripeDetails.paymentIntentId,
        customerId: stripeDetails.customerId
      };
    }

    const bookingData = {
      garageId: rData.garageId,
      bookedSlot: bookedSlotId,
      customerId: verifiedAuth.user._id,
      bookingPeriod: {
        from: rData.bookingPeriod.from,
        to: rData.bookingPeriod.to
      },
      vehicleNumber: rData.vehicleNumber,
      totalAmount: totalAmount,
      discount: discount,
      amountToPaid: totalAmount + platformCharge - discount,
      platformCharge: platformCharge,
      priceRate: selectedZone.price,
      paymentDetails: paymentDetailsData,
      ...(couponApplied && { couponCode: rData.couponCode })
    };

    console.log("📄 Booking data prepared:", {
      slot: bookingData.bookedSlot,
      paymentGateway: bookingData.paymentDetails.paymentGateway,
      hasStripeDetails: !!bookingData.paymentDetails.StripePaymentDetails
    });

    // Create booking
    const booking = await GarageBooking.create(bookingData);

    console.log("✅ Booking created successfully:", {
      id: booking._id,
      slot: booking.bookedSlot,
      paymentGateway: booking.paymentDetails?.paymentGateway,
      status: booking.paymentDetails?.status
    });
    
    // Prepare response
    const response = {
      bookingId: booking._id,
      type: "G",
      garageName: garage.garageName,
      slot: booking.bookedSlot,
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      pricing: {
        priceRate: selectedZone.price,
        basePrice: totalHours * (selectedZone.price || 0),
        discount: discount,
        platformCharge,
        couponApplied: couponApplied,
        couponDetails: couponApplied ? couponDetails : null,
        totalAmount: totalAmount + platformCharge - discount
      },
      // Only include stripeDetails if they exist
      ...(stripeDetails && { stripeDetails }),
      placeInfo: {
        name: garage.garageName,
        phoneNo: garage.contactNumber,
        owner: garage.owner.firstName + " " + garage.owner.lastName,
        address: garage.address,
        location: garage.location,
      }
    };

    console.log("📤 Sending response with valid Stripe details");
    res.status(200).json(new ApiResponse(200, response));
    
  } catch (err) {
    console.error("❌ Checkout error:", err);
    if (err instanceof z.ZodError) {
      console.log("❌ Validation errors:", err.issues);
      throw new ApiError(400, 'VALIDATION_ERROR', err.issues);
    }
    throw err;
  }
});

// Helper function to validate coupon
async function validateCoupon(code: string, user: mongoose.Document<any, any, IUser>): Promise<boolean> {
  return code.startsWith('DISC');
}

/**
 * Confirm and finalize a garage booking
 * This endpoint is called after checkout to complete the booking
 */
export const bookGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);

    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }

    const {
      bookingId,
      carLicensePlateImage,
      paymentMethod,
      paymentIntentId,
    } = req.body;

    console.log("📖 Booking request:", {
      bookingId,
      paymentMethod,
      hasPaymentIntentId: !!paymentIntentId,
      user: verifiedAuth.user._id,
    });

    const booking = await GarageBooking.findById(bookingId);

    if (!booking) {
      throw new ApiError(404, "BOOKING_NOT_FOUND");
    }

    if (booking.customerId.toString() !== verifiedAuth.user._id.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_BOOKING_ACCESS");
    }

    if (booking.paymentDetails.status === "SUCCESS") {
      throw new ApiError(400, "ALREADY_BOOKED");
    }

    /**
     * =========================
     * CASH PAYMENT
     * =========================
     */
    if (paymentMethod === "CASH") {
      console.log("💰 Processing CASH payment:", bookingId);

      booking.paymentDetails.status = "SUCCESS";
      booking.paymentDetails.paidAt = new Date();
      booking.vehicleImage = carLicensePlateImage;

      await booking.save();

      console.log("✅ CASH booking confirmed:", bookingId);

      res.status(200).json(
        new ApiResponse(200, {
          message: "Booking confirmed with cash payment",
          bookingId: booking._id,
          paymentStatus: "SUCCESS",
          paymentMethod: "CASH",
          slot: booking.bookedSlot,
          vehicleNumber: booking.vehicleNumber,
        })
      );
      return;
    }

    /**
     * =========================
     * CARD / CREDIT PAYMENT
     * =========================
     */
    if (paymentMethod === "CREDIT" || paymentMethod === "CARD") {
      console.log("💳 Processing CARD payment:", bookingId);

      if (!paymentIntentId) {
        throw new ApiError(400, "PAYMENT_INTENT_REQUIRED");
      }

      try {
        console.log("🔄 Verifying Stripe payment...");

        const paymentIntent = await verifyPayment(paymentIntentId);

        console.log("✅ Payment intent verified:", {
          id: paymentIntent.id,
          status: paymentIntent.status,
        });

        if (paymentIntent.status !== "succeeded") {
          throw new ApiError(400, "UNSUCCESSFUL_TRANSACTION", {
            currentStatus: paymentIntent.status,
            requiredStatus: "succeeded",
          });
        }

        booking.paymentDetails.status = "SUCCESS";
        booking.paymentDetails.transactionId = paymentIntentId;
        booking.paymentDetails.paidAt = new Date();
        booking.vehicleImage = carLicensePlateImage;

        await booking.save();

        console.log("✅ CARD booking confirmed:", bookingId);

        res.status(200).json(
          new ApiResponse(200, {
            message: "Booking confirmed and payment successful",
            bookingId: booking._id,
            paymentStatus: "SUCCESS",
            paymentMethod: "CARD",
            transactionId: paymentIntentId,
            slot: booking.bookedSlot,
            vehicleNumber: booking.vehicleNumber,
          })
        );
        return;
      } catch (error) {
        console.error("❌ Payment verification failed:", error);
        throw new ApiError(400, "PAYMENT_VERIFICATION_FAILED", {
          message:
            error instanceof Error
              ? error.message
              : "Payment verification failed",
        });
      }
    }

    /**
     * =========================
     * INVALID PAYMENT METHOD
     * =========================
     */
    throw new ApiError(400, "INVALID_PAYMENT_METHOD");
  } catch (err) {
    console.error("❌ Booking confirmation error:", err);
    throw err;
  }
});




/**
 * Get garage details
 */
export const getGarageDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    
    const garage = await Garage.findById(garageId).populate<{owner: IMerchant}>("owner", "-password -otp -otpExpire");
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }
    
    console.log("GARAGE FOUND");
    res.status(200).json(new ApiResponse(200, { 
      garage,
      isOpen: garage.isOpenNow()
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_ID");
    }
    throw err;
  }
});

export const deleteGarage = asyncHandler(async (req, res) => {
  try {
    const garageId = z.string().parse(req.params.id);
    const authUser = await verifyAuthentication(req);
    if (!authUser?.user || authUser.userType !== "merchant") {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }
    
    const del = await Garage.findOneAndDelete({
      _id: garageId,
      owner: authUser?.user
    });
    
    if (!del) {
      if (await Garage.findById(garageId)) {
        throw new ApiError(403, "ACCESS_DENIED");
      }
      throw new ApiError(404, "NOT_FOUND");
    } else {
      res.status(200).json(new ApiResponse(200, del));
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_DATA");
    }
    throw error;
  }
});

export const getListOfGarage = asyncHandler(async (req, res) => {
  try {
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude = z.coerce.number().optional().parse(req.query.latitude);
    const owner = z.string().optional().parse(req.query.owner);
    
    const queries: mongoose.FilterQuery<IGarage> = {};
    if (owner) {
      queries.owner = owner;
    }
    
    if (longitude && latitude) {
      queries.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
      };
    }

    const result = await Garage.find(queries).exec();
    if (result) {
      console.log(result);
      res.status(200).json(new ApiResponse(200, result));
    } else {
      throw new ApiError(500);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", error.issues);
    } else if (error instanceof ApiError) {
      throw error;
    }
    console.log(error);
    throw new ApiError(500, "Server Error", error);
  }
});

/**
 * Get booking information for a specific garage booking
 */
export const garageBookingInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }
    
    // Find the booking and populate related data
    const booking = await GarageBooking.findById(bookingId)
      .populate<{garageId: IGarage & {owner: IMerchant}}>({
        path: 'garageId', 
        select: 'garageName address contactNumber _id owner',
        populate: {
          path: "owner",
          model: Merchant,
          select: "firstName lastName email phoneNumber _id"
        }
      })
      .orFail()
      .populate<{customerId: IUser}>('customerId', 'firstName lastName email phoneNumber _id')
      .orFail()
      .lean();

    const isCustomer = booking.customerId._id.toString() === verifiedAuth.user._id.toString();
    
    let isGarageOwner = false;
    if (!isCustomer) {
      const garage = await Garage.findById(booking.garageId);
      isGarageOwner = garage?.owner.toString() === verifiedAuth.user._id.toString();
    }

    // If neither the customer nor the garage owner, deny access
    if (!isCustomer && !isGarageOwner) {
      throw new ApiError(403, 'UNAUTHORIZED_ACCESS');
    }

    // Format the response
    console.log(booking);
    const response = {
      _id: booking._id,
      garage: {
        _id: booking.garageId._id,
        name: booking.garageId.garageName,
        address: booking.garageId.address,
        contactNumber: booking.garageId.contactNumber,
        ownerName: `${booking.garageId.owner?.firstName} ${booking.garageId.owner?.lastName}`
      },
      type: "G",
      customer: {
        _id: booking.customerId._id,
        name: `${booking.customerId.firstName} ${booking.customerId.lastName || ''}`.trim(),
        email: booking.customerId.email,
        phone: booking.customerId.phoneNumber
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      bookedSlot: booking.bookedSlot,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method,
        paidAt: booking.paymentDetails.paidAt,
        platformCharge: booking.platformCharge,
      }
    };

    res.status(200).json(new ApiResponse(200, response));
  } catch (error) {
    console.log(error);
    throw error;
  }
});

/**
 * Get a paginated list of garage bookings
 */
const BookingQueryParams = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(10),
  garageId: z.string().optional()
});

export const garageBookingList = asyncHandler(async (req, res) => {
  try {
    // Parse query parameters with defaults
    console.log("NEW Query Requested");
    const { page, limit, garageId } = BookingQueryParams.parse(req.query);
    const skip = (page - 1) * limit;

    // Verify authentication
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }

    // Build the base query
    const query: any = {};
    
    if (verifiedAuth.userType === 'user') {
      // For regular users, only show their own bookings
      query.customerId = verifiedAuth.user._id;
    } else if (verifiedAuth.userType === 'merchant') {
      // For merchants, show bookings for their garages
      if (garageId) {
        // Verify the garage belongs to the merchant
        const garage = await Garage.findOne({ 
          _id: garageId, 
          owner: verifiedAuth.user._id 
        });
        
        if (!garage) {
          throw new ApiError(404, 'GARAGE_NOT_FOUND_OR_ACCESS_DENIED');
        }
        query.garageId = garageId;
      } else {
        // If no garageId provided, get all garages owned by the merchant
        const merchantGarages = await Garage.find({ owner: verifiedAuth.user._id }, '_id');
        const garageIds = merchantGarages.map(g => g._id);
        
        if (garageIds.length === 0) {
          // No garages found for this merchant
          res.status(200).json(new ApiResponse(200, {
            bookings: [],
            pagination: {
              total: 0,
              page,
              size: limit
            }
          }));
          return;
        }
        query.garageId = { $in: garageIds };
      }
    } else {
      throw new ApiError(403, 'UNAUTHORIZED_ACCESS');
    }
    
    query["paymentDetails.status"] = { $ne: "PENDING" };
    console.log("query at garage:", query);
    
    // Get paginated bookings with related data
    const bookings = await GarageBooking.find(query)
      .populate<{garageId: IGarage & {owner: IMerchant}}>({
        path: 'garageId', 
        select: 'garageName address contactNumber _id owner',
        populate: {
          path: "owner",
          model: Merchant,
          select: "firstName lastName email phoneNumber _id"
        }
      })
      .populate<{customerId: IUser}>('customerId', 'firstName lastName email phoneNumber _id')
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .lean();

    // Format the response
    console.log("found garage booking", bookings.length);
    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      garage: {
        _id: booking.garageId?._id,
        name: booking.garageId?.garageName,
        address: booking.garageId?.address,
        contactNumber: booking.garageId?.contactNumber
      },
      customer: {
        _id: booking.customerId?._id,
        name: `${booking.customerId?.firstName} ${booking.customerId?.lastName || ''}`.trim(),
        email: booking.customerId?.email,
        phone: booking.customerId?.phoneNumber
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      bookedSlot: booking.bookedSlot,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method,
        paidAt: booking.paymentDetails.paidAt,
        platformCharge: booking.platformCharge,
      },
      status: booking.paymentDetails.status,
      type: "G",
    }));

    res.status(200).json(new ApiResponse(200, {
      bookings: formattedBookings,
      pagination: {
        page,
        size: limit
      }
    }));
  } catch (error) {
    console.error('Error in bookingList:', error);
    throw error;
  }
});

export const scanBookingQRCode = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id;

  const verifiedAuth = await verifyAuthentication(req);
  if (!verifiedAuth?.user) {
    throw new ApiError(401, "Unauthorized");
  }

  const booking = await GarageBooking.findById(bookingId)
    .populate({
      path: "garageId",
      select: "garageName address contactNumber owner",
      populate: {
        path: "owner",
        model: Merchant,
        select: "firstName lastName email phoneNumber",
      },
    })
    .populate({
      path: "customerId",
      model: User,
      select: "firstName lastName email phoneNumber",
    });

  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }

  const garage = booking.garageId as any;
  const customer = booking.customerId as any;

  const formattedData = {
    _id: booking._id,
    garage: {
      _id: garage?._id,
      name: garage?.garageName,
      address: garage?.address,
      contactNumber: garage?.contactNumber,
      owner: {
        _id: garage?.owner?._id,
        name: `${garage?.owner?.firstName} ${garage?.owner?.lastName || ""}`.trim(),
        email: garage?.owner?.email,
        phone: garage?.owner?.phoneNumber,
      },
    },
    customer: {
      _id: customer?._id,
      name: `${customer?.firstName} ${customer?.lastName || ""}`.trim(),
      email: customer?.email,
      phone: customer?.phoneNumber,
    },
    bookingPeriod: booking.bookingPeriod,
    vehicleNumber: booking.vehicleNumber,
    bookedSlot: booking.bookedSlot,
    priceRate: booking.priceRate,
    paymentDetails: {
      totalAmount: booking.totalAmount,
      amountPaid: booking.amountToPaid,
      discount: booking.discount,
      status: booking.paymentDetails.status,
      method: booking.paymentDetails.method,
      paidAt: booking.paymentDetails.paidAt,
    },
    status: booking.paymentDetails.status,
    type: "G",
  };

  res.status(200).json(
    new ApiResponse(200, formattedData, "Booking data fetched via QR successfully")
  );
});
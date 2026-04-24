import { Request, Response } from "express";
import { Garage, GarageBooking, IGarage, IGarageBooking } from "../models/merchant.garage.model.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { IUser, User } from "../models/normalUser.model.js";
import {
  createStripeCustomer,
  initPayment,
  validateOrCreateCustomer,
  stripe,
  verifyPayment,
} from "../utils/stripePayments.js";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import QRCode from "qrcode";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const GarageData = z.object({
  garageName: z.string().min(1, "Garage name is required"),
  about: z.string().min(1, "About is required"),
  address: z.string().min(1, "Address is required"),
  price: z.coerce.number().optional(),
  location: z
    .object({
      type: z.literal("Point"),
      coordinates: z.tuple([
        z.coerce.number().gte(-180).lte(180),
        z.coerce.number().gte(-90).lte(90),
      ]),
    })
    .optional(),
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
  emergencyContact: z
    .object({ person: z.string(), number: z.string() })
    .optional(),
  vehicleType: z.enum(["bike", "car", "both"]).default("both"),
  spacesList: z
    .record(
      z.string().regex(/^[A-Z]{1,3}$/),
      z.object({ count: z.number().min(1), price: z.number().min(0) })
    )
    .optional(),
  parking_pass: z.coerce.boolean().optional(),
  transportationAvailable: z.coerce.boolean().optional(),
  transportationTypes: z.array(z.string()).optional(),
  coveredDrivewayAvailable: z.coerce.boolean().optional(),
  coveredDrivewayTypes: z.array(z.string()).optional(),
  securityCamera: z.coerce.boolean().optional(),
  monthlyChargeEnabled: z.coerce.boolean().optional().default(false),
  monthlyRate: z.coerce.number().min(0).optional().default(0),
});

const CheckoutData = z
  .object({
    garageId: z.string(),
    bookedSlot: z.object({
      zone: z.string().regex(/^[A-Z]{1,3}$/),
      slot: z.coerce.number().max(1000).min(1),
    }),
    bookingPeriod: z.object({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
    }),
    couponCode: z.string().optional(),
    paymentMethod: z
      .enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"])
      .optional(),
    vehicleNumber: z.string().min(5).optional(),
    // ── Monthly booking ───────────────────────────────────────
    isMonthly: z.coerce.boolean().optional().default(false),
    months: z.coerce.number().int().min(1).max(12).optional().default(1),
  })
  .refine((data) => data.bookingPeriod.from < data.bookingPeriod.to, {
    message: "Booking period is invalid",
    path: ["bookingPeriod"],
  });

const BookingData = z.object({
  transactionId: z.string().optional(),
  paymentMethod: z
    .enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"])
    .optional(),
  bookingId: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function validateCoupon(
  code: string,
  user: mongoose.Document<any, any, IUser>
): Promise<boolean> {
  return code.startsWith("DISC");
}

/**
 * Compute all pricing fields for a garage booking.
 * Supports both hourly and monthly modes.
 */
function computeGaragePricing(
  isMonthly: boolean,
  months: number,
  bookingFrom: Date,
  bookingTo: Date,
  zonePrice: number,           // per-hour price from spacesList
  garageMonthlyEnabled: boolean,
  garageMonthlyRate: number,   // flat monthly rate set by merchant (0 = not set)
  discount: number
) {
  let totalHours: number;
  let baseRate: number;
  let totalAmount: number;

  if (isMonthly) {
    // 730 h = average hours in a calendar month (365 × 24 / 12)
    totalHours = months * 730;
    // Prefer the merchant's dedicated monthly rate; fall back to hourly × 730
    const useFlat = garageMonthlyEnabled && garageMonthlyRate > 0;
    baseRate    = useFlat ? garageMonthlyRate : zonePrice * 730;
    totalAmount = baseRate * months;
  } else {
    totalHours  = (bookingTo.getTime() - bookingFrom.getTime()) / (1000 * 60 * 60);
    baseRate    = zonePrice;
    totalAmount = totalHours * zonePrice;
  }

  const serviceFee     = totalAmount * 0.05;
  const transactionFee = 0.5;
  const estimatedTaxes = totalAmount * 0.15;
  const amountToPaid   = totalAmount + serviceFee + transactionFee + estimatedTaxes - discount;

  return { totalHours, baseRate, totalAmount, serviceFee, transactionFee, estimatedTaxes, amountToPaid };
}

// ─────────────────────────────────────────────────────────────────────────────
// Register a new garage
// ─────────────────────────────────────────────────────────────────────────────

export const registerGarage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const requestBody = { ...req.body };

    if (typeof requestBody.location === "string")           requestBody.location           = JSON.parse(requestBody.location);
    if (typeof requestBody.generalAvailable === "string")   requestBody.generalAvailable   = JSON.parse(requestBody.generalAvailable);
    if (requestBody.emergencyContact && typeof requestBody.emergencyContact === "string") requestBody.emergencyContact = JSON.parse(requestBody.emergencyContact);
    if (typeof requestBody.spacesList === "string")         requestBody.spacesList         = JSON.parse(requestBody.spacesList);
    if (requestBody.transportationTypes && typeof requestBody.transportationTypes === "string") requestBody.transportationTypes = JSON.parse(requestBody.transportationTypes);
    if (requestBody.coveredDrivewayTypes && typeof requestBody.coveredDrivewayTypes === "string") requestBody.coveredDrivewayTypes = JSON.parse(requestBody.coveredDrivewayTypes);

    const boolFields = ["is24x7", "transportationAvailable", "coveredDrivewayAvailable", "securityCamera"];
    boolFields.forEach((f) => { if (typeof requestBody[f] === "string") requestBody[f] = requestBody[f] === "true"; });
    if (typeof requestBody.price === "string") requestBody.price = parseFloat(requestBody.price);

    const rData = GarageData.parse(requestBody);

    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
    const owner = verifiedAuth.user;
    if (!owner) throw new ApiError(400, "UNKNOWN_USER");

    let imageURL: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      imageURL = await Promise.all(files.map((f) => uploadToCloudinary(f.buffer))).then((r) => r.map((e) => e.secure_url));
    }

    const newGarage = await Garage.create({ owner: owner._id, images: imageURL, ...rData });
    await mongoose.model("Merchant").findByIdAndUpdate(owner._id, { haveGarage: true });

    res.status(201).json(new ApiResponse(201, { garage: newGarage }));
  } catch (err) {
    if (err instanceof z.ZodError) { console.log(err.issues); throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues); }
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit an existing garage
// ─────────────────────────────────────────────────────────────────────────────

export const editGarage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    const requestBody = { ...req.body };

    if (typeof requestBody.location === "string")         requestBody.location         = JSON.parse(requestBody.location);
    if (typeof requestBody.generalAvailable === "string") requestBody.generalAvailable = JSON.parse(requestBody.generalAvailable);
    if (requestBody.emergencyContact && typeof requestBody.emergencyContact === "string") requestBody.emergencyContact = JSON.parse(requestBody.emergencyContact);
    if (typeof requestBody.spacesList === "string")       requestBody.spacesList       = JSON.parse(requestBody.spacesList);
    if (typeof requestBody.is24x7 === "string")           requestBody.is24x7           = requestBody.is24x7 === "true";
    if (typeof requestBody.price === "string")            requestBody.price            = parseFloat(requestBody.price);

    const updateData = GarageData.partial().parse(requestBody);

    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) throw new ApiError(400, "UNAUTHORIZED");

    const garage = await Garage.findById(garageId);
    if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");
    if (garage.owner.toString() !== verifiedAuth.user._id.toString()) throw new ApiError(403, "UNAUTHORIZED_ACCESS");

    let newImages: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images as Express.Multer.File[];
      newImages = await Promise.all(files.map((f) => uploadToCloudinary(f.buffer))).then((r) => r.map((e) => e.secure_url));
    }

    let finalImages = [...garage.images];
    if (requestBody.existingImages && typeof requestBody.existingImages === "string") {
      const keep: string[] = JSON.parse(requestBody.existingImages);
      finalImages = finalImages.filter((u) => keep.includes(u));
    }
    if (newImages.length > 0) finalImages = [...new Set([...finalImages, ...newImages])];
    updateData.images = finalImages;

    const updatedGarage = await Garage.findByIdAndUpdate(garageId, { $set: updateData }, { new: true, runValidators: true });
    if (!updatedGarage) throw new ApiError(500, "FAILED_TO_UPDATE_GARAGE");

    res.status(200).json(new ApiResponse(200, { garage: updatedGarage }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Get available slots
// ─────────────────────────────────────────────────────────────────────────────

export const getAvailableGarageSlots = asyncHandler(async (req: Request, res: Response) => {
  try {
    const startDate = z.iso.datetime().parse(req.query.startDate);
    const endDate   = z.iso.datetime().parse(req.query.endDate);
    const garageId  = z.string().parse(req.query.garageId);

    const garage = await Garage.findById(garageId);
    if (!garage) throw new ApiError(400, "GARAGE_NOT_FOUND");

    let totalSpace = 0;
    garage.spacesList?.forEach((e) => { totalSpace += e.count; });

    const bookings = await GarageBooking.find({
      garageId,
      "paymentDetails.status": "SUCCESS",
      "bookingPeriod.from": { $lt: new Date(endDate) },
      "bookingPeriod.to":   { $gt: new Date(startDate) },
    }, "-customerId").exec();

    res.status(200).json(new ApiResponse(200, {
      availableSpace: totalSpace - bookings.length,
      bookedSlot: bookings.map((e) => ({
        rentedSlot: e.bookedSlot,
        rentFrom:   e.bookingPeriod?.from,
        rentTo:     e.bookingPeriod?.to,
      })),
      isOpen: garage.isOpenNow(),
    }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", err.issues);
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Checkout — create a pending booking with Stripe / cash details
// ─────────────────────────────────────────────────────────────────────────────

export const checkoutGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("🚀 New checkout request");

    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) throw new ApiError(401, "UNAUTHORIZED");

    const rData = CheckoutData.parse(req.body);

    const garage = await Garage.findById(rData.garageId).populate<{ owner: IMerchant }>("owner", "-password");
    if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");

    const selectedZone = garage.spacesList?.get(rData.bookedSlot.zone);
    if (!selectedZone || rData.bookedSlot.slot > selectedZone.count) throw new ApiError(400, "INVALID_SLOT");

    const bookedSlotId = generateParkingSpaceID(rData.bookedSlot.zone, rData.bookedSlot.slot.toString());

    const isNotAvailableSlot = await GarageBooking.findOne({
      garageId:                 rData.garageId,
      bookedSlot:               bookedSlotId,
      "paymentDetails.status":  "SUCCESS",
      "bookingPeriod.from":     { $lt: new Date(rData.bookingPeriod.to) },
      "bookingPeriod.to":       { $gt: new Date(rData.bookingPeriod.from) },
    });
    if (isNotAvailableSlot) throw new ApiError(400, "SLOT_NOT_AVAILABLE");

    // ── Extract monthly flags ──────────────────────────────────────────────
    const isMonthly = rData.isMonthly ?? false;
    const months    = rData.months    ?? 1;

    // ── Coupon ────────────────────────────────────────────────────────────
    let discount      = 0;
    let couponApplied = false;
    let couponDetails: any = null;

    if (rData.couponCode) {
      const valid = await validateCoupon(rData.couponCode, verifiedAuth.user as any);
      if (valid) {
        // coupon is computed after totalAmount is known — pass 0 now, recalculate below
        couponApplied = true;
        couponDetails = { code: rData.couponCode, discountPercentage: 10 };
      }
    }

    // ── Pricing ───────────────────────────────────────────────────────────
    const startDate = new Date(rData.bookingPeriod.from);
    const endDate   = new Date(rData.bookingPeriod.to);

    // Compute totalAmount first (without discount) so we can derive the coupon amount
    const preliminary = computeGaragePricing(
      isMonthly, months, startDate, endDate,
      selectedZone.price,
      garage.monthlyChargeEnabled ?? false,
      garage.monthlyRate          ?? 0,
      0 // discount not yet applied
    );

    if (couponApplied) {
      discount = preliminary.totalAmount * 0.1;
      couponDetails.discount = discount;
    }

    const { totalHours, baseRate, totalAmount, serviceFee, transactionFee, estimatedTaxes, amountToPaid }
      = computeGaragePricing(
          isMonthly, months, startDate, endDate,
          selectedZone.price,
          garage.monthlyChargeEnabled ?? false,
          garage.monthlyRate          ?? 0,
          discount
        );

    // ── Payment gateway ───────────────────────────────────────────────────
    let paymentGateway: "CASH" | "STRIPE" | "UPI";
    let stripeDetails: any = null;

    if (rData.paymentMethod === "CREDIT") {
      paymentGateway = "STRIPE";
      const validCustomerId = await validateOrCreateCustomer(
        verifiedAuth.user.stripeCustomerId,
        `${verifiedAuth.user.firstName} ${verifiedAuth.user.lastName}`,
        verifiedAuth.user.email
      );
      if (validCustomerId !== verifiedAuth.user.stripeCustomerId) {
        await User.findByIdAndUpdate(verifiedAuth.user._id, { stripeCustomerId: validCustomerId });
      }
      stripeDetails = await initPayment(amountToPaid, validCustomerId);
    } else if (rData.paymentMethod === "UPI") {
      paymentGateway = "UPI";
    } else {
      paymentGateway = "CASH";
    }

    // ── Build paymentDetails ──────────────────────────────────────────────
    const paymentDetailsData: IGarageBooking["paymentDetails"] = {
      amount:         amountToPaid,
      method:         (rData.paymentMethod as any) ?? "CASH",
      status:         "PENDING",
      transactionId:  undefined,
      paidAt:         null,
      paymentGateway,
      ...(paymentGateway === "STRIPE" && stripeDetails
        ? { StripePaymentDetails: {
              paymentIntent:   stripeDetails.paymentIntent,
              ephemeralKey:    stripeDetails.ephemeralKey,
              paymentIntentId: stripeDetails.paymentIntentId,
              customerId:      stripeDetails.customerId,
            } }
        : {}),
    };

    // ── Create booking document ───────────────────────────────────────────
    const booking = await GarageBooking.create({
      garageId:      rData.garageId,
      bookedSlot:    bookedSlotId,
      customerId:    verifiedAuth.user._id,
      bookingPeriod: { from: rData.bookingPeriod.from, to: rData.bookingPeriod.to },
      vehicleNumber: rData.vehicleNumber,
      totalAmount,
      discount,
      serviceFee,
      transactionFee,
      estimatedTaxes,
      amountToPaid,
      priceRate:     baseRate,
      paymentDetails: paymentDetailsData,
      // ── Monthly ───────────────────────────────────────────
      isMonthly,
      months: isMonthly ? months : undefined,
      ...(couponApplied && { couponCode: rData.couponCode }),
    });

    const response = {
      bookingId:     booking._id,
      type:          "G",
      garageName:    garage.garageName,
      slot:          booking.bookedSlot,
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      pricing: {
        priceRate:      baseRate,
        basePrice:      totalAmount,
        discount,
        serviceFee,
        transactionFee,
        estimatedTaxes,
        couponApplied,
        couponDetails:  couponApplied ? couponDetails : null,
        totalAmount:    amountToPaid,
        // ── Monthly ─────────────────────────────────────────
        isMonthly,
        months:         isMonthly ? months : undefined,
      },
      ...(stripeDetails && { stripeDetails }),
      placeInfo: {
        name:    garage.garageName,
        phoneNo: garage.contactNumber,
        owner:   `${garage.owner.firstName} ${garage.owner.lastName}`,
        address: garage.address,
        location: garage.location,
      },
    };

    res.status(200).json(new ApiResponse(200, response));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "VALIDATION_ERROR", err.issues);
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Book — confirm payment and mark booking SUCCESS
// ─────────────────────────────────────────────────────────────────────────────

export const bookGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) throw new ApiError(401, "UNAUTHORIZED");

    const { bookingId, carLicensePlateImage, paymentMethod, paymentIntentId } = req.body;

    const booking = await GarageBooking.findById(bookingId);
    if (!booking)                                                     throw new ApiError(404, "BOOKING_NOT_FOUND");
    if (booking.customerId.toString() !== verifiedAuth.user._id.toString()) throw new ApiError(403, "UNAUTHORIZED_BOOKING_ACCESS");
    if (booking.paymentDetails.status === "SUCCESS")                  throw new ApiError(400, "ALREADY_BOOKED");

    // Final conflict check
    const conflict = await GarageBooking.findOne({
      _id:                      { $ne: booking._id },
      garageId:                 booking.garageId,
      bookedSlot:               booking.bookedSlot,
      "paymentDetails.status":  "SUCCESS",
      "bookingPeriod.from":     { $lt: booking.bookingPeriod.to },
      "bookingPeriod.to":       { $gt: booking.bookingPeriod.from },
    });
    if (conflict) {
      booking.paymentDetails.status = "FAILED";
      await booking.save();
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    if (paymentMethod === "CASH") {
      booking.paymentDetails.status = "SUCCESS";
      booking.paymentDetails.paidAt = new Date();
      booking.vehicleImage          = carLicensePlateImage;
      await booking.save();
      return res.status(200).json(new ApiResponse(200, {
        message:       "Booking confirmed with cash payment",
        bookingId:     booking._id,
        paymentStatus: "SUCCESS",
        paymentMethod: "CASH",
        slot:          booking.bookedSlot,
        vehicleNumber: booking.vehicleNumber,
      }));
    }

    if (paymentMethod === "CREDIT" || paymentMethod === "CARD") {
      if (!paymentIntentId) throw new ApiError(400, "PAYMENT_INTENT_REQUIRED");
      const paymentIntent = await verifyPayment(paymentIntentId);
      if (paymentIntent.status !== "succeeded") throw new ApiError(400, "UNSUCCESSFUL_TRANSACTION");

      booking.paymentDetails.status        = "SUCCESS";
      booking.paymentDetails.transactionId = paymentIntentId;
      booking.paymentDetails.paidAt        = new Date();
      booking.vehicleImage                 = carLicensePlateImage;
      await booking.save();
      return res.status(200).json(new ApiResponse(200, {
        message:       "Booking confirmed and payment successful",
        bookingId:     booking._id,
        paymentStatus: "SUCCESS",
        paymentMethod: "CREDIT",
        transactionId: paymentIntentId,
        slot:          booking.bookedSlot,
        vehicleNumber: booking.vehicleNumber,
      }));
    }

    throw new ApiError(400, "INVALID_PAYMENT_METHOD");
  } catch (err) {
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Get garage details
// ─────────────────────────────────────────────────────────────────────────────

export const getGarageDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    const garage = await Garage.findById(garageId).populate<{ owner: IMerchant }>("owner", "-password -otp -otpExpire");
    if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");
    res.status(200).json(new ApiResponse(200, { garage, isOpen: garage.isOpenNow() }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "INVALID_ID");
    throw err;
  }
});

export const deleteGarage = asyncHandler(async (req, res) => {
  try {
    const garageId = z.string().parse(req.params.id);
    const authUser = await verifyAuthentication(req);
    if (!authUser?.user || authUser.userType !== "merchant") throw new ApiError(403, "UNAUTHORIZED_ACCESS");

    const del = await Garage.findOneAndDelete({ _id: garageId, owner: authUser.user });
    if (!del) {
      if (await Garage.findById(garageId)) throw new ApiError(403, "ACCESS_DENIED");
      throw new ApiError(404, "NOT_FOUND");
    }
    res.status(200).json(new ApiResponse(200, del));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_DATA");
    throw error;
  }
});

export const getListOfGarage = asyncHandler(async (req, res) => {
  try {
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude  = z.coerce.number().optional().parse(req.query.latitude);
    const owner     = z.string().optional().parse(req.query.owner);

    const queries: mongoose.FilterQuery<IGarage> = {};
    if (owner) queries.owner = owner;
    if (longitude && latitude) {
      queries.location = { $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] } } };
    }

    const result = await Garage.find(queries).exec();
    if (result) res.status(200).json(new ApiResponse(200, result));
    else throw new ApiError(500);
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", error.issues);
    else if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Server Error", error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Booking info / list
// ─────────────────────────────────────────────────────────────────────────────

export const garageBookingInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId    = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) throw new ApiError(401, "UNAUTHORIZED");

    const booking = await GarageBooking.findById(bookingId)
      .populate<{ garageId: IGarage & { owner: IMerchant } }>({
        path: "garageId",
        select: "garageName address contactNumber _id owner",
        populate: { path: "owner", model: Merchant, select: "firstName lastName email phoneNumber _id" },
      })
      .orFail()
      .populate<{ customerId: IUser }>("customerId", "firstName lastName email phoneNumber _id")
      .orFail()
      .lean();

    const isCustomer    = booking.customerId._id.toString() === verifiedAuth.user._id.toString();
    let isGarageOwner   = false;
    if (!isCustomer) {
      const garage = await Garage.findById(booking.garageId);
      isGarageOwner = garage?.owner.toString() === verifiedAuth.user._id.toString();
    }
    if (!isCustomer && !isGarageOwner) throw new ApiError(403, "UNAUTHORIZED_ACCESS");

    res.status(200).json(new ApiResponse(200, {
      _id: booking._id,
      garage: {
        _id:           (booking.garageId as any)._id,
        name:          (booking.garageId as any).garageName,
        address:       (booking.garageId as any).address,
        contactNumber: (booking.garageId as any).contactNumber,
        ownerName:     `${(booking.garageId as any).owner?.firstName} ${(booking.garageId as any).owner?.lastName}`,
      },
      type: "G",
      customer: {
        _id:   booking.customerId._id,
        name:  `${booking.customerId.firstName} ${booking.customerId.lastName || ""}`.trim(),
        email: booking.customerId.email,
        phone: booking.customerId.phoneNumber,
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      bookedSlot:    booking.bookedSlot,
      priceRate:     booking.priceRate,
      isMonthly:     booking.isMonthly,
      months:        booking.months,
      paymentDetails: {
        totalAmount:    booking.totalAmount,
        amountPaid:     booking.amountToPaid,
        discount:       booking.discount,
        serviceFee:     booking.serviceFee,
        transactionFee: booking.transactionFee,
        estimatedTaxes: booking.estimatedTaxes,
        status:         booking.paymentDetails.status,
        method:         booking.paymentDetails.method,
        paidAt:         booking.paymentDetails.paidAt,
      },
    }));
  } catch (error) {
    throw error;
  }
});

const BookingQueryParams = z.object({
  page:     z.coerce.number().min(1).default(1),
  limit:    z.coerce.number().min(1).default(10),
  garageId: z.string().optional(),
});

export const garageBookingList = asyncHandler(async (req, res) => {
  try {
    const { page, limit, garageId } = BookingQueryParams.parse(req.query);
    const skip = (page - 1) * limit;

    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) throw new ApiError(401, "UNAUTHORIZED");

    const query: any = {};

    if (verifiedAuth.userType === "user") {
      query.customerId = verifiedAuth.user._id;
    } else if (verifiedAuth.userType === "merchant") {
      if (garageId) {
        const garage = await Garage.findOne({ _id: garageId, owner: verifiedAuth.user._id });
        if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND_OR_ACCESS_DENIED");
        query.garageId = garageId;
      } else {
        const merchantGarages = await Garage.find({ owner: verifiedAuth.user._id }, "_id");
        const garageIds = merchantGarages.map((g) => g._id);
        if (garageIds.length === 0) {
          return res.status(200).json(new ApiResponse(200, { bookings: [], pagination: { total: 0, page, size: limit } }));
        }
        query.garageId = { $in: garageIds };
      }
    } else {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    query["paymentDetails.status"] = { $ne: "PENDING" };

    const bookings = await GarageBooking.find(query)
      .populate<{ garageId: IGarage & { owner: IMerchant } }>({
        path: "garageId",
        select: "garageName address contactNumber _id owner",
        populate: { path: "owner", model: Merchant, select: "firstName lastName email phoneNumber _id" },
      })
      .populate<{ customerId: IUser }>("customerId", "firstName lastName email phoneNumber _id")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedBookings = bookings.map((b) => ({
      _id:       b._id,
      createdAt: b.createdAt,
      garage: {
        _id:           (b.garageId as any)?._id,
        name:          (b.garageId as any)?.garageName,
        address:       (b.garageId as any)?.address,
        contactNumber: (b.garageId as any)?.contactNumber,
      },
      customer: {
        _id:   (b.customerId as any)?._id,
        name:  `${(b.customerId as any)?.firstName} ${(b.customerId as any)?.lastName || ""}`.trim(),
        email: (b.customerId as any)?.email,
        phone: (b.customerId as any)?.phoneNumber,
      },
      bookingPeriod: b.bookingPeriod,
      vehicleNumber: b.vehicleNumber,
      bookedSlot:    b.bookedSlot,
      priceRate:     b.priceRate,
      isMonthly:     b.isMonthly,
      months:        b.months,
      paymentDetails: {
        totalAmount:    b.totalAmount,
        amountPaid:     b.amountToPaid,
        discount:       b.discount,
        serviceFee:     b.serviceFee,
        transactionFee: b.transactionFee,
        estimatedTaxes: b.estimatedTaxes,
        status:         b.paymentDetails.status,
        method:         b.paymentDetails.method,
        paidAt:         b.paymentDetails.paidAt,
      },
      status:        b.paymentDetails.status,
      type:          "G",
      earlyCheckOut: (b as any).earlyCheckOut || null,
    }));

    res.status(200).json(new ApiResponse(200, { bookings: formattedBookings, pagination: { page, size: limit } }));
  } catch (error) {
    throw error;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scan QR code
// ─────────────────────────────────────────────────────────────────────────────

export const scanBookingQRCode = asyncHandler(async (req: Request, res: Response) => {
  const bookingId    = req.params.id;
  const verifiedAuth = await verifyAuthentication(req);
  if (!verifiedAuth?.user) throw new ApiError(401, "Unauthorized");

  const booking = await GarageBooking.findById(bookingId)
    .populate({ path: "garageId", select: "garageName address contactNumber owner", populate: { path: "owner", model: Merchant, select: "firstName lastName email phoneNumber" } })
    .populate({ path: "customerId", model: User, select: "firstName lastName email phoneNumber" });

  if (!booking) throw new ApiError(404, "Booking not found");

  const garage   = booking.garageId as any;
  const customer = booking.customerId as any;

  res.status(200).json(new ApiResponse(200, {
    _id: booking._id,
    garage: {
      _id:  garage?._id,
      name: garage?.garageName,
      address: garage?.address,
      contactNumber: garage?.contactNumber,
      owner: { _id: garage?.owner?._id, name: `${garage?.owner?.firstName} ${garage?.owner?.lastName || ""}`.trim(), email: garage?.owner?.email, phone: garage?.owner?.phoneNumber },
    },
    customer: { _id: customer?._id, name: `${customer?.firstName} ${customer?.lastName || ""}`.trim(), email: customer?.email, phone: customer?.phoneNumber },
    bookingPeriod: booking.bookingPeriod,
    vehicleNumber: booking.vehicleNumber,
    bookedSlot:    booking.bookedSlot,
    priceRate:     booking.priceRate,
    isMonthly:     booking.isMonthly,
    months:        booking.months,
    paymentDetails: {
      totalAmount:    booking.totalAmount,
      amountPaid:     booking.amountToPaid,
      discount:       booking.discount,
      serviceFee:     booking.serviceFee,
      transactionFee: booking.transactionFee,
      estimatedTaxes: booking.estimatedTaxes,
      status:         booking.paymentDetails.status,
      method:         booking.paymentDetails.method,
      paidAt:         booking.paymentDetails.paidAt,
    },
    status: booking.paymentDetails.status,
    type:   "G",
  }, "Booking data fetched via QR successfully"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Mark slot vacant (early checkout by merchant)
// ─────────────────────────────────────────────────────────────────────────────

export const markGarageSlotVacant = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId    = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);

    if (!verifiedAuth?.user || verifiedAuth.userType !== "merchant") throw new ApiError(403, "Only merchants can mark a slot vacant");

    const booking = await GarageBooking.findById(bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
    if (booking.paymentDetails.status !== "SUCCESS") throw new ApiError(400, "Only confirmed (SUCCESS) bookings can be vacated");

    const now = new Date();
    if (new Date(booking.bookingPeriod!.to as unknown as string) <= now) throw new ApiError(400, "Booking has already expired — slot is already free");

    const garage = await Garage.findById(booking.garageId);
    if (!garage) throw new ApiError(404, "GARAGE_NOT_FOUND");
    if (garage.owner.toString() !== verifiedAuth.user._id.toString()) throw new ApiError(403, "You do not own this garage");
    if ((booking as any).earlyCheckOut) throw new ApiError(400, "Slot has already been marked vacant");

    const originalTo = booking.bookingPeriod!.to;

    await GarageBooking.findByIdAndUpdate(bookingId, {
      $set: { "bookingPeriod.to": now, earlyCheckOut: { markedAt: now, markedBy: verifiedAuth.user._id, originalTo } },
    });

    res.status(200).json(new ApiResponse(200, { bookingId, slot: booking.bookedSlot, markedVacantAt: now, originalCheckOut: originalTo }, "Slot marked vacant successfully. It is now available for new bookings."));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "Invalid booking ID");
    throw error;
  }
});
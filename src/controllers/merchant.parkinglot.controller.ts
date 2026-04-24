import { Request, Response } from "express";
import {
  ILotRecord,
  IMerchant,
  IParking,
  LotRentRecordModel,
  Merchant,
  ParkingLotModel,
} from "../models/merchant.model.js";
import { BookingData, ParkingData } from "../zodTypes/merchantData.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import { IUser, User } from "../models/normalUser.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import {
  createStripeCustomer,
  initPayment,
  updateStripePayment,
  verifyStripePayment,
} from "../utils/stripePayments.js";

type MParkingRes = mongoose.Document<mongoose.Types.ObjectId, {}, IParking> & IParking;
type MLotRecordRes = mongoose.Document<mongoose.Types.ObjectId, {}, ILotRecord> & ILotRecord;
type MUserRes = mongoose.Document<mongoose.Types.ObjectId, {}, IUser> & IUser;

// ─────────────────────────────────────────────────────────────────────────────
// LotCheckOutData — now includes isMonthly + months
// ─────────────────────────────────────────────────────────────────────────────

const LotCheckOutData = z
  .object({
    lotId: z.string(),
    bookedSlot: z.object({
      zone: z.string().regex(/^[A-Z]{1,3}$/),
      slot: z.coerce.number(),
    }),
    bookingPeriod: z.object({
      from: z.iso.datetime(),
      to:   z.iso.datetime(),
    }),
    couponCode:    z.string().optional(),
    vehicleNumber: z.string().optional(),
    paymentMethod: z.string().optional(),
    // ── Monthly booking ───────────────────────────────────────
    isMonthly: z.coerce.boolean().optional().default(false),
    months:    z.coerce.number().int().min(1).max(12).optional().default(1),
  })
  .refine((data) => data.bookingPeriod.from < data.bookingPeriod.to);

type LotCheckOutData = z.infer<typeof LotCheckOutData>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function findExistingBooking(
  sd:           Date | mongoose.Schema.Types.Date,
  ed:           Date | mongoose.Schema.Types.Date,
  lotId:        string | mongoose.Types.ObjectId,
  rentedSlotId: string
) {
  if (sd >= ed) throw new ApiError(400, "INVALID_DATE");
  const now = new Date();
 return LotRentRecordModel.find({
  lotId,
  rentedSlot:              rentedSlotId,
  "paymentDetails.status": "SUCCESS",
  rentFrom:                { $lt: ed as Date },
  rentTo:                  { $gt: sd as Date },
}).exec();
}

function verifySelectedZone(
  lotDoc: mongoose.Document<mongoose.Types.ObjectId, {}, IParking> & IParking,
  slot:   LotCheckOutData["bookedSlot"]
) {
  const selectedZone = lotDoc.spacesList.get(slot.zone)?.count || 0;
  return selectedZone >= slot.slot;
}

function verifyCouponCode(code: string) {
  return code.startsWith("XES") ? 0.2 : 0;
}

/**
 * Compute all pricing for a lot booking (hourly or monthly).
 */
function computeLotPricing(
  data:             LotCheckOutData,
  lotDoc:           MParkingRes,
  discountPct:      number   // 0–1
) {
  const bookingFrom    = new Date(data.bookingPeriod.from);
  const bookingTo      = new Date(data.bookingPeriod.to);
  const isMonthly      = data.isMonthly ?? false;
  const months         = data.months    ?? 1;
  const hourlyRate     = lotDoc.price;
  const monthlyEnabled = lotDoc.monthlyChargeEnabled ?? false;
  const monthlyRate    = lotDoc.monthlyRate ?? 0;

  let totalHours:    number;
  let effectiveRate: number;
  let totalAmount:   number;

  if (isMonthly) {
    totalHours    = months * 730;
    const useFlat = monthlyEnabled && monthlyRate > 0;
    effectiveRate = useFlat ? monthlyRate : hourlyRate * 730;
    totalAmount   = effectiveRate * months;
  } else {
    totalHours    = (bookingTo.getTime() - bookingFrom.getTime()) / (1000 * 60 * 60);
    effectiveRate = hourlyRate;
    totalAmount   = totalHours * hourlyRate;
  }

  const discount       = totalAmount * discountPct;
  const serviceFee     = totalAmount * 0.05;
  const transactionFee = 0.5;
  const estimatedTaxes = totalAmount * 0.15;
  const amountToPaid   = totalAmount + serviceFee + transactionFee + estimatedTaxes - discount;

  return { totalHours, effectiveRate, totalAmount, discount, serviceFee, transactionFee, estimatedTaxes, amountToPaid };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateACheckout (re-checkout with new slot/time)
// ─────────────────────────────────────────────────────────────────────────────

const updateACheckout = async (
  data:       LotCheckOutData,
  lotDoc:     MParkingRes,
  bookingDoc: MLotRecordRes,
  bookingId:  string | mongoose.Types.ObjectId,
  user:       MUserRes
) => {
  const bookingFrom = new Date(data.bookingPeriod.from);
  const bookingTo   = new Date(data.bookingPeriod.to);
  const slotId      = generateParkingSpaceID(data.bookedSlot.zone, data.bookedSlot.slot.toString());

  if (!verifySelectedZone(lotDoc, data.bookedSlot)) throw new ApiError(400, "INVALID SLOT");

  const existing = await findExistingBooking(bookingFrom, bookingTo, lotDoc._id, slotId);
  if (existing) throw new ApiError(400, "SLOT NOT AVAILABLE");

  let discountPct = 0;
  if (data.couponCode) discountPct = verifyCouponCode(data.couponCode);

  const { totalHours, effectiveRate, totalAmount, discount, serviceFee, transactionFee, estimatedTaxes, amountToPaid }
    = computeLotPricing(data, lotDoc, discountPct);

  const isMonthly = data.isMonthly ?? false;
  const months    = data.months    ?? 1;

  const stripDetails = await updateStripePayment(
    bookingDoc.paymentDetails.stripePaymentDetails.paymentIntentId,
    amountToPaid
  );

  const updateInfo = await LotRentRecordModel.findByIdAndUpdate(
    bookingDoc._id,
    {
      lotId:             lotDoc._id,
      rentedSlot:        slotId,
      renterInfo:        user?._id,
      rentFrom:          bookingFrom,
      rentTo:            bookingTo,
      totalAmount,
      totalHours,
      discount,
      serviceFee,
      transactionFee,
      estimatedTaxes,
      appliedCouponCode: discountPct > 0 && data.couponCode,
      amountToPaid,
      priceRate:         effectiveRate,
      vehicleNumber:     data.vehicleNumber || null,
      isMonthly,
      months:            isMonthly ? months : undefined,
      paymentDetails: {
        status:              "PENDING",
        amountPaidBy:        amountToPaid,
        stripePaymentDetails: {
          ...stripDetails,
          ephemeralKey: bookingDoc.paymentDetails.stripePaymentDetails.ephemeralKey,
        },
        paymentMethod: "STRIPE",
      },
    }
  )
    .populate<{ lotId: IParking }>("lotId", "parkingName address _id contract email about")
    .orFail();

  return {
    bookingId:     updateInfo._id,
    name:          (updateInfo.lotId as any).parkingName,
    type:          "L",
    slot:          updateInfo.rentedSlot,
    bookingPeriod: { from: updateInfo.rentFrom, to: updateInfo.rentTo },
    pricing: {
      priceRate:      updateInfo.priceRate,
      basePrice:      updateInfo.totalAmount,
      discount,
      serviceFee,
      transactionFee,
      estimatedTaxes,
      couponApplied:  discount > 0,
      couponDetails:  discount > 0 ? data.couponCode : null,
      totalAmount:    amountToPaid,
      isMonthly,
      months:         isMonthly ? months : undefined,
    },
    stripeDetails: updateInfo.paymentDetails.stripePaymentDetails,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// createABooking
// ─────────────────────────────────────────────────────────────────────────────

const createABooking = async (
  data:   LotCheckOutData,
  lotDoc: MParkingRes & { owner: IMerchant },
  user:   MUserRes
) => {
  const bookingFrom = new Date(data.bookingPeriod.from);
  const bookingTo   = new Date(data.bookingPeriod.to);
  const slotId      = generateParkingSpaceID(data.bookedSlot.zone, data.bookedSlot.slot.toString());

  if (!verifySelectedZone(lotDoc, data.bookedSlot)) throw new ApiError(400, "INVALID SLOT");

  const existenceBook = await findExistingBooking(bookingFrom, bookingTo, lotDoc._id, slotId);
  if (existenceBook.length > 0) throw new ApiError(400, "SLOT NOT AVAILABLE");

  let discountPct = 0;
  if (data.couponCode) discountPct = verifyCouponCode(data.couponCode);

  const { totalHours, effectiveRate, totalAmount, discount, serviceFee, transactionFee, estimatedTaxes, amountToPaid }
    = computeLotPricing(data, lotDoc, discountPct);

  const isMonthly = data.isMonthly ?? false;
  const months    = data.months    ?? 1;

  // Stripe customer
 // AFTER — verify the customer exists before trusting the stored ID
let stripeCustomerId = user.stripeCustomerId;
if (stripeCustomerId) {
  try {
    await stripe.customers.retrieve(stripeCustomerId);
  } catch {
    // Customer doesn't exist in this Stripe account — create a fresh one
    stripeCustomerId = null;
    await User.findByIdAndUpdate(user._id, { stripeCustomerId: null });
  }
}
if (!stripeCustomerId) {
  stripeCustomerId = await createStripeCustomer(`${user.firstName} ${user.lastName}`, user.email);
  await User.findByIdAndUpdate(user._id, { stripeCustomerId });
}

  const stripeDetails = await initPayment(amountToPaid, stripeCustomerId);

  const updateInfo = await LotRentRecordModel.create({
    lotId:             lotDoc._id,
    rentedSlot:        slotId,
    renterInfo:        user?._id,
    rentFrom:          bookingFrom,
    rentTo:            bookingTo,
    totalAmount,
    totalHours,
    discount,
    serviceFee,
    transactionFee,
    estimatedTaxes,
    appliedCouponCode: discountPct > 0 && data.couponCode,
    amountToPaid,
    priceRate:         effectiveRate,
    vehicleNumber:     data.vehicleNumber || null,
    // ── Monthly ────────────────────────────────────────────────
    isMonthly,
    months:            isMonthly ? months : undefined,
    paymentDetails: {
      status:               "PENDING",
      amountPaidBy:         amountToPaid,
      stripePaymentDetails: stripeDetails,
      paymentMethod:        "STRIPE",
    },
  });

  return {
    bookingId:     updateInfo._id,
    name:          lotDoc.parkingName,
    type:          "L",
    slot:          updateInfo.rentedSlot,
    bookingPeriod: { from: updateInfo.rentFrom, to: updateInfo.rentTo },
    pricing: {
      priceRate:      effectiveRate,
      basePrice:      totalAmount,
      discount,
      serviceFee,
      transactionFee,
      estimatedTaxes,
      couponApplied:  discount > 0,
      couponDetails:  discount > 0 ? data.couponCode : null,
      totalAmount:    amountToPaid,
      // ── Monthly ──────────────────────────────────────────────
      isMonthly,
      months:         isMonthly ? months : undefined,
    },
    stripeDetails: updateInfo.paymentDetails.stripePaymentDetails,
    placeInfo: {
      name:     lotDoc.parkingName,
      phoneNo:  lotDoc.contactNumber,
      owner:    `${lotDoc.owner.firstName} ${lotDoc.owner.lastName}`,
      address:  lotDoc.address,
      location: lotDoc.gpsLocation,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

export const registerParkingLot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
    const owner = verifiedAuth.user;
    if (!owner) throw new ApiError(400, "UNKNOWN_USER");

    if (typeof req.body.gpsLocation === "string")       req.body.gpsLocation       = JSON.parse(req.body.gpsLocation);
    if (typeof req.body.spacesList === "string")        req.body.spacesList        = JSON.parse(req.body.spacesList);
    if (typeof req.body.generalAvailable === "string")  req.body.generalAvailable  = JSON.parse(req.body.generalAvailable);

    const rData = ParkingData.parse(req.body);
    let imageURL: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      imageURL = await Promise.all(files.map((f) => uploadToCloudinary(f.buffer))).then((r) => r.map((e) => e.secure_url));
    }
    rData.images = imageURL;

    const newParkingLot = await ParkingLotModel.create({ owner: owner._id, ...rData });
    await newParkingLot.save();
    res.status(201).json(new ApiResponse(201, { parkingLot: newParkingLot }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "DATA VALIDATION", err.issues);
    throw err;
  }
});

export const editParkingLot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const parkingLotId = z.string().parse(req.params.id);

    if (typeof req.body.gpsLocation === "string")      req.body.gpsLocation      = JSON.parse(req.body.gpsLocation);
    if (typeof req.body.spacesList === "string")       req.body.spacesList       = JSON.parse(req.body.spacesList);
    if (typeof req.body.generalAvailable === "string") req.body.generalAvailable = JSON.parse(req.body.generalAvailable);

    const updateData   = ParkingData.partial().parse(req.body);
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) throw new ApiError(400, "UNAUTHORIZED");

    const parkingLot = await ParkingLotModel.findById(parkingLotId);
    if (!parkingLot) throw new ApiError(404, "PARKING_LOT_NOT_FOUND");
    if (parkingLot.owner && parkingLot.owner.toString() !== verifiedAuth.user?._id?.toString()) throw new ApiError(403, "UNAUTHORIZED_ACCESS");

    let imageURL: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      imageURL = await Promise.all(files.map((f) => uploadToCloudinary(f.buffer))).then((r) => r.map((e) => e.secure_url));
    }
    updateData.images = imageURL.length > 0 ? [...(parkingLot.images || []), ...imageURL] : parkingLot.images;

    const updatedParkingLot = await ParkingLotModel.findByIdAndUpdate(parkingLotId, { $set: updateData }, { new: true, runValidators: true });
    if (!updatedParkingLot) throw new ApiError(500, "FAILED_TO_UPDATE_PARKING_LOT");

    res.status(200).json(new ApiResponse(200, { parkingLot: updatedParkingLot }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    throw err;
  }
});

export const getAvailableSpace = asyncHandler(async (req, res) => {
  try {
    const startDate = z.iso.datetime().parse(req.query.startDate);
    const lastDate  = z.iso.datetime().parse(req.query.lastDate);
    const lotID     = z.string().parse(req.query.lotId);

    const lotData = await ParkingLotModel.findById(lotID);
    if (!lotData) throw new ApiError(400, "Can't Find The Lot");

    let totalSpace = 0;
    lotData.spacesList?.forEach((v) => { totalSpace += v.count; });

    const result = await LotRentRecordModel.find({
      lotId:                   lotID,
      "paymentDetails.status": "SUCCESS",
      rentFrom:                { $lt: new Date(lastDate) },
      rentTo:                  { $gt: new Date(startDate) },
    }, "-renterInfo").exec();

    res.status(200).json(new ApiResponse(200, { availableSpace: totalSpace - result.length, bookedSlot: result }));
  } catch (err) {
    if (err instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", err.issues);
    else if (err instanceof ApiError) throw err;
    throw new ApiError(500, "SERVER_ERROR", err);
  }
});

export const lotCheckOut = asyncHandler(async (req, res) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) throw new ApiError(401, "UNAUTHORIZED");
    const USER: MUserRes = verifiedAuth.user as MUserRes;

    const rData = LotCheckOutData.parse(req.body);

    const lot = await ParkingLotModel.findById(rData.lotId).populate<{ owner: IMerchant }>("owner", "-password");
    if (!lot) throw new ApiError(400, "NO LOT FOUND");

    const data = await createABooking(rData, lot as any, USER);
    res.status(200).json(new ApiResponse(201, data));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID DATA", error.issues);
    if (error instanceof mongoose.MongooseError) throw new ApiError(400, error.name, error.message, error.stack);
    throw error;
  }
});

export const bookASlot = asyncHandler(async (req, res) => {
  let session: mongoose.ClientSession | undefined;
  try {
    const vUser = await verifyAuthentication(req);
    if (!vUser || vUser.userType !== "user") throw new ApiError(401, "User must be a verified user");

    const paymentMethod = req.body.paymentMethod as string | undefined;
    const isCashPayment = paymentMethod === "CASH";

    const rData = BookingData.partial().parse(req.body);
    const { carLicensePlateImage } = rData;
    if (!carLicensePlateImage || typeof carLicensePlateImage !== "string") throw new ApiError(400, "Car license plate image string is required");

    const normalUser = vUser.user as IUser;
    normalUser.carLicensePlateImage = carLicensePlateImage;
    await normalUser.save();

    const rentRecord = await LotRentRecordModel.findById(rData.bookingId);
    if (!rentRecord) throw new ApiError(400, "Invalid bookingId");

    session = await LotRentRecordModel.startSession();
    session.startTransaction();

    const existbooked = await findExistingBooking(rentRecord.rentFrom, rentRecord.rentTo, rentRecord.lotId, rentRecord.rentedSlot);

    if (!isCashPayment) {
      if (!rentRecord.paymentDetails.stripePaymentDetails?.paymentIntentId) throw new ApiError(400, "NO STRIPE RECORD FOUND");
      const stripRes = await verifyStripePayment(rentRecord.paymentDetails.stripePaymentDetails.paymentIntentId);
      if (!stripRes.success) throw new ApiError(400, "UNSUCESSFUL_TRANSACTION");
    }

    if (existbooked.length > 0) {
      rentRecord.paymentDetails.status = "FAILED";
      await rentRecord.save();
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    rentRecord.paymentDetails.status        = "SUCCESS";
    rentRecord.paymentDetails.paidAt        = new Date();
    rentRecord.paymentDetails.paymentMethod = isCashPayment ? "CASH" : "STRIPE";
    await rentRecord.save();

    await session.commitTransaction();
    session = undefined;

    res.status(201).json(new ApiResponse(201, { booking: rentRecord }, "Slot booked successfully"));
  } catch (err) {
    if (session) await session.abortTransaction();
    if (err instanceof z.ZodError) throw new ApiError(400, "Invalid booking data");
    throw err;
  }
});

export const getParkingLotbyId = asyncHandler(async (req, res) => {
  const lotId     = req.params.id;
  const lotdetalis = await ParkingLotModel.findById(lotId).populate<{ owner: IMerchant }>("owner", "-password -otp -otpVerified");
  if (lotdetalis) res.status(200).json(new ApiResponse(200, lotdetalis));
  else throw new ApiError(400, "NOT_FOUND");
});

export const deleteParking = asyncHandler(async (req, res) => {
  try {
    const lotId    = req.params.id;
    if (!lotId || !mongoose.Types.ObjectId.isValid(lotId)) throw new ApiError(400, "INVALID_ID");

    const authUser = await verifyAuthentication(req);
    if (!authUser?.user || authUser.userType !== "merchant") throw new ApiError(403, "UNKNOWN_USER");

    const del = await ParkingLotModel.findOneAndDelete({ _id: lotId, owner: authUser.user });
    if (del) return res.status(200).json(new ApiResponse(200, del, "DELETE_SUCCESSFUL"));

    if (await ParkingLotModel.findById(lotId)) throw new ApiError(403, "ACCESS_DENIED");
    throw new ApiError(404, "NOT_FOUND");
  } catch (error) {
    throw error;
  }
});

export const getLotBookingById = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId    = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth.userType === "driver") throw new ApiError(403, "Unauthorize Access");

    const booking = await LotRentRecordModel.findById(bookingId)
      .populate<{ lotId: IParking & { owner: IMerchant } }>({
        path: "lotId",
        select: "parkingName address contactNumber _id owner",
        populate: { path: "owner", model: Merchant, select: "firstName lastName email phoneNumber _id" },
      })
      .populate<{ renterInfo: IUser }>("renterInfo", "firstName lastName email phoneNumber carLicensePlateImage _id")
      .lean();

    if (!booking) throw new ApiError(404, "Booking not found");

    if (!(booking.renterInfo._id.toString() === verifiedAuth.user._id.toString() || (booking.lotId as any).owner.toString() === verifiedAuth.user._id.toString())) {
      throw new ApiError(403, "Unauthorize Access");
    }

    res.status(200).json(new ApiResponse(200, {
      _id:     booking._id,
      parking: {
        _id:           (booking.lotId as any)._id,
        name:          (booking.lotId as any).parkingName,
        address:       (booking.lotId as any).address,
        contactNumber: (booking.lotId as any).contactNumber,
        ownerName:     `${(booking.lotId as any).owner.firstName} ${(booking.lotId as any).owner.lastName}`,
      },
      customer: {
        _id:   booking.renterInfo._id,
        name:  `${booking.renterInfo.firstName} ${(booking.renterInfo as any).lastName || ""}`.trim(),
        email: (booking.renterInfo as any).email,
        phone: (booking.renterInfo as any).phoneNumber,
      },
      bookingPeriod: { from: booking.rentFrom, to: booking.rentTo, totalHours: booking.totalHours },
      type:       "L",
      bookedSlot: booking.rentedSlot,
      vehicleNumber: (booking as any).vehicleNumber || null,
      priceRate:  booking.priceRate,
      isMonthly:  (booking as any).isMonthly ?? false,
      months:     (booking as any).months,
      paymentDetails: {
        totalAmount:    booking.totalAmount,
        amountPaid:     booking.amountToPaid,
        discount:       booking.discount || 0,
        serviceFee:     booking.serviceFee,
        transactionFee: booking.transactionFee,
        estimatedTaxes: booking.estimatedTaxes,
        status:         booking.paymentDetails.status,
        method:         booking.paymentDetails.paymentMethod,
        paidAt:         booking.paymentDetails.paidAt,
      },
      status:        booking.paymentDetails.status,
      earlyCheckOut: (booking as any).earlyCheckOut || null,
    }, "Booking details fetched successfully"));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "Invalid booking ID format");
    throw error;
  }
});

export const getLotBookingList = asyncHandler(async (req, res) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user || verifiedAuth.userType === "driver") throw new ApiError(401, "Unauthorized");

    const { page = 1, limit = 10, status, lotId } = req.query;
    const pageNum  = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip     = (pageNum - 1) * limitNum;

    const filter: mongoose.RootFilterQuery<ILotRecord> = {};
    filter["paymentDetails.status"] = status ? status : { $ne: "PENDING" };
    if (lotId) filter.lotId = lotId;

    if (verifiedAuth.userType === "merchant") {
      if (!lotId) {
        const parkingLots = await ParkingLotModel.find({ owner: verifiedAuth.user._id }, "_id");
        filter.lotId = { $in: parkingLots.map((l) => l._id) };
      }
    }
    if (verifiedAuth.userType === "user") filter.renterInfo = verifiedAuth.user._id;

    const [bookings, totalCount] = await Promise.all([
      LotRentRecordModel.find(filter)
        .populate<{ lotId: IParking & { owner: IMerchant } }>({
          path: "lotId",
          select: "parkingName address contactNumber _id owner",
          populate: { path: "owner", model: Merchant, select: "firstName lastName email phoneNumber _id" },
        })
        .populate<{ renterInfo: IUser }>("renterInfo", "firstName lastName email phoneNumber carLicensePlateImage _id")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      LotRentRecordModel.countDocuments(filter),
    ]);

    const formattedBookings = bookings.map((b) => ({
      _id:     b._id,
      parking: {
        _id:           (b.lotId as any)?._id?.toString(),
        createdAt:     (b as any).createdAt,
        name:          (b.lotId as any)?.parkingName,
        address:       (b.lotId as any)?.address,
        contactNumber: (b.lotId as any)?.contactNumber,
        ownerName:     `${(b.lotId as any).owner.firstName} ${(b.lotId as any).owner.lastName}`,
      },
      customer: {
        _id:                 (b.renterInfo as any)?._id?.toString(),
        name:                `${(b.renterInfo as any)?.firstName} ${(b.renterInfo as any)?.lastName || ""}`.trim(),
        email:               (b.renterInfo as any)?.email,
        phone:               (b.renterInfo as any)?.phoneNumber,
        carLicensePlateImage:(b.renterInfo as any)?.carLicensePlateImage,
      },
      type:          "L",
      vehicleNumber: (b as any).vehicleNumber || null,
      bookingPeriod: { from: b.rentFrom, to: b.rentTo, totalHours: b.totalHours },
      bookedSlot:    b.rentedSlot,
      priceRate:     b.priceRate,
      isMonthly:     (b as any).isMonthly ?? false,
      months:        (b as any).months,
      paymentDetails: {
        totalAmount:    b.totalAmount,
        amountPaid:     b.amountToPaid,
        discount:       b.discount || 0,
        serviceFee:     b.serviceFee,
        transactionFee: b.transactionFee,
        estimatedTaxes: b.estimatedTaxes,
        status:         b.paymentDetails.status,
        method:         b.paymentDetails.paymentMethod,
        paidAt:         b.paymentDetails.paidAt,
      },
      status:        b.paymentDetails.status,
      earlyCheckOut: (b as any).earlyCheckOut || null,
    }));

    res.status(200).json(new ApiResponse(200, {
      bookings: formattedBookings,
      pagination: { total: totalCount, page: pageNum, limit: limitNum, totalPages: Math.ceil(totalCount / limitNum) },
    }, "Bookings fetched successfully"));
  } catch (error) {
    throw error;
  }
});

export const getListOfParkingLot = asyncHandler(async (req, res) => {
  try {
    const owner     = z.string().optional().parse(req.query.owner);
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude  = z.coerce.number().optional().parse(req.query.latitude);

    const queries: mongoose.FilterQuery<IParking> = {};
    if (owner) queries.owner = owner;
    if (longitude && latitude) {
      queries.gpsLocation = { $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] } } };
    }

    const result = await ParkingLotModel.find(queries).exec();
    if (result) res.status(200).json(new ApiResponse(200, result));
    else throw new ApiError(500);
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", error.issues);
    else if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Server Error", error);
  }
});

export const markSlotVacant = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId    = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user || verifiedAuth.userType !== "merchant") throw new ApiError(403, "Only merchants can mark a slot vacant");

    const booking = await LotRentRecordModel.findById(bookingId);
    if (!booking) throw new ApiError(404, "BOOKING_NOT_FOUND");
    if (booking.paymentDetails.status !== "SUCCESS") throw new ApiError(400, "Only confirmed (SUCCESS) bookings can be vacated");

    const now = new Date();
    if (new Date(booking.rentTo as unknown as string) <= now) throw new ApiError(400, "Booking has already expired — slot is already free");

    const parkingLot = await ParkingLotModel.findById(booking.lotId);
    if (!parkingLot) throw new ApiError(404, "PARKING_LOT_NOT_FOUND");
    if (parkingLot.owner.toString() !== verifiedAuth.user._id.toString()) throw new ApiError(403, "You do not own this parking lot");
    if ((booking as any).earlyCheckOut) throw new ApiError(400, "Slot has already been marked vacant");

    const originalTo = booking.rentTo;
    await LotRentRecordModel.findByIdAndUpdate(bookingId, {
      $set: { rentTo: now, earlyCheckOut: { markedAt: now, markedBy: verifiedAuth.user._id, originalTo } },
    });

    res.status(200).json(new ApiResponse(200, { bookingId, slot: booking.rentedSlot, markedVacantAt: now, originalCheckOut: originalTo }, "Slot marked vacant successfully. It is now available for new bookings."));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "Invalid booking ID");
    throw error;
  }
});
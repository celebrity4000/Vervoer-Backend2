import { Request, Response } from "express";
import { Merchant, IMerchant } from "../models/merchant.model.js";
import { IResident, ResidenceModel, ResidenceBookingModel, IResidenceBooking } from "../models/merchant.residence.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { residenceSchema, updateResidenceSchema, type ResidenceData } from "../zodTypes/merchantData.js";
import z from "zod/v4";
import mongoose from "mongoose";
import { createStripeCustomer, initPayment, StripeIntentData, verifyStripePayment } from "../utils/stripePayments.js";
import { User, IUser } from "../models/normalUser.model.js";

type MUserRes = mongoose.Document<mongoose.Types.ObjectId, {}, IUser> & IUser;
type MResidenceRes = mongoose.Document<mongoose.Types.ObjectId, {}, IResident> & IResident;

export const addResidence = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") {
    throw new ApiError(400, "INVALID_USER");
  }
  const owner = verifiedAuth.user;

  if (typeof req.body.gpsLocation === "string") req.body.gpsLocation = JSON.parse(req.body.gpsLocation);
  if (typeof req.body.generalAvailable === "string") req.body.generalAvailable = JSON.parse(req.body.generalAvailable);
  if (typeof req.body.emergencyContact === "string") req.body.emergencyContact = JSON.parse(req.body.emergencyContact);
  if (req.body.transportationTypes && typeof req.body.transportationTypes === "string") req.body.transportationTypes = JSON.parse(req.body.transportationTypes);
  if (req.body.coveredDrivewayTypes && typeof req.body.coveredDrivewayTypes === "string") req.body.coveredDrivewayTypes = JSON.parse(req.body.coveredDrivewayTypes);

  const booleanFields = ["is24x7", "parking_pass", "transportationAvailable", "coveredDrivewayAvailable", "securityCamera"];
  booleanFields.forEach(field => {
    if (req.body[field] !== undefined) req.body[field] = req.body[field] === "true";
  });

  const validatedData = residenceSchema.parse({ ...req.body }) as ResidenceData;

  let imageURLs: string[] = [];
  if (req.files) {
    const files = Array.isArray(req.files) ? req.files : req.files.images;
    imageURLs = await Promise.all(files.map((file) => uploadToCloudinary(file.buffer))).then((results) => results.map((result) => result.secure_url));
  }

  const newResidence = await ResidenceModel.create({ ...validatedData, images: imageURLs, owner: owner._id });
  await Merchant.findByIdAndUpdate(owner._id, { $set: { haveResidence: true } }, { new: true });

  res.status(201).json(new ApiResponse(201, newResidence, "Residence added successfully"));
});

export const updateResidence = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
  const owner = verifiedAuth.user;

  const jsonFields = ["gpsLocation", "generalAvailable", "emergencyContact", "transportationTypes", "coveredDrivewayTypes"];
  for (const field of jsonFields) {
    if (req.body[field] && typeof req.body[field] === "string") {
      try { req.body[field] = JSON.parse(req.body[field]); }
      catch { throw new ApiError(400, `Invalid JSON format for ${field}`); }
    }
  }

  const booleanFields = ["is24x7", "parking_pass", "transportationAvailable", "coveredDrivewayAvailable", "securityCamera"];
  for (const field of booleanFields) {
    if (req.body[field] !== undefined && typeof req.body[field] === "string") req.body[field] = req.body[field] === "true";
  }

  const updates = updateResidenceSchema.parse(req.body);
  const residence = await ResidenceModel.findOne({ _id: residenceId, owner });
  if (!residence) throw new ApiError(404, "Residence not found or access denied");

  if (req.files) {
    const files = Array.isArray(req.files) ? req.files : req.files.images;
    const uploadedImages = await Promise.all(files.map((file) => uploadToCloudinary(file.buffer)));
    updates.images = [...(residence.images || []), ...uploadedImages.map((res) => res.secure_url)];
  }

  const updatedResidence = await ResidenceModel.findByIdAndUpdate(residenceId, { $set: updates }, { new: true, runValidators: true });
  res.status(200).json(new ApiResponse(200, updatedResidence, "Residence updated successfully"));
});

export const getResidenceById = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;
  const residence = await ResidenceModel.findById(residenceId).populate("owner", "-password -otp -otpExpire").lean();
  if (!residence) throw new ApiError(404, "Residence not found");
  res.status(200).json(new ApiResponse(200, residence, "Residence retrieved successfully"));
});

export const deleteResidence = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
  const owner = verifiedAuth.user;

  const deletedResidence = await ResidenceModel.findOneAndDelete({ _id: residenceId, owner });
  if (!deletedResidence) throw new ApiError(404, "NOT_FOUND: Residence not found or access denied");

  await Merchant.findByIdAndUpdate(owner._id, { $pull: { residences: residenceId } }, { new: true });
  res.status(200).json(new ApiResponse(200, null, "Residence deleted successfully"));
});

export const getMerchantResidences = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
  const residences = await ResidenceModel.find({ owner: verifiedAuth.user });
  res.status(200).json(new ApiResponse(200, residences, "Residences retrieved successfully"));
});

async function findBookedResidenceIn(startDate: Date, endDate: Date, id?: string) {
  if (startDate >= endDate) return [];

  const now = new Date();

  const q: mongoose.FilterQuery<IResidenceBooking> = {
    "paymentDetails.status": "SUCCESS",
    // ✅ Only consider bookings that haven't ended yet
    "bookingPeriod.to": { $gt: now },
    "bookingPeriod.from": { $lt: endDate },
    "bookingPeriod.to": { $gt: startDate },
  };
  if (id) q.residenceId = id;
  return await ResidenceBookingModel.find(q);
}

const ResidenceQuery = z.object({
  longitude: z.coerce.number(),
  latitude: z.coerce.number(),
  owner: z.string(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
  vehicleType: z.enum(["car", "bike", "both"]),
}).partial();

export const getListOfResidence = asyncHandler(async (req, res) => {
  try {
    const { longitude, latitude, owner, startDate, endDate, vehicleType } = ResidenceQuery.parse(req.query);
    const queries: mongoose.FilterQuery<IResident> = {};
    if (longitude && latitude) {
      queries.gpsLocation = { $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] } } };
    }
    if (vehicleType && vehicleType !== "both") queries.vehicleType = { $in: [vehicleType, "both"] };
    if (owner) queries.owner = owner;
    if (startDate && endDate && startDate < endDate) {
      queries._id = { $nin: (await findBookedResidenceIn(new Date(startDate), new Date(endDate))).map((e) => e._id) };
    }
    const result = await ResidenceModel.find(queries).exec();
    if (!result) throw new ApiError(500);
    res.status(200).json(new ApiResponse(200, result));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", error.issues);
    else if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Server Error", error);
  }
});

const CheckOutResidenceData = z.object({
  residenceId: z.string(),
  bookingPeriod: z.object({ to: z.iso.datetime(), from: z.iso.datetime() }),
  couponCode: z.string().optional(),
});

// ✅ Updated CBookingData: replaced platformCharge with three new fee fields
interface CBookingData {
  bookingPeriod: { to: Date; from: Date };
  totalAmount: number;
  amountToPaid: number;
  couponCode?: string;
  discount: number;
  serviceFee: number;
  transactionFee: number;
  estimatedTaxes: number;
}

async function createABooking(
  data: CBookingData,
  stripeDetails: StripeIntentData & { customerId: string },
  user: MUserRes,
  residence: mongoose.Document<mongoose.Types.ObjectId, {}, mongoose.MergeType<IResident, { owner: IMerchant }>> & Omit<IResident, "owner"> & { owner: IMerchant }
) {
  const booking = await ResidenceBookingModel.create({
    residenceId: residence._id,
    customerId: user._id,
    ...data,
    priceRate: residence.price,
    paymentDetails: {
      amount: data.amountToPaid,
      paymentGateway: "STRIPE",
      method: "STRIPE",
      status: "PENDING",
      StripePaymentDetails: stripeDetails
    }
  } as IResidenceBooking);

  if (!booking) throw new ApiError(400, "SERVER_ERROR: can't book");

  return {
    bookingId: booking._id,
    type: "R",
    name: residence.residenceName,
    bookingPeriod: booking.bookingPeriod,
    vehicleNumber: booking.vehicleNumber,
    pricing: {
      priceRate: booking.priceRate,
      basePrice: booking.totalAmount,
      discount: booking.discount,
      serviceFee: booking.serviceFee,
      transactionFee: booking.transactionFee,
      estimatedTaxes: booking.estimatedTaxes,
      couponApplied: booking.couponCode !== undefined,
      couponDetails: booking.couponCode || null,
      totalAmount: booking.amountToPaid
    },
    stripeDetails: booking.paymentDetails.StripePaymentDetails,
    placeInfo: {
      name: residence.residenceName,
      phoneNo: residence.contactNumber,
      owner: residence.owner.firstName + " " + residence.owner.lastName,
      address: residence.address,
      location: residence.gpsLocation,
    }
  };
}

export const checkoutResidence = asyncHandler(async (req, res) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (verifiedAuth?.userType !== "user") throw new ApiError(403, "UNAUTHORIZED_ACCESS");

    const rData = CheckOutResidenceData.parse(req.body);
    const sd = new Date(rData.bookingPeriod.from);
    const ed = new Date(rData.bookingPeriod.to);

    if (ed < sd) throw new ApiError(400, "WRONG_DATE");

    const residence = await ResidenceModel.findById(rData.residenceId).populate<{ owner: IMerchant }>("owner", "-password");
    if (!residence) throw new ApiError(400, "WRONG_RESIDENCE_ID");

    const isBooked = await findBookedResidenceIn(sd, ed, rData.residenceId);
    if (isBooked.length !== 0) throw new ApiError(400, "NOT_AVAILABLE");

    const totalHours = (ed.getTime() - sd.getTime()) / 3600000;
    const totalAmount = totalHours * residence.price;

    // ✅ New fee structure
    let discount = 0;
    const serviceFee = totalAmount * 0.05;
    const transactionFee = 0.50;
    const estimatedTaxes = totalAmount * 0.15;

    if (rData.couponCode) {
      const dp = verifyCouponCode(rData.couponCode);
      discount = totalAmount * dp;
    }

    const amountToPaid = totalAmount + serviceFee + transactionFee + estimatedTaxes - discount;

    let stripeCustomerId = "";
    if (!verifiedAuth.user.stripeCustomerId) {
      stripeCustomerId = await createStripeCustomer(`${verifiedAuth.user.firstName} ${verifiedAuth.user.lastName}`, verifiedAuth.user.email);
      try {
        User.findByIdAndUpdate(verifiedAuth.user._id, { stripeCustomerId });
      } catch (err) {
        console.log("Couldn't update the stripe customer Id");
      }
    } else {
      stripeCustomerId = verifiedAuth.user.stripeCustomerId;
    }

    const paymentDetails = await initPayment(amountToPaid, stripeCustomerId);
    const response = await createABooking(
      { bookingPeriod: { to: ed, from: sd }, totalAmount, discount, couponCode: rData.couponCode, amountToPaid, serviceFee, transactionFee, estimatedTaxes },
      { ...paymentDetails, customerId: stripeCustomerId },
      verifiedAuth.user,
      residence
    );

    res.status(200).json(new ApiResponse(200, response));
  } catch (err) {
    console.log(err);
    if (err instanceof z.ZodError) {
      console.log(err.issues);
      throw new ApiError(400, "INVALID_DATA");
    }
    throw err;
  }
});

const verifyCouponCode = (c: string) => c.startsWith("XES") ? 0.1 : 0;

export const verifyResidenceBooking = asyncHandler(async (req, res) => {
  let session: mongoose.ClientSession | undefined;
  try {
    const { bookingId, carLicensePlateImage, paymentMethod } = req.body;
    const isCashPayment = paymentMethod === "CASH";

    if (!(bookingId && carLicensePlateImage)) throw new ApiError(400, "NO_BOOKINGID");

    const verifiedUser = await verifyAuthentication(req);
    if (!(verifiedUser?.userType === "user")) throw new ApiError(401, "User must be a verified user");

    const booking = await ResidenceBookingModel.findById(bookingId);
    if (!booking) throw new ApiError(404, "Booking not found");

    if (booking.customerId.toString() !== verifiedUser.user._id.toString()) {
      throw new ApiError(401, "User is not authorized to book this slot");
    }

    if (booking.paymentDetails?.status === "SUCCESS" && booking.paymentDetails.transactionId) {
      throw new ApiError(400, "USER ALREADY PAID AND BOOKED");
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const bookingFrom = new Date(booking.bookingPeriod.from);
    const bookingTo = new Date(booking.bookingPeriod.to);
    const isBooking = await findBookedResidenceIn(bookingFrom, bookingTo, booking.residenceId.toString());

    // ✅ Skip Stripe verification for CASH payments
    if (!isCashPayment) {
      if (!booking.paymentDetails.StripePaymentDetails?.paymentIntentId) {
        throw new ApiError(400, "NO STRIPE RECORD FOUND");
      }
      const stripRes = await verifyStripePayment(
        booking.paymentDetails.StripePaymentDetails.paymentIntentId
      );
      if (!stripRes.success) throw new ApiError(400, "UNSUCESSFUL_TRANSACTION");
    }

    booking.paymentDetails.paidAt = new Date();

    if (isBooking.length > 0) {
      booking.paymentDetails.status = "FAILED";
      await booking.save();
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    booking.vehicleNumber = carLicensePlateImage;
    booking.paymentDetails.status = "SUCCESS";
    booking.paymentDetails.method = isCashPayment ? "CASH" : "STRIPE";
    await booking.save();
    await session.commitTransaction();

    res.status(201).json(new ApiResponse(201, { booking }));
  } catch (err) {
    console.log(err);
    throw err;
  }
});

export const residenceBookingInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    const bookingId = z.string().parse(req.params.id);
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) throw new ApiError(401, 'UNAUTHORIZED');

    const booking = await ResidenceBookingModel.findById(bookingId)
      .populate<{ residenceId: mongoose.MergeType<IResident, { owner: IMerchant }> }>({
        path: 'residenceId',
        populate: { path: "owner", model: Merchant, select: "-password" }
      }).orFail()
      .populate<{ customerId: IUser }>('customerId', 'firstName lastName email phoneNumber _id').orFail()
      .lean();

    if (!booking) throw new ApiError(404, 'BOOKING_NOT_FOUND');

    if (verifiedAuth.user._id.toString() !== booking.customerId._id.toString() &&
      verifiedAuth.user._id.toString() !== booking.residenceId.owner._id.toString()) {
      throw new ApiError(403, 'UNAUTHORIZED_ACCESS');
    }

    const response = {
      _id: booking._id,
      residence: {
        _id: booking.residenceId._id,
        name: booking.residenceId.residenceName,
        address: booking.residenceId.address,
        contactNumber: booking.residenceId.contactNumber,
        ownerName: `${booking.residenceId.owner?.firstName} ${booking.residenceId.owner?.lastName}`
      },
      type: "R",
      customer: {
        _id: booking.customerId._id,
        name: `${booking.customerId.firstName} ${booking.customerId.lastName || ''}`.trim(),
        email: booking.customerId.email,
        phone: booking.customerId.phoneNumber
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        serviceFee: booking.serviceFee,
        transactionFee: booking.transactionFee,
        estimatedTaxes: booking.estimatedTaxes,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method,
        paidAt: booking.paymentDetails.paidAt,
      }
    };

    res.status(200).json(new ApiResponse(200, response));
  } catch (error) {
    console.log(error);
    throw error;
  }
});

const BookingQueryParams = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).default(10),
  residenceId: z.string().optional()
});

export const residenceBookingList = asyncHandler(async (req, res) => {
  try {
    console.log("NEW Query Requested");
    const { page, limit, residenceId } = BookingQueryParams.parse(req.query);
    const skip = (page - 1) * limit;

    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user) throw new ApiError(401, 'UNAUTHORIZED');

    const query: any = {};

    if (verifiedAuth.userType === 'user') {
      query.customerId = verifiedAuth.user._id;
    } else if (verifiedAuth.userType === 'merchant') {
      if (residenceId) {
        const residence = await ResidenceModel.findOne({ _id: residenceId, owner: verifiedAuth.user._id });
        if (!residence) throw new ApiError(404, 'Residence_NOT_FOUND_OR_ACCESS_DENIED');
        query.residenceId = residenceId;
      } else {
        const merchantResidences = await ResidenceModel.find({ owner: verifiedAuth.user._id }, '_id');
        const residenceIds = merchantResidences.map(g => g._id);
        if (residenceIds.length === 0) {
          res.status(200).json(new ApiResponse(200, { bookings: [], pagination: { total: 0, page, size: limit } }));
          return;
        }
        query.residenceId = { $in: residenceIds };
      }
    } else {
      throw new ApiError(403, 'UNAUTHORIZED_ACCESS');
    }

    query["paymentDetails.status"] = { $ne: "PENDING" };
    console.log("query at residence:", query);

    const bookings = await ResidenceBookingModel.find(query)
      .populate<{ residenceId: mongoose.MergeType<IResident, { owner: IMerchant }> }>({
        path: 'residenceId',
        populate: { path: "owner", model: Merchant, select: "-password" }
      })
      .populate<{ customerId: IUser }>('customerId', 'firstName lastName email phoneNumber _id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    console.log("found Residence booking:", bookings.length);
    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      residence: {
        _id: booking.residenceId?._id,
        name: booking.residenceId?.residenceName,
        address: booking.residenceId?.address,
        contactNumber: booking.residenceId?.contactNumber
      },
      customer: {
        _id: booking.customerId?._id,
        name: `${booking.customerId?.firstName} ${booking.customerId?.lastName || ''}`.trim(),
        email: booking.customerId?.email,
        phone: booking.customerId?.phoneNumber
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        serviceFee: booking.serviceFee,
        transactionFee: booking.transactionFee,
        estimatedTaxes: booking.estimatedTaxes,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method,
        paidAt: booking.paymentDetails.paidAt,
      },
      status: booking.paymentDetails.status,
      type: "R",
    }));

    res.status(200).json(new ApiResponse(200, { bookings: formattedBookings, pagination: { page, size: limit } }));
  } catch (error) {
    console.error('Error in bookingList:', error);
    throw error;
  }
});

export const deleteResidenceBooking = asyncHandler(async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bookingId)) throw new ApiError(400, "Invalid booking ID");
  const booking = await ResidenceBookingModel.findById(bookingId);
  if (!booking) throw new ApiError(404, "Booking not found");
  await booking.deleteOne();
  res.status(200).json(new ApiResponse(200, null, "Booking cancelled successfully"));
});
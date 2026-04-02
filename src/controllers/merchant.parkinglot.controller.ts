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

type MParkingRes = mongoose.Document<mongoose.Types.ObjectId, {}, IParking> &
  IParking;
type MLotRecordRes = mongoose.Document<
  mongoose.Types.ObjectId,
  {},
  ILotRecord
> &
  ILotRecord;

type MUserRes = mongoose.Document<mongoose.Types.ObjectId, {}, IUser> & IUser;

export const registerParkingLot = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const verifiedAuth = await verifyAuthentication(req);
      let owner = null;
      if (verifiedAuth?.userType !== "merchant") {
        throw new ApiError(400, "INVALID_USER");
      }
      owner = verifiedAuth.user;
      if (!owner) {
        throw new ApiError(400, "UNKNOWN_USER");
      }

      if (typeof req.body.gpsLocation === "string") {
        req.body.gpsLocation = JSON.parse(req.body.gpsLocation);
      }
      if (typeof req.body.spacesList === "string") {
        req.body.spacesList = JSON.parse(req.body.spacesList);
      }
      if (typeof req.body.generalAvailable === "string") {
        req.body.generalAvailable = JSON.parse(req.body.generalAvailable);
      }

      const rData = ParkingData.parse(req.body);
      let imageURL: string[] = [];
      if (req.files) {
        if (Array.isArray(req.files)) {
          imageURL = await Promise.all(
            req.files.map((file) => uploadToCloudinary(file.buffer)),
          ).then((res) => res.map((e) => e.secure_url));
        } else {
          imageURL = await Promise.all(
            req.files.images.map((file) => uploadToCloudinary(file.buffer)),
          ).then((res) => res.map((e) => e.secure_url));
        }
      }
      rData.images = imageURL;

      const newParkingLot = await ParkingLotModel.create({
        owner: owner?._id,
        ...rData,
      });
      await newParkingLot.save();
      res.status(201).json(new ApiResponse(201, { parkingLot: newParkingLot }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.log("Errors ", err.issues);
        throw new ApiError(400, "DATA VALIDATION", err.issues);
      }
      throw err;
    }
  },
);

export const editParkingLot = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const parkingLotId = z.string().parse(req.params.id);

      if (typeof req.body.gpsLocation === "string") {
        req.body.gpsLocation = JSON.parse(req.body.gpsLocation);
      }
      if (typeof req.body.spacesList === "string") {
        req.body.spacesList = JSON.parse(req.body.spacesList);
      }
      if (typeof req.body.generalAvailable === "string") {
        req.body.generalAvailable = JSON.parse(req.body.generalAvailable);
      }

      const updateData = ParkingData.partial().parse(req.body);
      const verifiedAuth = await verifyAuthentication(req);

      if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) {
        throw new ApiError(400, "UNAUTHORIZED");
      }

      const parkingLot = await ParkingLotModel.findById(parkingLotId);
      if (!parkingLot) {
        throw new ApiError(404, "PARKING_LOT_NOT_FOUND");
      }

      if (
        parkingLot.owner &&
        verifiedAuth.user &&
        parkingLot.owner.toString() !== verifiedAuth.user?._id?.toString()
      ) {
        throw new ApiError(403, "UNAUTHORIZED_ACCESS");
      }

      let imageURL: string[] = [];
      if (req.files) {
        if (Array.isArray(req.files)) {
          imageURL = await Promise.all(
            req.files.map((file) => uploadToCloudinary(file.buffer)),
          ).then((res) => res.map((e) => e.secure_url));
        } else {
          imageURL = await Promise.all(
            req.files.images.map((file) => uploadToCloudinary(file.buffer)),
          ).then((res) => res.map((e) => e.secure_url));
        }
      }
      if (imageURL.length > 0) {
        updateData.images = [...(parkingLot.images || []), ...imageURL];
      } else {
        updateData.images = parkingLot.images;
      }
      const updatedParkingLot = await ParkingLotModel.findByIdAndUpdate(
        parkingLotId,
        { $set: updateData },
        { new: true, runValidators: true },
      );

      if (!updatedParkingLot) {
        throw new ApiError(500, "FAILED_TO_UPDATE_PARKING_LOT");
      }

      res
        .status(200)
        .json(new ApiResponse(200, { parkingLot: updatedParkingLot }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
      }
      throw err;
    }
  },
);

/**
 * Get available spaces for a parking lot.
 *
 * FIX: Added "paymentDetails.status": "SUCCESS" filter.
 * Previously there was NO status filter at all, meaning PENDING and FAILED
 * bookings were counted as occupied slots, blocking users from booking them.
 * Now only confirmed (SUCCESS) bookings are counted as occupied.
 * Also simplified the overlap condition to a single clean $lt/$gt pair.
 */
export const getAvailableSpace = asyncHandler(async (req, res) => {
  try {
    const startDate = z.iso.datetime().parse(req.query.startDate);
    const lastDate = z.iso.datetime().parse(req.query.lastDate);
    const lotID = z.string().parse(req.query.lotId);

    const lotData = await ParkingLotModel.findById(lotID);
    if (!lotData) throw new ApiError(400, "Can't Find The Lot");

    let totalSpace = 0;
    lotData.spacesList?.forEach((v) => {
      totalSpace += v.count;
    });

    // ✅ FIX: Only SUCCESS bookings occupy a slot.
    // PENDING = checkout started but not paid yet (must not block other users)
    // FAILED  = payment failed (must not block other users)
    // Single overlap condition: booking starts before query end AND ends after query start
    const result = await LotRentRecordModel.find(
      {
        lotId: lotID,
        "paymentDetails.status": "SUCCESS",
        rentFrom: { $lt: new Date(lastDate) },
        rentTo: { $gt: new Date(startDate) },
      },
      "-renterInfo",
    ).exec();

    res.status(200).json(
      new ApiResponse(200, {
        availableSpace: totalSpace - result.length,
        bookedSlot: result,
      }),
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", err.issues);
    } else if (err instanceof ApiError) {
      throw err;
    } else {
      throw new ApiError(500, "SERVER_ERROR", err);
    }
  }
});

const LotCheckOutData = z
  .object({
    lotId: z.string(),
    bookedSlot: z.object({
      zone: z.string().regex(/^[A-Z]{1,3}$/),
      slot: z.coerce.number(),
    }),
    bookingPeriod: z.object({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
    }),
    couponCode: z.string().optional(),
    vehicleNumber: z.string().optional(),
    paymentMethod: z.string().optional(),
  })
  .refine((data) => data.bookingPeriod.from < data.bookingPeriod.to);
type LotCheckOutData = z.infer<typeof LotCheckOutData>;

/**
 * Check if a specific slot has a conflicting SUCCESS booking.
 * Only SUCCESS bookings count — PENDING and FAILED do not block slots.
 */
async function findExistingBooking(
  sd: Date | mongoose.Schema.Types.Date,
  ed: Date | mongoose.Schema.Types.Date,
  lotId: string | mongoose.Types.ObjectId,
  rentedSlotId: string,
) {
  if (sd >= ed) throw new ApiError(400, "INVALID_DATE");

  const now = new Date();

  // ✅ FIX: Changed { $ne: "PENDING" } to "SUCCESS" only.
  // Previously FAILED bookings were blocking slots at checkout time.
  const res = await LotRentRecordModel.find({
    lotId: lotId,
    rentedSlot: rentedSlotId,
    "paymentDetails.status": "SUCCESS",
    rentTo: { $gt: now },
    rentFrom: { $lt: ed as Date },
    rentTo: { $gt: sd as Date },
  }).exec();

  return res;
}

function verifySelectedZone(
  lotDoc: mongoose.Document<mongoose.Types.ObjectId, {}, IParking> & IParking,
  slot: LotCheckOutData["bookedSlot"],
) {
  const selectedZone = lotDoc.spacesList.get(slot.zone)?.count || 0;
  if (selectedZone < slot.slot) {
    return false;
  }
  return true;
}

function verifyCouponCode(code: string) {
  return code.startsWith("XES") ? 0.2 : 0;
}

const updateACheckout = async (
  data: LotCheckOutData,
  lotDoc: MParkingRes,
  bookingDoc: MLotRecordRes,
  bookingId: string | mongoose.Types.ObjectId,
  user: MUserRes,
) => {
  const bookingFrom = new Date(data.bookingPeriod.from);
  const bookingTo = new Date(data.bookingPeriod.to);
  const slotId = generateParkingSpaceID(
    data.bookedSlot.zone,
    data.bookedSlot.slot.toString(),
  );

  if (!verifySelectedZone(lotDoc, data.bookedSlot)) {
    throw new ApiError(400, "INVALID SLOT");
  }

  const exiestenseBook = await findExistingBooking(
    bookingFrom,
    bookingTo,
    lotDoc._id,
    slotId,
  );
  if (exiestenseBook) {
    throw new ApiError(400, "SLOT NOT AVAILABLE");
  }

  const totalHours =
    (bookingTo.getTime() - bookingFrom.getTime()) / (1000 * 60 * 60);
  const rate = lotDoc.price;
  let discountPercentage = 0;
  if (data.couponCode) {
    discountPercentage = verifyCouponCode(data.couponCode);
  }

  const totalAmount = totalHours * rate;
  const discount = totalAmount * discountPercentage;
  const serviceFee = totalAmount * 0.05;
  const transactionFee = 0.5;
  const estimatedTaxes = totalAmount * 0.15;
  const amountToPaid =
    totalAmount + serviceFee + transactionFee + estimatedTaxes - discount;

  const stripDetails = await updateStripePayment(
    bookingDoc.paymentDetails.stripePaymentDetails.paymentIntentId,
    amountToPaid,
  );

  const updateInfo = await LotRentRecordModel.findByIdAndUpdate(
    bookingDoc._id,
    {
      lotId: lotDoc._id,
      rentedSlot: slotId,
      renterInfo: user?._id,
      rentFrom: bookingFrom,
      rentTo: bookingTo,
      totalAmount: totalAmount,
      totalHours: totalHours,
      discount: discount,
      serviceFee: serviceFee,
      transactionFee: transactionFee,
      estimatedTaxes: estimatedTaxes,
      appliedCouponCode: discountPercentage > 0 && data.couponCode,
      amountToPaid: amountToPaid,
      priceRate: rate,
      paymentDetails: {
        status: "PENDING",
        amountPaidBy: amountToPaid,
        stripePaymentDetails: {
          ...stripDetails,
          ephemeralKey:
            bookingDoc.paymentDetails.stripePaymentDetails.ephemeralKey,
        },
        paymentMethod: "STRIPE",
      },
    },
  )
    .populate<{ lotId: IParking }>(
      "lotId",
      "parkingName address _id contract email about",
    )
    .orFail();

  if (updateInfo === null) {
    throw new ApiError(400, "Failed to make");
  }

  return {
    bookingId: updateInfo._id,
    name: updateInfo.lotId.parkingName,
    type: "L",
    slot: updateInfo.rentedSlot,
    bookingPeriod: { from: updateInfo.rentFrom, to: updateInfo.rentTo },
    pricing: {
      priceRate: updateInfo.priceRate,
      basePrice: updateInfo.totalAmount,
      discount: discount,
      serviceFee: serviceFee,
      transactionFee: transactionFee,
      estimatedTaxes: estimatedTaxes,
      couponApplied: discount > 0,
      couponDetails: discount > 0 ? data.couponCode : null,
      totalAmount: amountToPaid,
    },
    stripeDetails: updateInfo.paymentDetails.stripePaymentDetails,
  };
};

const createABooking = async (
  data: LotCheckOutData,
  lotDoc: MParkingRes & { owner: IMerchant },
  user: MUserRes,
) => {
  const bookingFrom = new Date(data.bookingPeriod.from);
  const bookingTo = new Date(data.bookingPeriod.to);
  const slotId = generateParkingSpaceID(
    data.bookedSlot.zone,
    data.bookedSlot.slot.toString(),
  );

  if (!verifySelectedZone(lotDoc, data.bookedSlot)) {
    throw new ApiError(400, "INVALID SLOT");
  }

  const existenceBook = await findExistingBooking(
    bookingFrom,
    bookingTo,
    lotDoc._id,
    slotId,
  );
  if (existenceBook.length > 0) {
    throw new ApiError(400, "SLOT NOT AVAILABLE");
  }

  const totalHours =
    (bookingTo.getTime() - bookingFrom.getTime()) / (1000 * 60 * 60);
  const rate = lotDoc.price;

  let discountPercentage = 0;
  if (data.couponCode) {
    discountPercentage = verifyCouponCode(data.couponCode);
  }

  const totalAmount = totalHours * rate;
  const discount = totalAmount * discountPercentage;
  const serviceFee = totalAmount * 0.05;
  const transactionFee = 0.5;
  const estimatedTaxes = totalAmount * 0.15;
  const amountToPaid =
    totalAmount + serviceFee + transactionFee + estimatedTaxes - discount;

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    stripeCustomerId = await createStripeCustomer(
      user.firstName + " " + user.lastName,
      user.email,
    );
    const __user = await User.findByIdAndUpdate(user._id, { stripeCustomerId });
    if (!__user) throw new ApiError(500, "Server Error");
  }

  const stripeDetails = await initPayment(amountToPaid, stripeCustomerId);

  const updateInfo = await LotRentRecordModel.create({
    lotId: lotDoc._id,
    rentedSlot: slotId,
    renterInfo: user?._id,
    rentFrom: bookingFrom,
    rentTo: bookingTo,
    totalAmount: totalAmount,
    totalHours: totalHours,
    discount: discount,
    serviceFee: serviceFee,
    transactionFee: transactionFee,
    estimatedTaxes: estimatedTaxes,
    appliedCouponCode: discountPercentage > 0 && data.couponCode,
    amountToPaid: amountToPaid,
    priceRate: rate,
    paymentDetails: {
      status: "PENDING",
      amountPaidBy: amountToPaid,
      stripePaymentDetails: stripeDetails,
      paymentMethod: "STRIPE",
    },
  });

  return {
    bookingId: updateInfo._id,
    name: lotDoc.parkingName,
    type: "L",
    slot: updateInfo.rentedSlot,
    bookingPeriod: { from: updateInfo.rentFrom, to: updateInfo.rentTo },
    pricing: {
      priceRate: updateInfo.priceRate,
      basePrice: updateInfo.totalAmount,
      discount: discount,
      serviceFee: serviceFee,
      transactionFee: transactionFee,
      estimatedTaxes: estimatedTaxes,
      couponApplied: discount > 0,
      couponDetails: discount > 0 ? data.couponCode : null,
      totalAmount: amountToPaid,
    },
    stripeDetails: updateInfo.paymentDetails.stripePaymentDetails,
    placeInfo: {
      name: lotDoc.parkingName,
      phoneNo: lotDoc.contactNumber,
      owner: lotDoc.owner.firstName + " " + lotDoc.owner.lastName,
      address: lotDoc.address,
      location: lotDoc.gpsLocation,
    },
  };
};

export const lotCheckOut = asyncHandler(async (req, res) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);

    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) {
      throw new ApiError(401, "UNAUTHORIZED");
    }
    const USER: MUserRes = verifiedAuth.user as MUserRes;

    console.log("Validation Succesfull request user is", verifiedAuth.user._id);
    console.log("Validating req data");
    const rData = LotCheckOutData.parse(req.body);
    console.log("Validation Succesfull req data is", rData);

    const lot = await ParkingLotModel.findById(rData.lotId).populate<{
      owner: IMerchant;
    }>("owner", "-password");
    if (!lot) {
      throw new ApiError(400, "NO LOT FOUND");
    }

    const data = await createABooking(rData, lot as any, USER);

    res.status(200).json(new ApiResponse(201, data));
  } catch (error) {
    console.log(error);
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID DATA", error.issues);
    }
    if (error instanceof mongoose.MongooseError) {
      throw new ApiError(400, error.name, error.message, error.stack);
    }
    throw error;
  }
});

export const bookASlot = asyncHandler(async (req, res) => {
  let session: mongoose.ClientSession | undefined;

  try {
    const vUser = await verifyAuthentication(req);
    if (!vUser || vUser.userType !== "user") {
      throw new ApiError(401, "User must be a verified user");
    }

    const paymentMethod = req.body.paymentMethod as string | undefined;
    const isCashPayment = paymentMethod === "CASH";

    const rData = BookingData.partial().parse(req.body);
    const { carLicensePlateImage } = rData;

    if (!carLicensePlateImage || typeof carLicensePlateImage !== "string") {
      throw new ApiError(400, "Car license plate image string is required");
    }

    const normalUser = vUser.user as IUser;
    normalUser.carLicensePlateImage = carLicensePlateImage;
    await normalUser.save();

    const rentRecord = await LotRentRecordModel.findById(rData.bookingId);
    if (!rentRecord) throw new ApiError(400, "Invalid bookingId");

    session = await LotRentRecordModel.startSession();
    session.startTransaction();

    const existbooked = await findExistingBooking(
      rentRecord.rentFrom,
      rentRecord.rentTo,
      rentRecord.lotId,
      rentRecord.rentedSlot,
    );

    if (!isCashPayment) {
      if (!rentRecord.paymentDetails.stripePaymentDetails?.paymentIntentId) {
        throw new ApiError(400, "NO STRIPE RECORD FOUND");
      }
      const stripRes = await verifyStripePayment(
        rentRecord.paymentDetails.stripePaymentDetails.paymentIntentId,
      );
      if (!stripRes.success) throw new ApiError(400, "UNSUCESSFUL_TRANSACTION");
    }

    if (existbooked.length > 0) {
      rentRecord.paymentDetails.status = "FAILED";
      await rentRecord.save();
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    rentRecord.paymentDetails.status = "SUCCESS";
    rentRecord.paymentDetails.paidAt = new Date();
    rentRecord.paymentDetails.paymentMethod = isCashPayment ? "CASH" : "STRIPE";
    await rentRecord.save();

    await session.commitTransaction();
    session = undefined;

    res.status(201).json(
      new ApiResponse(201, { booking: rentRecord }, "Slot booked successfully"),
    );
  } catch (err) {
    if (session) await session.abortTransaction();
    if (err instanceof z.ZodError) {
      console.error(err);
      throw new ApiError(400, "Invalid booking data");
    } else {
      throw err;
    }
  }
});

export const getParkingLotbyId = asyncHandler(async (req, res) => {
  const lotId = req.params.id;
  const lotdetalis = await ParkingLotModel.findById(lotId).populate<{
    owner: IMerchant;
  }>("owner", "-password -otp -otpVerified");
  if (lotdetalis) {
    res.status(200).json(new ApiResponse(200, lotdetalis));
  } else throw new ApiError(400, "NOT_FOUND");
});

export const deleteParking = asyncHandler(async (req, res) => {
  try {
    const lotId = req.params.id;

    if (!lotId || !mongoose.Types.ObjectId.isValid(lotId)) {
      throw new ApiError(400, "INVALID_ID");
    }

    const authUser = await verifyAuthentication(req);
    if (!authUser?.user || authUser.userType !== "merchant") {
      throw new ApiError(403, "UNKNOWN_USER");
    }

    const del = await ParkingLotModel.findOneAndDelete({
      _id: lotId,
      owner: authUser.user,
    });

    if (del) {
      return res
        .status(200)
        .json(new ApiResponse(200, del, "DELETE_SUCCESSFUL"));
    }

    if (await ParkingLotModel.findById(lotId)) {
      throw new ApiError(403, "ACCESS_DENIED");
    } else {
      throw new ApiError(404, "NOT_FOUND");
    }
  } catch (error) {
    throw error;
  }
});

export const getLotBookingById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const bookingId = z.string().parse(req.params.id);
      const verifiedAuth = await verifyAuthentication(req);
      if (verifiedAuth.userType === "driver")
        throw new ApiError(403, "Unauthorize Access");
      console.log("Requested booking Id:", bookingId);
      console.log("Requestedby:", verifiedAuth.user);
      const booking = await LotRentRecordModel.findById(bookingId)
        .populate<{ lotId: IParking & { owner: IMerchant } }>({
          path: "lotId",
          select: "parkingName address contactNumber _id owner",
          populate: {
            path: "owner",
            model: Merchant,
            select: "firstName lastName email phoneNumber _id",
          },
        })
        .populate<{ renterInfo: IUser }>(
          "renterInfo",
          "firstName lastName email phoneNumber",
        )
        .lean();

      if (!booking) {
        throw new ApiError(404, "Booking not found");
      }

      console.log(booking);
      const parkingLot = await ParkingLotModel.findById(booking.lotId);
      console.log(
        booking.renterInfo._id.toString() === verifiedAuth.user._id.toString(),
      );
      console.log(
        booking.lotId.owner.toString() === verifiedAuth.user._id.toString(),
      );
      if (
        !(
          booking.renterInfo._id.toString() ===
            verifiedAuth.user._id.toString() ||
          booking.lotId.owner.toString() === verifiedAuth.user._id.toString()
        )
      ) {
        throw new ApiError(403, "Unauthorize Access");
      }

      const response = {
        _id: booking._id,
        parking: {
          _id: booking.lotId._id,
          name: booking.lotId.parkingName,
          address: booking.lotId.address,
          contactNumber: booking.lotId.contactNumber,
          ownerName: `${booking.lotId.owner.firstName} ${booking.lotId.owner.lastName}`,
        },
        customer: {
          _id: booking.renterInfo._id,
          name: `${booking.renterInfo.firstName} ${booking.renterInfo.lastName || ""}`.trim(),
          email: booking.renterInfo.email,
          phone: booking.renterInfo.phoneNumber,
        },
        bookingPeriod: {
          from: booking.rentFrom,
          to: booking.rentTo,
          totalHours: booking.totalHours,
        },
        type: "L",
        bookedSlot: booking.rentedSlot,
        priceRate: booking.priceRate,
        paymentDetails: {
          totalAmount: booking.totalAmount,
          amountPaid: booking.amountToPaid,
          discount: booking.discount || 0,
          serviceFee: booking.serviceFee,
          transactionFee: booking.transactionFee,
          estimatedTaxes: booking.estimatedTaxes,
          status: booking.paymentDetails.status,
          method: booking.paymentDetails.paymentMethod,
          paidAt: booking.paymentDetails.paidAt,
        },
        status: booking.paymentDetails.status,
      };

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            response,
            "Booking details fetched successfully",
          ),
        );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError(400, "Invalid booking ID format");
      }
      throw error;
    }
  },
);

export const getLotBookingList = asyncHandler(async (req, res) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    if (!verifiedAuth?.user || verifiedAuth.userType === "driver") {
      throw new ApiError(401, "Unauthorized");
    }

    const { page = 1, limit = 10, status, lotId } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const filter: mongoose.RootFilterQuery<ILotRecord> = {};

    if (status) {
      filter["paymentDetails.status"] = status;
    } else {
      filter["paymentDetails.status"] = { $ne: "PENDING" };
    }

    if (lotId) {
      filter.lotId = lotId;
    }
    if (verifiedAuth.userType === "merchant") {
      if (!lotId) {
        const parkingLots = await ParkingLotModel.find(
          { owner: verifiedAuth.user._id },
          "_id",
        );
        const parkingLotIds = parkingLots.map((lot) => lot._id);
        filter.lotId = { $in: parkingLotIds };
      }
    }
    if (verifiedAuth.userType === "user") {
      filter.renterInfo = verifiedAuth.user._id;
    }

    const [bookings, totalCount] = await Promise.all([
      LotRentRecordModel.find(filter)
        .populate<{ lotId: IParking & { owner: IMerchant } }>({
          path: "lotId",
          select: "parkingName address contactNumber _id owner",
          populate: {
            path: "owner",
            model: Merchant,
            select: "firstName lastName email phoneNumber _id",
          },
        })
        .populate<{ renterInfo: IUser }>(
          "renterInfo",
          "firstName lastName email phoneNumber _id",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      LotRentRecordModel.countDocuments(filter),
    ]);

    console.log("Bookings", bookings.length);
    const formattedBookings = bookings.map((booking) => ({
      _id: booking._id,
      parking: {
        _id: booking.lotId?._id.toString(),
        name: booking.lotId?.parkingName,
        address: booking.lotId?.address,
        contactNumber: booking.lotId?.contactNumber,
        ownerName: `${booking.lotId.owner.firstName} ${booking.lotId.owner.lastName}`,
      },
      customer: {
        _id: booking.renterInfo?._id.toString(),
        name: `${booking.renterInfo?.firstName} ${booking.renterInfo?.lastName || ""}`.trim(),
        email: booking.renterInfo?.email,
        phone: booking.renterInfo?.phoneNumber,
      },
      type: "L",
      bookingPeriod: {
        from: booking.rentFrom,
        to: booking.rentTo,
        totalHours: booking.totalHours,
      },
      bookedSlot: booking.rentedSlot,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount || 0,
        serviceFee: booking.serviceFee,
        transactionFee: booking.transactionFee,
        estimatedTaxes: booking.estimatedTaxes,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.paymentMethod,
        paidAt: booking.paymentDetails.paidAt,
      },
      status: booking.paymentDetails.status,
    }));

    console.log("formatedBooking", formattedBookings);
    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings: formattedBookings,
          pagination: {
            total: totalCount,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalCount / limitNum),
          },
        },
        "Bookings fetched successfully",
      ),
    );
  } catch (error) {
    console.log(error);
    throw error;
  }
});

export const getListOfParkingLot = asyncHandler(async (req, res) => {
  try {
    const owner = z.string().optional().parse(req.query.owner);
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude = z.coerce.number().optional().parse(req.query.latitude);
    console.log(longitude, latitude);
    const queries: mongoose.FilterQuery<IParking> = {};
    if (longitude && latitude) {
      queries.gpsLocation = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
      };
    }

    if (owner) {
      queries.owner = owner;
    }
    const result = await ParkingLotModel.find(queries).exec();
    if (result) {
      res.status(200).json(new ApiResponse(200, result));
    } else throw new ApiError(500);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", error.issues);
    } else if (error instanceof ApiError) throw error;
    console.log(error);
    throw new ApiError(500, "Server Error", error);
  }
});
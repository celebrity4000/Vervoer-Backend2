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
import { createStripeCustomer, initPayment, verifyStripePayment } from "../utils/stripePayments.js";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import QRCode from 'qrcode';

// Zod schemas for validation
const GarageData = z.object({
  garageName: z.string().min(1, "Garage name is required"),
  about: z.string().min(1, "About is required"),
  address: z.string().min(1, "Address is required"),
  price : z.coerce.number().optional() ,
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
    zone : z.string().regex(/^[A-Z]{1,3}$/),
    slot : z.coerce.number().max(1000).min(1)
  }),
  bookingPeriod: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime()
  }),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL" ]).optional(),
  vehicleNumber: z.string().min(5).optional()
}).refine((data) => data.bookingPeriod.from < data.bookingPeriod.to, {
  message: "Booking period is invalid",
  path: ["bookingPeriod"],
});


const BookingData = z.object({
  transactionId: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CREDIT", "DEBIT", "UPI", "PAYPAL"]).optional(),
  bookingId : z.string(),
})
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

      //  Also parse stringified arrays for newly added fields
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

      //  Validate full request with Zod
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
    // This is the source of truth for currently stored images on Cloudinary
    finalImages = [...garage.images];

    // Handle existing image URLs sent from frontend (these are URLs already on Cloudinary)
    if (requestBody.existingImages && typeof requestBody.existingImages === 'string') {
      const existingImagesFromFrontend: string[] = JSON.parse(requestBody.existingImages);
      // Filter the backend's current images to only keep those that the frontend explicitly sent back
      // This implicitly handles image removal if the frontend removes an existing image and doesn't send its URL.
      finalImages = finalImages.filter(url => existingImagesFromFrontend.includes(url));
    } else {
        // If 'existingImages' is not sent or is empty from the frontend, it implies either:
        // 1. All previous images are removed (if frontend explicitly clears them)
        // 2. Or, for some reason, the frontend didn't send them, in which case we might default to keeping all current.
        // For robust behavior, it's better if frontend always sends the full desired list of existing URLs.
        // If frontend sends an empty array in existingImages, this else block won't be hit, and finalImages will correctly become empty after filtering.
    }

    // Add newly uploaded images to the final list
    if (newlyUploadedImageURLs.length > 0) {
      finalImages = [...new Set([...finalImages, ...newlyUploadedImageURLs])]; // Use Set to avoid duplicates
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
    const startDate = z.iso.date().parse(req.query.startDate);
    const endDate = z.iso.date().parse(req.query.endDate);
    const garageId = z.string().parse(req.query.garageId);

    const garage = await Garage.findById(garageId);
    if (!garage) {
      console.log("ID:",garageId)
      throw new ApiError(400, "GARAGE_NOT_FOUND");
    }
    let totalSpace = 0 ;
    garage.spacesList?.forEach((e)=>{totalSpace+=e.count})
    // Get all bookings that overlap with the requested time period
    const bookings = await GarageBooking.find({
      garageId,
      "paymentDetails.status" : {$ne : "PENDING"},
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
      bookedSlot : bookings.map((e)=>({rentedSlot : e.bookedSlot, rentFrom : e.bookingPeriod?.from , rentTo : e.bookingPeriod?.to})) ,
      isOpen: garage.isOpenNow()
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", err.issues);
    }
    console.log(err) ;
    throw err;
  }
});

/**
 * Book a garage slot
 */

/**
 * Checkout and process payment for a parking booking
 */
export const checkoutGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("new chekout request\nValidating Auth")
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }

    console.log("Validation Succesfull request user is", verifiedAuth.user._id )
    console.log("Validating req data")
    const rData = CheckoutData.parse(req.body);
    console.log("Validation Succesfull req data is", rData)
    console.log("Verifying garage")
    const garage = await Garage.findById(rData.garageId).populate<{owner : IMerchant }>("owner", "-password");
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }
    console.log("Verifying garage is", garage)
    // Check if the slot exists in availableSlots
    const selectedZone = garage?.spacesList?.get(rData.bookedSlot.zone);
    console.log("Verifying slot id", rData.bookedSlot.slot)
    console.log("Maximum Slot: ",selectedZone)
    if (!selectedZone || rData.bookedSlot.slot > selectedZone.count) {
      throw new ApiError(400, "INVALID_SLOT");
    }
    // check Availability
    const bookedSlotId = generateParkingSpaceID(rData.bookedSlot.zone,rData.bookedSlot.slot.toString());
    console.log("cheking availability of slot")
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
    if(isNotAvailableSlot){
      console.log("slot is not available found a booking ", isNotAvailableSlot._id)
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    } 
    // Apply coupon if provided
    const startDate = new Date(rData.bookingPeriod.from);
    const endDate = new Date(rData.bookingPeriod.to);
    const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    let totalAmount = totalHours * (selectedZone.price|| 0), discount = 0  ,couponApplied = false , couponDetails = null ;

    const platformCharge = totalAmount*0.1 ;
    if (rData.couponCode) {
      // In a real application, you would validate the coupon here
      // This is a simplified example

      const isValidCoupon = await validateCoupon(rData.couponCode, verifiedAuth?.user);
      
      if (isValidCoupon) {
        // Example: 10% discount
        discount = totalAmount * 0.1;
        couponApplied = true;
        couponDetails = {
          code: rData.couponCode,
          discount: discount,
          discountPercentage: 10
        };
      }
    }
    let stripeCustomerId = verifiedAuth.user.stripeCustomerId ;
    if(!stripeCustomerId){
      stripeCustomerId = await createStripeCustomer(verifiedAuth.user.firstName+" " +verifiedAuth.user.lastName , verifiedAuth.user.email);
      User.findByIdAndUpdate(verifiedAuth.user._id ,{stripeCustomerId}) ;
    }

    const stripeDetals = await initPayment(totalAmount + platformCharge - discount, stripeCustomerId) ;
    // Update booking with payment and checkout details
    const booking = await GarageBooking.create({
      garageId: rData.garageId,
      bookedSlot: bookedSlotId,
      customerId: verifiedAuth.user._id ,
      bookingPeriod: rData.bookingPeriod,
      vehicleNumber: rData.vehicleNumber,
      totalAmount : totalAmount +discount ,
      discount : discount ,
      amountToPaid:  totalAmount + platformCharge - discount,
      platformCharge: platformCharge,
      priceRate : selectedZone.price ,
      paymentDetails: {
        amount: totalAmount + platformCharge - discount,
        method: rData.paymentMethod,
        status: 'PENDING',
        transactionId: null,
        paidAt: null,
        StripePaymentDetails : {...stripeDetals, customerId: stripeCustomerId}
      },
      coupon: couponApplied ? rData.couponCode : undefined ,
    })

    // In a real application, you would integrate with a payment gateway here
    // and process the payment
    console.log(booking) ;
    const response = {
      bookingId: booking._id,
      type:"G",
      name: garage.garageName,
      slot: booking.bookedSlot,
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      pricing: {
        priceRate : selectedZone.price ,
        basePrice: totalHours * (selectedZone.price || 0),
        discount: discount,
        platformCharge,
        couponApplied: couponApplied,
        couponDetails: couponApplied ? couponDetails : null,
        totalAmount: totalAmount + platformCharge -discount
      },
      stripeDetails : booking.paymentDetails.StripePaymentDetails ,
      placeInfo : {
        name : garage.garageName ,
        phoneNo : garage.contactNumber ,
        owner : garage.owner.firstName + " "+ garage.owner.lastName ,
        address : garage.address,
        location : garage.location,
      }
    };

    res.status(200).json(new ApiResponse(200, response));
  } catch (err) {
    console.log(err) ;
    if (err instanceof z.ZodError) {
      throw new ApiError(400, 'VALIDATION_ERROR', err.issues);
    }
    throw err;
  }
});

// Helper function to validate coupon (placeholder implementation)
async function validateCoupon(code: string, user: mongoose.Document<any , any , IUser>): Promise<boolean> {
  // In a real application, you would check the coupon against a database
  // and verify if it's valid for this user
  return code.startsWith('DISC');
}

export const bookGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  let session: mongoose.ClientSession | undefined;
  
  try {
    const verifiedUser = await verifyAuthentication(req);
    
    if (!(verifiedUser?.userType === "user" )) {
      throw new ApiError(401, "User must be a verified user");
    }

    const rData = BookingData.parse(req.body);
    const booking = await GarageBooking.findById(rData.bookingId);
    if (!booking) {
      throw new ApiError(404, "Booking not found");
    }
    if(booking.customerId.toString() !== verifiedUser.user._id.toString()){
      console.log("customerId:", booking.customerId);
      console.log("userId:", verifiedUser.user._id);
      throw new ApiError(401, "User is not authorized to book this slot");
    }
    // Start transaction
    if(booking.paymentDetails?.status === "SUCCESS" && booking.paymentDetails.transactionId){
      throw new ApiError(400, "USER ALREADY PAID AND BOOKED") ;
    }
    session = await mongoose.startSession();
    session.startTransaction();

    // Check for overlapping bookings
    const bookingFrom = new Date (booking.bookingPeriod.from) ;
    const bookingTo = new Date(booking.bookingPeriod.to);
    const existingBookings = await GarageBooking.countDocuments({
      garageId: booking.garageId,
      bookedSlot: booking.bookedSlot, 
      "paymentDetails.status" :"SUCCESS",
      $or: [
        {
          'bookingPeriod.from': { $lt:bookingTo },
          'bookingPeriod.to': { $gt:bookingFrom }
        },
        {
          'bookingPeriod.from': { $gte:bookingFrom, $lte:bookingTo }
        },
        {
          'bookingPeriod.to': { $gte:bookingFrom, $lte: bookingTo }
        }
      ]
    }).session(session);
    console.log(booking) ;

    if(!booking.paymentDetails.StripePaymentDetails?.paymentIntentId){
      throw new ApiError(400,"NO STRIPE RECORD FOUND") ;
    }

    const stripRes = await verifyStripePayment(booking.paymentDetails.StripePaymentDetails.paymentIntentId) ;
    if(!stripRes.success) throw new ApiError(400, "UNSUCESSFUL_TRANSACTION")

    booking.paymentDetails.paidAt = new Date()
    if(existingBookings ){
      booking.paymentDetails.status = "FAILED" ;
      await booking.save();
      // TODO: Refund Logic
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }
    booking.paymentDetails.status = "SUCCESS" ;
    booking.save() ;
    await session.commitTransaction();
    
    res.status(201).json(new ApiResponse(201, { booking: booking }));
  } catch (err) {
    if (session) {
      await session.abortTransaction();
    }
    if (err instanceof z.ZodError) {
      console.log(err.issues) ;
      throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    }
    console.log(err)
    throw err;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});
/**
 * Get garage details
 */
export const getGarageDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    
    const garage = await Garage.findById(garageId).populate<{owner :IMerchant}>("owner" , "-password -otp -otpExpire");
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }

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
    // Fix: Use req.params.id instead of req.query.id for URL parameter
    const garageId = z.string().parse(req.params.id);
    const authUser = await verifyAuthentication(req);
    if (!authUser?.user || authUser.userType !== "merchant") throw new ApiError(403, "UNAUTHORIZED_ACCESS")
    
    // Fix: Add await to actually execute the deletion
    const del = await Garage.findOneAndDelete({
      _id: garageId,
      owner: authUser?.user
    });
    
    if (!del) {
      if (await Garage.findById(garageId)) throw new ApiError(403, "ACCESS_DENIED");
      throw new ApiError(404, "NOT_FOUND");
    } else {
      res.status(200).json(new ApiResponse(200, del));
    }
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_DATA");
    throw error;
  }
});

export const getListOfGarage = asyncHandler(async (req, res) => {
  try {
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude = z.coerce.number().optional().parse(req.query.latitude);
    const owner = z.string().optional().parse(req.query.owner) ;
    const queries: mongoose.FilterQuery<IGarage> = {};
    if(owner){
      queries.owner = owner ;
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
      console.log(result) ;
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


/**
 * @description Get booking information for a specific garage booking
 * @route GET /api/merchants/garage/booking/:bookingId
 * @access Private - Only accessible by the user who made the booking or the garage owner
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
      .populate<{garageId : IGarage & {owner : IMerchant}}>({
        path :'garageId', 
        select : 'garageName address contactNumber _id owner',
        populate : {
          path : "owner" ,
          model : Merchant,
          select :"firstName lastName email phoneNumber _id"
        }
      }).orFail()
      .populate<{customerId : IUser}>('customerId', 'firstName lastName email phoneNumber _id').orFail()
      .lean();

    if (!booking) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND');
    }
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
    console.log(booking) ;
    const response = {
      _id: booking._id,
      garage: {
        _id: booking.garageId._id,
        name: booking.garageId.garageName,
        address: booking.garageId.address,
        contactNumber: booking.garageId.contactNumber,
        ownerName : `${booking.garageId.owner?.firstName} ${booking.garageId.owner?.lastName}`
      },
      type : "G",
      customer: {
        _id: booking.customerId._id,
        name: `${booking.customerId.firstName} ${booking.customerId.lastName || ''}`.trim(),
        email: booking.customerId.email,
        phone: booking.customerId.phoneNumber
      },
      bookingPeriod: booking.bookingPeriod,
      vehicleNumber: booking.vehicleNumber,
      bookedSlot: booking.bookedSlot,
      priceRate : booking.priceRate ,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method,
        paidAt : booking.paymentDetails.paidAt,
        platformCharge : booking.platformCharge,
      }
    };

    res.status(200).json(new ApiResponse(200, response));
  } catch (error) {
    console.log(error);
    throw error;
  }
})

/**
 * @description Get a paginated list of garage bookings
 * @route GET /api/merchants/garage/bookings
 * @queryParam page - Page number (default: 1)
 * @queryParam size - Number of items per page (default: 10)
 * @queryParam garageId - Optional garage ID (for merchants to filter by garage)
 * @access Private - Accessible by authenticated users (sees their own bookings) or merchants (sees their garage's bookings)
 */
const BookingQueryParams = z.object({
  page : z.coerce.number().min(1).default(1),
  limit : z.coerce.number().min(1).default(10),
  garageId : z.string().optional()
})
export const garageBookingList = asyncHandler(async (req, res) => {
  try {
    // Parse query parameters with defaults
    console.log("NEW Query Requested")
    const {page , limit , garageId} = BookingQueryParams.parse(req.query);
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
        const garage = await Garage.findOne({ _id: garageId, owner: verifiedAuth.user._id } , {}, {
          
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
          return ;
        }
        query.garageId = { $in: garageIds };
      }
    } else {
      throw new ApiError(403, 'UNAUTHORIZED_ACCESS');
    }
    query["paymentDetails.status"] = {$ne : "PENDING"};
    console.log("query at garage: ", query);
    // Get paginated bookings with related data
    const bookings = await GarageBooking.find(query)
      .populate<{garageId : IGarage &{owner:IMerchant}}>({
        path :'garageId', 
        select : 'garageName address contactNumber _id owner',
        populate : {
          path : "owner" ,
          model : Merchant,
          select :"firstName lastName email phoneNumber _id"
        }
      })
      .populate<{customerId : IUser}>('customerId', 'firstName lastName email phoneNumber _id')
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limit)
      .lean();

    // Format the response
    console.log(bookings) ;
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
      priceRate : booking.priceRate ,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.method ,
        paidAt : booking.paymentDetails.paidAt ,
        platformCharge : booking.platformCharge,
      },
      status: booking.paymentDetails.status,
      type : "G" ,
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



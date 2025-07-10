import { Request, Response } from "express";
import {
  ILotRecord,
  IParking,
  LotRentRecordModel,
  ParkingLotModel,
} from "../models/merchant.model.js";
import { BookingData, ParkingData } from "../zodTypes/merchantData.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { generateParkingSpaceID  } from "../utils/lotProcessData.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import { IUser, User } from "../models/normalUser.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { createStripeCustomer, initPayment, updateStripePayment, verifyStripePayment } from "../utils/stripePayments.js";

type MParkingRes = mongoose.Document<mongoose.Types.ObjectId , {}, IParking> & IParking  ;
type MLotRecordRes = mongoose.Document<mongoose.Types.ObjectId , {}, ILotRecord> & ILotRecord  ;

type MUserRes = mongoose.Document<mongoose.Types.ObjectId , {}, IUser> & IUser ;

export const registerParkingLot = asyncHandler(
  async (req: Request, res: Response) => {
    //TODO: verify merchant account
    try {
      console.log("REQBODY: ",req.body)
      const verifiedAuth = await verifyAuthentication(req) ;
      console.log(verifiedAuth)
      let owner = null ;
      if(verifiedAuth?.userType !== "merchant") {
        throw new ApiError(400, "INVALID_USER") ;
      }
      owner = verifiedAuth.user ;
      if (!owner) {
        throw new ApiError(400, "UNKNOWN_USER");
      }
      const rData = ParkingData.parse(req.body);
      let imageURL: string[] = [] ;
      if(req.files){
        if(Array.isArray(req.files)){
          imageURL = await Promise.all(req.files.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url)) ;
        }
        else {
          imageURL = await Promise.all(req.files.images.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url))
        }
      }
      rData.images = imageURL ;
      
      const newParkingLot = await ParkingLotModel.create({
        owner: owner?._id,
        ...rData
      });
      await newParkingLot.save();
      res.status(201).json(new ApiResponse(201, { parkingLot: newParkingLot }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.log("Errors ",err.issues) ;
        throw new ApiError(400, "DATA VALIDATION", err.issues);
      }
      throw err;
    }
  }
);

export const editParkingLot = asyncHandler(async (req: Request, res: Response) => {
  try {
    const parkingLotId = z.string().parse(req.params.id);
    const updateData = ParkingData.parse(req.body);
    const verifiedAuth = await verifyAuthentication(req);

    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) {
      throw new ApiError(400, "UNAUTHORIZED");
    }

    // Find the parking lot and verify ownership
    const parkingLot = await ParkingLotModel.findById(parkingLotId);
    if (!parkingLot) {
      throw new ApiError(404, "PARKING_LOT_NOT_FOUND");
    }

    if (parkingLot.owner && verifiedAuth.user && parkingLot.owner.toString() !== verifiedAuth.user?._id?.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    // Update the parking lot with new data
    let imageURL: string[] = [] ;
      if(req.files){
        if(Array.isArray(req.files)){
          imageURL = await Promise.all(req.files.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url)) ;
        }
        else {
          imageURL = await Promise.all(req.files.images.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url))
        }
      }
    if(imageURL.length > 0) updateData.images = [...parkingLot.images, ...imageURL] ;
    const updatedParkingLot = await ParkingLotModel.findByIdAndUpdate(
      parkingLotId,
      { $set: updateData },
      { new: true, runValidators: true }
    ); 

    if (!updatedParkingLot) {
      throw new ApiError(500, "FAILED_TO_UPDATE_PARKING_LOT");
    }

    res.status(200).json(new ApiResponse(200, { parkingLot: updatedParkingLot }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    }
    throw err;
  }
});

export const getAvailableSpace = asyncHandler(async (req, res) => {
  try {
    const startDate = z.iso.date().parse(req.query.startDate);
    const lastDate = z.iso.date().parse(req.query.lastDate);
    const lotID = z.string().parse(req.query.lotId);
    const lotData = await ParkingLotModel.findById(lotID);
    let totalSpace = 0 ;
    if (!lotData) throw new ApiError(400, "Can't Find The Lot");
    lotData.spacesList?.forEach(v => {totalSpace+=v}) ;

    const result = await LotRentRecordModel.find(
          {
            lotId: lotID,
            $or: [
              {
                $and: [
                  // collision with starting date
                  { rentFrom: { $lte: startDate } },
                  { rentTo: { $gte: startDate } },
                ],
              },
              {
                $and: [
                  // collision with end date
                  { rentFrom: { $lte: lastDate } },
                  { rentTo: { $gte: lastDate } },
                ],
              },
              {
                $and: [
                  // collision within  date
                  { rentFrom: { $gte: startDate } },
                  { rentTo: { $lte: lastDate } },
                ],
              },
            ],
          },
          "-renterInfo"
        ).exec();
      
    res.status(200).json(new ApiResponse(200, {availableSpace : totalSpace-result.length ,bookedSlot: result}));
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
const LotCheckOutData = z.object({
  lotId : z.string(),
  bookedSlot : z.object({zone : z.string().regex(/^[A-Z]{1,3}$/), slot : z.coerce.number()}),
  bookedFrom : z.iso.datetime() ,
  bookedTo : z.iso.datetime(),
  couponCode : z.string().optional() ,
}).refine((data) => data.bookedFrom < data.bookedTo) ;
type LotCheckOutData = z.infer<typeof LotCheckOutData>;

async function findExistingBooking(sd : Date | mongoose.Schema.Types.Date , ed : Date | mongoose.Schema.Types.Date , lotId : string | mongoose.Types.ObjectId , rentedSlotId : string){
  if(sd >= ed){
    throw new ApiError(400,"INVALID_DATE") ;
  }
    const res = await LotRentRecordModel.find(
      {
        lotId: lotId,
        rentedSlot: rentedSlotId ,
        "paymentDetails.status" : {$ne : "PENDING"},
        $or: [
          { rentFrom: { $lte: sd }, rentTo: { $gte: sd } },
          { rentFrom: { $lte: ed }, rentTo: { $gte: ed } },
          { rentFrom: { $gte: sd}, rentTo: { $lte: ed } },
        ],
      },
    ).exec();
    
    return res ;
}   
function verifySelectedZone(lotDoc : mongoose.Document<mongoose.Types.ObjectId , {}, IParking> & IParking, slot : LotCheckOutData["bookedSlot"]){
  const selectedZone = lotDoc.spacesList.get(slot.zone) || 0;
  if(selectedZone < slot.slot){
    return false ;
  }
  return true ;
}
function verifyCouponCode(code : string){
  return code.startsWith("XES") ? 0.20 : 0 ;
}

const updateACheckout = async ( data : LotCheckOutData, lotDoc : MParkingRes, bookingDoc :MLotRecordRes , bookingId : string | mongoose.Types.ObjectId , user : MUserRes )=>{
  const bookingFrom = new Date(data.bookedFrom) ;
  const bookingTo = new Date(data.bookedTo) ;
  const slotId = generateParkingSpaceID(data.bookedSlot.zone , data.bookedSlot.slot.toString()) ;

  if(!verifySelectedZone(lotDoc,data.bookedSlot)){
    throw new ApiError(400,"INVALID SLOT") ;
  }

  const exiestenseBook = await findExistingBooking(bookingFrom , bookingTo, lotDoc._id, slotId )  ;
  if(exiestenseBook){
    throw new ApiError(400, "SLOT NOT AVAILABLE")
  }


  const totalHours =( bookingTo.getTime() - bookingFrom.getTime())/(1000*60*60) ;
  const rate = lotDoc.price ;
  let discountPercentage = 0 ;//Float
  if(data.couponCode){
    discountPercentage = verifyCouponCode(data.couponCode)
  }

  const totalAmount = totalHours*rate ;
  const discount = totalAmount*discountPercentage ;
  const stripDetails = await updateStripePayment(bookingDoc.paymentDetails.stripePaymentDetails.paymentIntentId , totalAmount - discount );

  const updateInfo = await LotRentRecordModel.findByIdAndUpdate(bookingDoc._id , {
    lotId : lotDoc._id ,
    rentedSlot : slotId ,
    renterInfo : user?._id ,
    rentFrom : bookingFrom,
    rentTo : bookingTo ,
    totalAmount : totalAmount ,
    totalHours : totalHours ,
    discount : discount ,
    appliedCouponCode : discountPercentage > 0 && data.couponCode ,
    amountToPaid : totalAmount-discount ,
    priceRate : rate ,
    paymentDetails : {
      status : "PENDING",
      amountPaidBy : totalAmount - discount ,
      stripePaymentDetails : {
        ...stripDetails,
        ephemeralKey: bookingDoc.paymentDetails.stripePaymentDetails.ephemeralKey,
      },
      paymentMethod : "STRIPE"
    }
  }).populate<{lotId: IParking}>("lotId", "parkingName address _id contract email about").orFail()
  if(updateInfo === null){
    throw new ApiError(400,"Failed to make") ;
  }
  return {
    bookingId : updateInfo._id ,
    name : updateInfo.lotId.parkingName,
    type: "L" ,
    slot: updateInfo.rentedSlot ,
    bookingPeriod: {from : updateInfo.rentFrom , to : updateInfo.rentTo},
    pricing: {
        priceRate : updateInfo.priceRate ,
        basePrice:updateInfo.totalAmount,
        discount: discount,
        couponApplied: discount > 0,
        couponDetails: discount>0 ? data.couponCode : null,
        totalAmount: totalAmount
      },
      stripeDetails : updateInfo.paymentDetails.stripePaymentDetails ,
  }
}
const createABooking = async (data : LotCheckOutData, lotDoc : MParkingRes , user : MUserRes)=>{
  const bookingFrom = new Date(data.bookedFrom) ;
  const bookingTo = new Date(data.bookedTo) ;
  const slotId = generateParkingSpaceID(data.bookedSlot.zone , data.bookedSlot.slot.toString()) ;

  if(!verifySelectedZone(lotDoc,data.bookedSlot)){
    throw new ApiError(400,"INVALID SLOT") ;
  }

  const exiestenseBook = await findExistingBooking(bookingFrom , bookingTo, lotDoc._id, slotId )  ;
  if(exiestenseBook){
    throw new ApiError(400, "SLOT NOT AVAILABLE")
  }
  
  const totalHours =( bookingTo.getTime() - bookingFrom.getTime())/(1000*60*60) ;
  const rate = lotDoc.price ;
  let discountPercentage = 0 ;//Float
  if(data.couponCode){
    discountPercentage = verifyCouponCode(data.couponCode)
  }
  
  const totalAmount = totalHours*rate ;
  const discount = totalAmount*discountPercentage ;
  
  let stripeCustomerId = user.stripeCustomerId ;
  if(!stripeCustomerId){
    stripeCustomerId = await createStripeCustomer(user.firstName+" " +user.lastName , user.email);
    const __user = await User.findByIdAndUpdate(user._id ,{stripeCustomerId}) ;
    if(!__user) throw new ApiError(500,"Server Error");
  }
  const stripeDetails = await initPayment(totalAmount - discount, stripeCustomerId) ;

  const updateInfo = await LotRentRecordModel.create({
    lotId : lotDoc._id ,
    rentedSlot : slotId ,
    renterInfo : user?._id ,
    rentFrom : bookingFrom,
    rentTo : bookingTo ,
    totalAmount : totalAmount ,
    totalHours : totalHours ,
    discount : discount ,
    appliedCouponCode : discountPercentage > 0 && data.couponCode ,
    amountToPaid : totalAmount-discount ,
    priceRate : rate ,
    paymentDetails : {
      status : "PENDING",
      amountPaidBy : totalAmount - discount ,
      stripePaymentDetails : stripeDetails,
      paymentMethod : "STRIPE"
    }
  }) ;
  return {
    bookingId : updateInfo._id ,
    name : lotDoc.parkingName,
    type : "L",
    slot: updateInfo.rentedSlot ,
    bookingPeriod: {from : updateInfo.rentFrom , to : updateInfo.rentTo},
    pricing: {
        priceRate : updateInfo.priceRate ,
        basePrice:updateInfo.totalAmount,
        discount: discount,
        couponApplied: discount > 0,
        couponDetails: discount>0 ? data.couponCode : null,
        totalAmount: totalAmount
      },
      stripeDetails : updateInfo.paymentDetails.stripePaymentDetails ,
  }
}
export const lotCheckOut = asyncHandler(async (req,res)=>{
  try{
  const verifiedAuth = await verifyAuthentication(req) ;
  
    if (verifiedAuth?.userType !== "user" || !verifiedAuth?.user) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }
    const USER: MUserRes = verifiedAuth.user as MUserRes ;

    console.log("Validation Succesfull request user is", verifiedAuth.user._id )
    console.log("Validating req data")
    const rData = LotCheckOutData.parse(req.body);
    console.log("Validation Succesfull req data is", rData)
    
    const lot = await ParkingLotModel.findById(rData.lotId) ;
    if(!lot){
      throw new ApiError(400,"NO LOT FOUND") ;
    }

    // const rentM = await  LotRentRecordModel.findOne({
    //   renterInfo : USER._id ,
    //   "paymentDetails.status" : "PENDING" ,
    // })
    
    const data = await createABooking(rData,lot,USER) ;

    res.status(200).json(new ApiResponse(201,data)) ;

  }catch(error){
    console.log(error) ;
    if(error instanceof z.ZodError){
      throw new ApiError(400,"INVALID DATA", error.issues) ;
    }
    if(error instanceof mongoose.MongooseError){
      throw new ApiError(400,error.name , error.message , error.stack)
    }
    throw error ;
  }
})



export const bookASlot = asyncHandler(async (req, res) => {
  let session: mongoose.ClientSession | undefined;

  try {
    const vUser = await verifyAuthentication(req);
    if (!vUser || vUser.userType !== "user") {
      throw new ApiError(401, "User must be a verified user");
    }

    const rData = BookingData.parse(req.body);

    const { carLicensePlateImage } = rData;
    if (!carLicensePlateImage || typeof carLicensePlateImage !== "string") {
      throw new ApiError(400, "Car license plate image string is required");
    }

    const normalUser = vUser.user as IUser;
    normalUser.carLicensePlateImage = carLicensePlateImage;
    await normalUser.save();

    const rentRecord = await LotRentRecordModel.findById(rData.bookingId) ;
    if (!rentRecord) throw new ApiError(400, "Invalid bookingId");

    await LotRentRecordModel.createCollection();
    session = await LotRentRecordModel.startSession();
    session.startTransaction();
    const existbooked = await findExistingBooking(rentRecord.rentFrom , rentRecord.rentTo,rentRecord.lotId, rentRecord.rentedSlot)

    if (!rentRecord.paymentDetails.stripePaymentDetails?.paymentIntentId) {
      throw new ApiError(400, "NO STRIPE RECORD FOUND");
    }

    const stripRes = await verifyStripePayment(
      rentRecord.paymentDetails.stripePaymentDetails.paymentIntentId
    );
    if (!stripRes.success) throw new ApiError(400, "UNSUCESSFUL_TRANSACTION");
    if(existbooked.length > 0 ){
      rentRecord.paymentDetails.status = "FAILED" ;
      await rentRecord.save();
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    rentRecord.paymentDetails.status = "SUCCESS" ,
    rentRecord.paymentDetails.paidAt = new Date() ;
    rentRecord.save() ;
    await session.commitTransaction();
    session = undefined;

    res.status(201).json(new ApiResponse(201, { booking: rentRecord }, "Slot booked successfully"));

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

export const getParkingLotbyId = asyncHandler(async (req,res)=>{
  const lotId = req.params.id ;
  const lotdetalis = await ParkingLotModel.findById(lotId);
  if(lotdetalis){
    res.status(200).json(new ApiResponse(200,lotdetalis));
  }
  else throw new ApiError(400,"NOT_FOUND");
})
export const deleteParking = asyncHandler(
  async (req,res)=>{
    try {
      const lotId = z.string().parse(req.query.id) ;
      const authUser = await verifyAuthentication(req) ;
      if(!authUser?.user || authUser.userType!== "merchant" ) throw new ApiError(403,"UNKNOWN_USER") ;
      const del = await ParkingLotModel.findOneAndDelete({
        _id : lotId,
        owner : authUser?.user
      })
      if(del){
        res.status(200).json(new ApiResponse(200,del,"DELETE SUCCESSFUL"))
      }else {
        if(await ParkingLotModel.findById(lotId)) 
          throw new ApiError(403,"ACCESS_DENIED");
        else throw new ApiError(404,"NOT_FOUND");
      }
    } catch (error) {
      if(error instanceof z.ZodError){
        throw new ApiError(400,"INVALID_ID");
      }
      else throw error ;
    }
  }
)

export const getListOfParkingLot = asyncHandler(async (req, res)=>{
  try {

  const owner = z.string().optional().parse(req.query.owner) ;
  const longitude = z.coerce.number().optional().parse(req.query.longitude) ;
  const latitude = z.coerce.number().optional().parse(req.query.latitude) ;
  console.log(longitude , latitude) ;
  const queries: mongoose.FilterQuery<IParking> = {} ;
  if(longitude && latitude) {
    queries.gpsLocation = {
      $near : {
      $geometry: {
        type : "Point",
        coordinates :[longitude,latitude] ,
      }
    }}
  }

  if(owner){
      queries.owner = owner ;
  }
  const result = await ParkingLotModel.find(queries).exec() ;
  if(result){
    res.status(200).json(new ApiResponse(200,result))
  }
  else throw new ApiError(500) ;
}catch(error){
  if(error instanceof z.ZodError){
    throw new ApiError(400,"INVALID_QUERY",error.issues);
  }
  else if(error instanceof ApiError) throw error ;
  console.log(error) ;
  throw new ApiError(500, "Server Error", error);
}
})

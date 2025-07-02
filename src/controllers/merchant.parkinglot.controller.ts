import { Request, Response } from "express";
import {
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
import { IUser } from "../models/normalUser.model.js";

import uploadToCloudinary from "../utils/cloudinary.js";
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

export const bookASlot = asyncHandler(async (req, res) => {
  let session: mongoose.ClientSession | undefined;

  try {
    const vUser = await verifyAuthentication(req);

    if (!(vUser?.userType === "user")) {
      throw new ApiError(401, "User must be a verified user");
    }
    console.log(req.body);
    const rData = BookingData.parse(req.body);

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const carLicensePlateImage = files["carLicensePlateImage"]?.[0];
    if (!carLicensePlateImage) {
      throw new ApiError(400, "Car license plate image is required");
    }

    const uploadResult = await uploadToCloudinary(carLicensePlateImage.buffer);
    if (!uploadResult.secure_url) {
      throw new ApiError(500, "Failed to upload license plate image");
    }

    const imageUrl = uploadResult.secure_url;

    if (vUser.userType === "user") {
      const normalUser = vUser.user as IUser;
      normalUser.carLicensePlateImage = imageUrl;
      await normalUser.save();
    }

    const parkingLot = await ParkingLotModel.findById(rData.lotId);
    if (!parkingLot) throw new ApiError(400, "Invalid lotId");

    if ((parkingLot.spacesList?.get(rData.rentedSlot.zone) || 0) <= rData.rentedSlot.slot) {
      throw new ApiError(400, "Invalid selected zone/slot");
    }

    await LotRentRecordModel.createCollection();
    session = await LotRentRecordModel.startSession();
    session.startTransaction();

    const slotConflicts = await LotRentRecordModel.find(
      {
        lotId: rData.lotId,
        rentedSlot: generateParkingSpaceID(rData.rentedSlot.zone, rData.rentedSlot.slot.toString()),
        $or: [
          { $and: [{ rentFrom: { $lte: rData.rentFrom } }, { rentTo: { $gte: rData.rentFrom } }] },
          { $and: [{ rentFrom: { $lte: rData.rentTo } }, { rentTo: { $gte: rData.rentTo } }] },
          { $and: [{ rentFrom: { $gte: rData.rentFrom } }, { rentTo: { $lte: rData.rentTo } }] },
        ],
      },
      "-renterInfo"
    ).exec();

    if (slotConflicts.length > 0) {
      throw new ApiError(400, "Selected slot not available for these dates", slotConflicts);
    }

    const booked = await LotRentRecordModel.create({
      lotId: rData.lotId,
      rentedSlot: generateParkingSpaceID(rData.rentedSlot.zone, rData.rentedSlot.slot.toString()),
      rentFrom: new Date(rData.rentFrom),
      rentTo: new Date(rData.rentTo),
      renterInfo: vUser.user._id,
    });

    if (!booked) throw new ApiError(400, "Failed booking");

    await session.commitTransaction();
    session = undefined;

    res.status(201).json(new ApiResponse(201, { bookingInfo: booked }, "Slot booked successfully"));

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
      queries._id = owner ;
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

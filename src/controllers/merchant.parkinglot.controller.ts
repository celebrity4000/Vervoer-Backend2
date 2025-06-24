import { Request, Response } from "express";
import {
  LotRentRecordModel,
  Merchant,
  ParkingLotModel,
} from "../models/merchant.model.js";
import { BookingData, ParkingData } from "../zodTypes/parkingLotData.js";
import { ApiError } from "../utils/apierror.js";
import z, { promise } from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { getAllDate } from "../utils/opt.utils.js";
import { generateParkingSpaceID, getRecordList } from "../utils/lotProcessData.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import uploadToCloudinary from "../utils/cloudinary.js";
export const registerParkingLot = asyncHandler(
  async (req: Request, res: Response) => {
    //TODO: verify merchant account
    try {
      const rData = ParkingData.parse(req.body);
      const verifiedAuth = await verifyAuthentication(req) ;
      let owner = null ;
      if(verifiedAuth?.userType !== "merchant") {
        throw new ApiError(400, "INVALID_USER") ;
      }
      owner = verifiedAuth.user ;
      if (
        !(
          rData.about &&
          rData.address &&
          rData.spacesList &&
          rData.parkingName &&
          rData.price 
        )
      ) {
        throw new ApiError(400, "DATA VALIDATION");
      }
      if (!owner) {
        throw new ApiError(400, "UNKNOWN_USER");
      }
      let imageURL: string[] = [] ;
      if(req.files){
        if(Array.isArray(req.files)){
          imageURL = await Promise.all(req.files.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url)) ;
        }
        else {
          imageURL = await Promise.all(req.files.images.map((file)=>uploadToCloudinary(file.buffer))).then(res => res.map(e=>e.secure_url))
        }
      }
      const newParkingLot = await ParkingLotModel.create({
        owner: owner?._id,
        parkingName: rData.parkingName,
        about: rData.about,
        price: rData.price,
        address: rData.address,
        spacesList: rData.spacesList,
        generalAvailable : rData.generalAvailabel ,
        images: imageURL
      });
      await newParkingLot.save();
      res.status(201).json(new ApiResponse(201, { parkingLot: newParkingLot }));
    } catch (err) {
      if (err instanceof z.ZodError) {
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

export const bookASlot = asyncHandler(
  async (req, res) => {
  //TODO: AUTHENTICATE USER
  let session: mongoose.ClientSession | undefined;
  try {
    const vUser =await  verifyAuthentication(req) ;
    console.log(vUser) ;
    if(!(vUser?.userType === "user" && vUser?.user.isVerified)){
      throw new ApiError(401,"User Must be verified user");
    }
    const rData = BookingData.parse(req.body);
    // check the lotId is available 
    const parkingLot = await ParkingLotModel.findById(rData.lotId) ;
    if(!parkingLot) throw new ApiError(400, "INVALID_LOTID") ;
    console.log(parkingLot) ;
    if(parkingLot && (parkingLot.spacesList?.get(rData.rentedSlot.zone)||0)<= rData.rentedSlot.slot) {
      throw new ApiError(400, "INVALID_SELECTED_ZONE") ;
    }
    LotRentRecordModel.createCollection()
      .then(() => LotRentRecordModel.startSession())
      .then(async (_session) => {
        session = _session;
        session.startTransaction();
        // check the slot is free or not
        const result = await LotRentRecordModel.find(
          {
            lotId: rData.lotId,
            rentedSlot: generateParkingSpaceID(rData.rentedSlot.zone, rData.rentedSlot.slot.toString()),
            $or: [
              {
                $and: [
                  // collision with starting date
                  { rentFrom: { $lte: rData.rentFrom } },
                  { rentTo: { $gte: rData.rentFrom } },
                ],
              },
              {
                $and: [
                  // collision with end date
                  { rentFrom: { $lte: rData.rentTo } },
                  { rentTo: { $gte: rData.rentTo } },
                ],
              },
              {
                $and: [
                  // collision within  date
                  { rentFrom: { $gte: rData.rentFrom } },
                  { rentTo: { $lte: rData.rentTo } },
                ],
              },
            ],
          },
          "-renterInfo"
        ).exec();
        console.log("result: ",result)
        if (result.length > 0) {
          throw new ApiError(400, "NOT_AVAILABLE", result);
        }
        const booked = await LotRentRecordModel.create(
          {
            lotId: rData.lotId,
            rentedSlot: generateParkingSpaceID(rData.rentedSlot.zone, rData.rentedSlot.slot.toString()),
            rentFrom: new Date(rData.rentFrom),
            rentTo: new Date(rData.rentTo),
            renterInfo: vUser.user._id,
          }
        );
        console.log("booked: ",booked)
        if(!booked) throw new ApiError(400,"FAILED BOOKING");
        // await (await booked.populate("renterInfo")).populate("lotId");
        session.commitTransaction() ;
        if (booked) {
          session = undefined ;
          res
            .status(201)
            .json(new ApiResponse(201, { bookingInfo: booked}));
        }
      });
  } catch (err) {
    if(session) session.abortTransaction();
    if (err instanceof z.ZodError) {
      console.log(err) ;
      throw new ApiError(400, "INVALID_QUERY");
    } else {
      throw err;
    } 
  }
});

// dry cleaner controller


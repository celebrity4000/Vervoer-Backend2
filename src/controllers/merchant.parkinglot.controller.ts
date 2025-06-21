import { Request, Response } from "express";
import {
  LotRentRecordModel,
  Merchant,
  ParkingLotModel,
} from "../models/merchant.model.js";
import { BookingData, ParkingData } from "../zodTypes/parkingLotData.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { getAllDate } from "../utils/opt.utils.js";
import { generateParkingSpaceID, getRecordList } from "../utils/lotProcessData.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
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
      const newParkingLot = await ParkingLotModel.create({
        owner: owner?._id,
        parkingName: rData.parkingName,
        about: rData.about,
        price: rData.price,
        address: rData.address,
        spacesList: rData.spacesList,
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

export const getAvailableSpace = asyncHandler(async (req, res) => {
  try {
    const startDate = z.date().parse(req.query.startDate);
    const lastDate = z.date().parse(req.query.lastDate);
    const lotID = z.string().parse(req.query.lotID);
    const lotData = await ParkingLotModel.findById(lotID);
    if (!lotData) throw new ApiError(400, "Can't Find The Lot");
    const result = await Promise.all(
      getAllDate(startDate, lastDate).map((date) => getRecordList(date, lotID))
    ).then((r) => {
      return r.map((result) => {
        return {
          date: result.date,
          bookedSlot: result.bookingRecord.map((e) => {
            e.rentedSlot;
          }),
        };
      });
    });
    res.status(200).json(new ApiResponse(200, result));
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
  //TODO: AUTHENTICATE USER
  try {
    const userID = "SomeID";
    const rData = BookingData.parse(req.body);
    let session = null;
    // check the lotId is available 
    const parkingLot = await ParkingLotModel.findById(rData.lotId) ;
    if(!parkingLot) throw new ApiError(400, "INVALID_LOTID") ;
    if(parkingLot && (parkingLot.spacesList?.get(rData.rentedSlot.zone)||0)>= rData.rentedSlot.slot) {
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
        );
        if (result) {
          throw new ApiError(400, "NOT_AVAILABLE", result);
        }
        const booked = await LotRentRecordModel.create(
          {
            lotId: rData.lotId,
            rentedSlot: generateParkingSpaceID(rData.rentedSlot.zone, rData.rentedSlot.slot.toString()),
            rentFrom: rData.rentFrom,
            rentTo: rData.rentTo,
            renterInfo: userID,
          },
          { session: session }
        );
        if(booked?.length != 1) new ApiError(400,"FAILED BOOKING");
        await (await booked[0].populate("renterInfo")).populate("lotId");
        if (booked) {
          res
            .status(201)
            .json(new ApiResponse(201, { bookingInfo: booked[0] }));
        }
      });
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

// dry cleaner controller


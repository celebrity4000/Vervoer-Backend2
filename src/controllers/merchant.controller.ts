import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { GarageBooking, IGarage } from "../models/merchant.garage.model.js";
import { IMerchant, IParking, LotRentRecordModel, Merchant } from "../models/merchant.model.js";
import { IUser } from "../models/normalUser.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
async function findCurrentGarageBookingSlot(userId:string){
    const booking = await  GarageBooking.findOne({
        customerId: userId ,
        "bookingPeriod.to" : {$gt : new Date() }
    })
    .populate<{garageId : IGarage &{owner:IMerchant}}>({
        path :'garageId', 
        select : 'garageName address contactNumber _id owner',
        populate : {
          path : "owner" ,
          model : Merchant,
          select :"firstName lastName email phoneNumber _id"
        }
      })
      .populate<{customerId : IUser}>('customerId', 'firstName lastName email phoneNumber _id').sort({
        "bookingPeriod.to" : 1
    }).lean()


    console.log(booking) ;
    if(!booking) return null ;
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

    return response ;
}
async function findCrrentLotBooking(userId: string) {
    const booking = await LotRentRecordModel.findOne({
        renterInfo : userId ,
        rentTo : {$gt : new Date()} ,
    })
      .populate<{lotId : IParking &{owner : IMerchant}}>({
              path :'lotId', 
              select : 'parkingName address contactNumber _id owner',
              populate : {
                path : "owner" ,
                model : Merchant,
                select :"firstName lastName email phoneNumber _id"
              }
            })
      .populate<{renterInfo : IUser}>('renterInfo', 'firstName lastName email phoneNumber')
      .lean();

    if (!booking) {
      return null ;
    }
    // Verify the requesting merchant owns this parking lot
    console.log(booking);
    const response = {
      _id: booking._id,
      parking: {
        _id: booking.lotId._id,
        name: booking.lotId.parkingName,
        address: booking.lotId.address,
        contactNumber: booking.lotId.contactNumber,
        ownerName : `${booking.lotId.owner.firstName} ${booking.lotId.owner.lastName}`
      },
      customer: {
        _id: booking.renterInfo._id,
        name: `${booking.renterInfo.firstName} ${booking.renterInfo.lastName || ''}`.trim(),
        email: booking.renterInfo.email,
        phone: booking.renterInfo.phoneNumber
      },
      bookingPeriod: {
        from: booking.rentFrom,
        to: booking.rentTo,
        totalHours: booking.totalHours
      },
      type : "L",
      // carLicensePlateImage: booking.carLicensePlateImage, // TODO: add carLicensePlateImage
      bookedSlot: booking.rentedSlot,
      priceRate: booking.priceRate,
      paymentDetails: {
        totalAmount: booking.totalAmount,
        amountPaid: booking.amountToPaid,
        discount: booking.discount || 0,
        platformCharge : booking.platformCharge,
        status: booking.paymentDetails.status,
        method: booking.paymentDetails.paymentMethod,
        paidAt: booking.paymentDetails.paidAt,
      },
      status: booking.paymentDetails.status,
      // createdAt: booking.createdAt,
      // updatedAt: booking.updatedAt
    };
    return response ;
}
export const getCurrentSession = asyncHandler(async (req,res)=>{
    const authUser = await verifyAuthentication(req);
    if(authUser.user && authUser.userType !== 'user'){
        throw new ApiError(400,"UNAUTHORIZED ACCESS");
    }
    const response = await findCurrentGarageBookingSlot(authUser.user._id.toString()) || await findCrrentLotBooking(authUser.user._id.toString())
    if(response){
        res.status(200).send(new ApiResponse(200,response));
    }
    else throw new ApiError(400,"NO CURRENT SESSION") ;
})

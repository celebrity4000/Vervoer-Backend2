import { Request, Response } from "express";
import { MerchantModel, ParkingLotModel } from "../DB/marchant.schema.js";

interface ParkingReqBody {
parkingName? : string ,
address?    : string ,
price? : number,
about? : string ,
availableSpace? : {[key:string]: number}
}
async function registerParkingLot(req: Request , res : Response) {
    //TODO: verify merchant account 

    const rData = req.body as ParkingReqBody
    const ownerID = req.body.user.id;

    const owner = await MerchantModel.findById(ownerID) ;
    if(!(rData.about && rData.address && rData.availableSpace && rData.parkingName && rData.price)){
        res.status(400).send("DATA NOT AVAILABLE")
    }
    if(!owner){
        res.status(400).send("USER NOT AVAILABLE")
        return ;
    }
    const newParkingLot = await ParkingLotModel.create({
        owner : owner?._id,
        parkingName: rData.parkingName ,
    })

}
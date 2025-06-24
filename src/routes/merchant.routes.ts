import { Router } from "express";
import {bookASlot, getAvailableSpace, registerParkingLot} from "../controllers/merchant.parkinglot.controller.js"
import { imageUpload } from "../middleware/upload.middleware.js";

const merchantRouter = Router() ;

merchantRouter.post("/parkinglot/registration",imageUpload.array("images",10) ,registerParkingLot);
merchantRouter.get("/parkinglot/getavailable" ,getAvailableSpace);
merchantRouter.post("/parkinglot/book", bookASlot);

export default merchantRouter ;
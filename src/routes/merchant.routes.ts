import { Router } from "express";
import {bookASlot, getAvailableSpace, registerParkingLot} from "../controllers/merchant.parkinglot.controller.js"

const merchantRouter = Router() ;

merchantRouter.post("/parkinglot/registration",registerParkingLot);
merchantRouter.get("/parkinglot/getavailable" ,getAvailableSpace);
merchantRouter.post("/parkinglot/book", bookASlot);

export default merchantRouter ;
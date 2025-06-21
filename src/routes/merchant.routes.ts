import { Router } from "express";
import {getAvailableSpace, registerParkingLot} from "../controllers/merchant.parkinglot.controller.js"

const merchantRouter = Router() ;

merchantRouter.post("/parkinglot/registration",registerParkingLot)
merchantRouter.get("/parkinglot/getavailable" ,getAvailableSpace)

export default merchantRouter ;
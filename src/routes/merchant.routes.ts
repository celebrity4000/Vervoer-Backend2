import { Router } from "express";
import {bookASlot, getAvailableSpace, registerParkingLot} from "../controllers/merchant.parkinglot.controller.js"
import { imageUpload } from "../middleware/upload.middleware.js";
import { editGarage, registerGarage } from "../controllers/merchant.garage.controller.js";
import { addResidence, deleteResidence, getResidenceById, updateResidence } from "../controllers/merchant.residence.controller.js";

const merchantRouter = Router() ;

merchantRouter.post("/parkinglot/registration",imageUpload.array("images",10) ,registerParkingLot);
merchantRouter.put("/parkinglot/update/:id",imageUpload.array("images",10) ,editGarage);
merchantRouter.get("/parkinglot/getavailable" ,getAvailableSpace);
merchantRouter.post("/parkinglot/book", bookASlot);
merchantRouter.post("/garage/registration",imageUpload.array("images", 10), registerGarage) ;
merchantRouter.put("/garage/update/:id",imageUpload.array("images", 10), editGarage) ;
merchantRouter.post("/residence/register", imageUpload.array("images",10), addResidence);
merchantRouter.put("/residence/update/:id",imageUpload.array("images",10),updateResidence);
merchantRouter.delete("/residence/update/:id",deleteResidence) ;
merchantRouter.get("/residence/:id",getResidenceById) ;

export default merchantRouter ;
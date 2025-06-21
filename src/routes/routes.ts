import { Router } from "express";
import { registerUser,verifyOtp } from "../controllers/User.js";  
import {validateRequest} from "../middleware/validateRequest.js";
import { registerUserSchema } from "../validators/userValidators.js";
import { asyncHandler } from "../utils/asynchandler.js";
import merchantRoute from  "./merchant.routes.js"
const router = Router();


router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));

router.use("/merchant", merchantRoute) ;
export default router;

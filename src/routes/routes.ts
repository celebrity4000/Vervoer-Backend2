import { Router } from "express";
import { registerUser,verifyOtp } from "../controllers/User.js";  
import {validateRequest} from "../middleware/validateRequest.js";
import { registerUserSchema } from "../validators/userValidators.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner } from "../controllers/merchant.drycleaner.controller.js";
const router = Router();


router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));
router.post("/dry-cleaner", registerDryCleaner);

export default router;

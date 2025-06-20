import { Router } from "express";
import { registerUser,verifyOtp } from "../controllers/User.js";  
import {validateRequest} from "../middleware/validateRequest.js";
import { registerUserSchema } from "../validators/userValidators.js";

const router = Router();


router.post("/register", validateRequest(registerUserSchema), registerUser);
router.post("/verify-otp", verifyOtp);


export default router;

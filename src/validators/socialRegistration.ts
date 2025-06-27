import { z } from "zod";
export const socialRegisterSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  token: z.string(),
  userType: z.enum(["user", "merchant", "driver"])
});

import { z } from "zod";

export const registerUserSchema = z.object({
  phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().nonempty("First name is required"),
  lastName: z.string().nonempty("Last name is required"),
  email: z.string().email("Invalid email"),
  country: z.string().nonempty(),
  state: z.string().nonempty(),
  zipCode: z.string().nonempty(),
  userType: z.enum(["user", "merchant", "driver"]),
});

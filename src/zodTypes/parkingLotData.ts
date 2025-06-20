import {z} from "zod/v4"

export const ParkingData = z.object({
    parkingName: z.string().optional(),
    address: z.string().optional(),
    price: z.number().optional(),
    about: z.string().optional(),
    spacesList: z.record(z.string().regex(/^[A-Z]+$/),z.number()).optional()
});

export const BookingData = z.object({
    rentFrom : z.iso.date() ,
    rentTo : z.iso.date() ,
    lotId: z.string(),
    rentedSlot: z.string().regex(/^[A-Z]{0,3} \d{3}$/).describe("SLOT must be a string 3 maximum capital letter and a space and exactly 3 digit example `A 001` or `AAA 001` not `AAAA 001`   ")

})
export type BookingData = z.infer<typeof BookingData> 
export type ParkingData = z.infer<typeof ParkingData>
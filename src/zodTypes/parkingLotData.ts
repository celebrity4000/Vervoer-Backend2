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
    rentedSlot: z.object({zone : z.string().regex(/[A-Z]{1,3}/) ,slot : z.number().lt(1000).positive() }) 

})
export type BookingData = z.infer<typeof BookingData> 
export type ParkingData = z.infer<typeof ParkingData>
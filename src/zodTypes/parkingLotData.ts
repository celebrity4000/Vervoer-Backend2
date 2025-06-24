import { createContext } from "vm";
import {z} from "zod/v4"

export const ParkingData = z.object({
    parkingName: z.string().optional(),
    address: z.string().optional(),
    price: z.number().optional(),
    about: z.string().optional(),
    spacesList: z.record(z.string().regex(/^[A-Z]{1,3}$/),z.number()).optional(),
    generalAvailabel: z.array(z.object({
        day : z.enum(["SUN", "MON", "THU", "WED", "THR", "FRI", "SAT"]),
        closingTime : z.iso.time(),
        openingTime : z.iso.time(),
    })).nonempty().check((zo)=>{
       let counter = new Set<string>() ;
       zo.value.forEach((e)=>{
            if(counter.has(e.day)){
                zo.issues.push({
                    code: "custom",
                    message : "Dublicate Key",
                    input : e ,
                });
            }
            else counter.add(e.day) ;
       })
    }).optional(),
    is24x7 : z.boolean().default(false) ,
});

export const BookingData = z.object({
    rentFrom : z.iso.date() ,
    rentTo : z.iso.date() ,
    lotId: z.string(),
    rentedSlot: z.object({zone : z.string().regex(/[A-Z]{1,3}/) ,slot : z.number().lt(1000).positive() }) 

})
export type BookingData = z.infer<typeof BookingData> 
export type ParkingData = z.infer<typeof ParkingData>
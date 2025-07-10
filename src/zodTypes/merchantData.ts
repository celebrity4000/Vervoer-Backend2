import {z} from "zod/v4"
const gpsLocationSchema = z.object({
    type: z.literal("Point").default("Point"),
    coordinates: z.tuple([z.coerce.number().lte(180).gte(-180), z.coerce.number().lte(90).gte(-90)],"Bad Values for Geo location")
  });
  
const availableDaySchema = z.object({
    day: z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]),
    openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
  });

export const ParkingData = z.object({
    parkingName: z.string(),
    address: z.string(),
    price: z.coerce.number(),
    about: z.string(),
    images : z.array(z.url()).optional(),
    contactNumber : z.string().nonempty(),
    gpsLocation: gpsLocationSchema,
    spacesList: z.record(z.string().regex(/^[A-Z]{1,3}$/),z.coerce.number()).optional(),
    generalAvailable: z.array(availableDaySchema).nonempty().check((zo)=>{
       const counter = new Set<string>() ;
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
    is24x7 : z.coerce.boolean().default(false) ,
});

export const BookingData = z.object({
    bookingId : z.string() ,
    carLicensePlateImage: z.string().min(1, "Car license plate image string is required"),

})
export type BookingData = z.infer<typeof BookingData> 
export type ParkingData = z.infer<typeof ParkingData>

export const residenceSchema = z.object({
  contactNumber: z.string().min(10).max(15),
  email: z.email().optional(),
  images : z.array(z.url()).optional() ,
  residenceName: z.string().min(3).max(100),
  address: z.string().min(10),
  gpsLocation: gpsLocationSchema,
  price: z.coerce.number().positive(),
  about: z.string().min(20),
  generalAvailable: z.array(availableDaySchema).check((zo)=>{
    const counter = new Set<string>() ;
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
});

// Schema for updating residence (all fields optional)
export const updateResidenceSchema = residenceSchema.partial();

// Type exports
export type ResidenceData = z.infer<typeof residenceSchema>;
export type UpdateResidenceData = z.infer<typeof updateResidenceSchema>;

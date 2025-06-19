import express , {Application} from "express";
import dotenv from "dotenv";
import { connectDB } from "./DB/db.js";

dotenv.config({
    path : ".env"
});

const app: Application = express();
const PORT: number = parseInt(process.env.PORT || "5000") ;

app.get("/",(req,res)=>{
    res.send("Welcome To Vervour").status(200);
})

function StartServer(){
    try {
        connectDB().then(()=>{
            app.listen(PORT, ()=>{
                console.log("Started Server at ", PORT) ;
            })
        })
    } catch (error) {
        console.log("Couldn't Start the Server");
        console.log("Reason: ",error) ;
    }
}
StartServer() ;

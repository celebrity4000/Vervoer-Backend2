import express , {Application} from "express";
import dotenv from "dotenv";

dotenv.config({
    path : ".env"
});

const app: Application = express();
const PORT: number = parseInt(process.env.PORT || "5000") ;

app.get("/",(req,res)=>{
    res.send("Welcome To Vervour").status(200);
})

app.listen(PORT, ()=>{
    console.log("Server Started at ", PORT);
})

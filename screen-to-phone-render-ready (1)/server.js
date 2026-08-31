import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({server});
const rooms = new Map();

function send(ws, msg){ if(ws.readyState===1) ws.send(JSON.stringify(msg)); }

wss.on("connection", ws=>{
  let roomId=null;
  ws.on("message", raw=>{
    let msg; try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==="join"){
      roomId=String(msg.room||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
      if(!roomId) return;
      if(!rooms.has(roomId)) rooms.set(roomId,new Set());
      const room=rooms.get(roomId);
      room.add(ws);
      // Tell the new peer whether another peer already exists.
      send(ws,{type:"joined", peers:room.size-1});
      for(const peer of room){ if(peer!==ws) send(peer,{type:"peer-joined"}); }
      return;
    }
    if(roomId && rooms.has(roomId)){
      for(const peer of rooms.get(roomId)){
        if(peer!==ws) send(peer,msg);
      }
    }
  });
  ws.on("close",()=>{
    if(roomId && rooms.has(roomId)){
      const room=rooms.get(roomId); room.delete(ws);
      for(const peer of room) send(peer,{type:"peer-left"});
      if(room.size===0) rooms.delete(roomId);
    }
  });
});

app.get("/health",(req,res)=>res.json({ok:true}));
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Screen-to-phone running on :${PORT}`));

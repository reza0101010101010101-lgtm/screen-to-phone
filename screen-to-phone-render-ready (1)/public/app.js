const $=id=>document.getElementById(id);
const qs=new URLSearchParams(location.search);
const roomParam=(qs.get("room")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
const wsProto=location.protocol==="https:"?"wss":"ws";
let ws, pc, stream;

function code(){return Math.random().toString(36).slice(2,8).toUpperCase();}
function connect(room, role){
  ws=new WebSocket(`${wsProto}://${location.host}`);
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",room,role}));
  ws.onmessage=async e=>{
    const m=JSON.parse(e.data);
    if(m.type==="joined"){
      if(role==="host") $("status").textContent=m.peers?"Phone connected.":"Waiting for phone…";
      else $("vstatus").textContent=m.peers?"Connected.":"Waiting for PC…";
      return;
    }
    if(m.type==="peer-joined" && role==="host"){ if(stream) await makeOffer(); return; }
    if(m.type==="offer" && role==="viewer"){
      await ensurePC();
      await pc.setRemoteDescription(m.offer);
      const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({type:"answer",answer}));
      return;
    }
    if(m.type==="answer" && role==="host"){
      await pc.setRemoteDescription(m.answer); return;
    }
    if(m.type==="ice" && pc){
      try{await pc.addIceCandidate(m.candidate)}catch{}
    }
    if(m.type==="peer-left" && role==="viewer") $("vstatus").textContent="PC disconnected.";
  };
  ws.onclose=()=>{ if(role==="host") $("status").textContent="Signaling disconnected."; };
}

function rtcConfig(){
  return {iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun.cloudflare.com:3478"}
  ]};
}
async function ensurePC(){
  if(pc) return;
  pc=new RTCPeerConnection(rtcConfig());
  pc.onicecandidate=e=>{if(e.candidate) ws.send(JSON.stringify({type:"ice",candidate:e.candidate}))};
  pc.onconnectionstatechange=()=>{
    const s=pc.connectionState;
    if($("status")&&!$("host").hidden) $("status").textContent=`Connection: ${s}`;
    if($("vstatus")&&!$("viewer").hidden) $("vstatus").textContent=`Connection: ${s}`;
  };
  pc.ontrack=e=>{
    const v=$("video");
    if(v.srcObject!==e.streams[0]) v.srcObject=e.streams[0];
  };
}
async function makeOffer(){
  await ensurePC();
  for(const t of stream.getTracks()) pc.addTrack(t,stream);
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({type:"offer",offer}));
}
async function start(){
  const room=($("room").value||code()).toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);
  $("room").value=room;
  const shareUrl=`${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  $("link").innerHTML=`Phone link: <a href="${shareUrl}">${shareUrl}</a>`;
  connect(room,"host");
  try{
    stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    $("status").textContent="Screen selected. If prompted, enable “Share system audio”.";
    stream.getVideoTracks()[0].onended=()=>{if(ws)ws.close()};
    // If a phone joined before the share permission completed, wait briefly and offer.
    setTimeout(async()=>{if(ws&&ws.readyState===1) await makeOffer()},500);
  }catch(err){$("status").textContent="Sharing cancelled or blocked: "+err.message;}
}
$("new").onclick=()=>{$("room").value=code()};
$("share").onclick=start;

if(roomParam){
  $("host").hidden=true; $("viewer").hidden=false; $("roomText").textContent=roomParam;
  connect(roomParam,"viewer");
  $("sound").onclick=async()=>{const v=$("video"); try{await v.play(); v.muted=false; $("sound").textContent="Sound enabled";}catch{}};
}else{
  $("room").value=code();
}

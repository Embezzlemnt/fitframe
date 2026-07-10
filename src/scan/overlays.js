import { CONSTELLATION_INDICES } from "./constants.js";

const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

export function drawEyeOval(ctx,pts,indices){
  const ring=indices.map(i=>pts[i]);
  if (ring.some(p=>!p)) return;
  ctx.beginPath();
  const start=mid(ring[ring.length-1],ring[0]);
  ctx.moveTo(start.x,start.y);
  for (let i=0;i<ring.length;i++){
    const m=mid(ring[i],ring[(i+1)%ring.length]);
    ctx.quadraticCurveTo(ring[i].x,ring[i].y,m.x,m.y);
  }
  ctx.closePath();
  ctx.strokeStyle="rgba(242,240,232,.45)";
  ctx.lineWidth=1;
  ctx.stroke();
}

// Small white measurement anchors on the face — the only dots anywhere on screen.
// Subtle by design: they read as the instrument sampling, not decoration.
export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion){
  if (alpha<=0.01) return;
  ctx.save();
  ctx.fillStyle="#f2f0e8";
  for (let k=0;k<CONSTELLATION_INDICES.length;k++){
    const p=pts[CONSTELLATION_INDICES[k]];
    if (!p) continue;
    const breathe=reduceMotion?1:.5+.5*Math.sin(tMs/1400+k*1.1);
    ctx.globalAlpha=alpha*(.22+.3*breathe);
    ctx.beginPath();
    ctx.arc(p.x,p.y,1.1,0,Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

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
  ctx.strokeStyle="rgba(76,175,125,.85)";
  ctx.lineWidth=1.5;
  ctx.shadowColor="rgba(76,175,125,.5)";
  ctx.shadowBlur=6;
  ctx.stroke();
  ctx.shadowBlur=0;
}

export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion){
  if (alpha<=0.01) return;
  ctx.save();
  ctx.fillStyle="#73d7a0";
  for (let k=0;k<CONSTELLATION_INDICES.length;k++){
    const p=pts[CONSTELLATION_INDICES[k]];
    if (!p) continue;
    const shimmer=reduceMotion?1:.55+.45*Math.sin(tMs/900+k*1.7);
    ctx.globalAlpha=alpha*(.14+.14*shimmer);
    ctx.fillRect(p.x-.6,p.y-.6,1.2,1.2);
  }
  ctx.restore();
}

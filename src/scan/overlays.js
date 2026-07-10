import { CONSTELLATION_INDICES, CONSTELLATION_EDGES } from "./constants.js";

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

// The measurement map draws like a blueprint of the face, in anatomical order:
// the jaw outline traces around first, then brows, nose bridge, lip ring, and
// finally the coverage points densify. Progress (clean samples, 0→1) drives the
// trace, so moving or blinking visibly pauses it. Rendering is batched — all
// settled dots are one fill and all settled traces one stroke — so the whole
// overlay costs a handful of draw calls per frame.
const N=CONSTELLATION_INDICES.length;
const revealAt=new Map();
CONSTELLATION_INDICES.forEach((idx,k)=>{ if(!revealAt.has(idx)) revealAt.set(idx,k/N); });

export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion,progress=1){
  if (alpha<=0.01) return;
  ctx.save();

  // traces connect each anchor to the previous one as the pen reaches it
  ctx.strokeStyle="#f2f0e8";
  ctx.lineWidth=.75;
  ctx.beginPath();
  let fadingEdges=null;
  for (let e=0;e<CONSTELLATION_EDGES.length;e++){
    const [a,b]=CONSTELLATION_EDGES[e];
    const pa=pts[a],pb=pts[b];
    if (!pa||!pb) continue;
    const need=Math.max(revealAt.get(a)??0,revealAt.get(b)??0)+.01;
    const fadeIn=(progress-need)/.03;
    if (fadeIn<=0) continue;
    if (fadeIn>=1){ ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); }
    else (fadingEdges??=[]).push([pa,pb,fadeIn]);
  }
  ctx.globalAlpha=alpha*.16;
  ctx.stroke();
  if (fadingEdges) for (const [pa,pb,f] of fadingEdges){
    ctx.globalAlpha=alpha*.16*f;
    ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
  }

  // anchors: settled ones in a single fill, the few mid-arrival ones pop in
  ctx.fillStyle="#f2f0e8";
  ctx.beginPath();
  let fadingDots=null;
  for (let k=0;k<N;k++){
    const p=pts[CONSTELLATION_INDICES[k]];
    if (!p) continue;
    const fadeIn=(progress-k/N)/.02;
    if (fadeIn<=0) continue;
    if (fadeIn>=1){ ctx.moveTo(p.x+1.5,p.y); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); }
    else (fadingDots??=[]).push([p,fadeIn]);
  }
  ctx.globalAlpha=alpha*.55;
  ctx.fill();
  if (fadingDots) for (const [p,f] of fadingDots){
    ctx.globalAlpha=alpha*.55*f;
    ctx.beginPath(); ctx.arc(p.x,p.y,1.5+1*(1-f),0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

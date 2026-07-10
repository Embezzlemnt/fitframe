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

// Progressive measurement map: anchors accumulate scattered across the face as
// clean samples land (progress 0→1), then hairline traces connect them in the
// back half of the scan. The map completing IS the scan completing — blinking
// or moving pauses the build, so the "real scan" feel stays honest.
const N=CONSTELLATION_INDICES.length;
// Deterministic scatter: stride-permuted reveal order so density builds evenly
// across the whole face instead of region by region. 37 is coprime with N.
const revealAt=new Map();
{
  let slot=0;
  for (let k=0;k<N;k++){
    const idx=CONSTELLATION_INDICES[(k*37)%N];
    if (!revealAt.has(idx)) revealAt.set(idx,slot++/N);
  }
}
const EDGE_START=0.35; // traces begin once a third of the map exists

export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion,progress=1){
  if (alpha<=0.01) return;
  ctx.save();

  if (progress>EDGE_START){
    ctx.strokeStyle="#f2f0e8";
    ctx.lineWidth=.75;
    const edgeSpan=1-EDGE_START;
    for (let e=0;e<CONSTELLATION_EDGES.length;e++){
      const [a,b]=CONSTELLATION_EDGES[e];
      const pa=pts[a],pb=pts[b];
      if (!pa||!pb) continue;
      // an edge earns its place once both endpoints exist, staggered through
      // the back half of the scan in edge-list order
      const edgeAt=EDGE_START+edgeSpan*(e/CONSTELLATION_EDGES.length)*.9;
      const need=Math.max(revealAt.get(a)??0,revealAt.get(b)??0,edgeAt);
      const fadeIn=Math.min(1,Math.max(0,(progress-need)/.04));
      if (fadeIn<=0) continue;
      ctx.globalAlpha=alpha*.14*fadeIn;
      ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
    }
  }

  ctx.fillStyle="#f2f0e8";
  for (let k=0;k<N;k++){
    const idx=CONSTELLATION_INDICES[k];
    const p=pts[idx];
    if (!p) continue;
    const fadeIn=Math.min(1,Math.max(0,(progress-(revealAt.get(idx)??0))/.03));
    if (fadeIn<=0) continue;
    const breathe=reduceMotion?1:.5+.5*Math.sin(tMs/1400+k*1.1);
    ctx.globalAlpha=alpha*fadeIn*(.28+.3*breathe);
    ctx.beginPath();
    // new anchors land slightly oversized and settle as they fade in
    ctx.arc(p.x,p.y,1.5+1.1*(1-fadeIn),0,Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

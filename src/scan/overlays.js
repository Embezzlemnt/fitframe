import { CONTOUR_CHAINS, REGISTRATION_INDICES } from "./constants.js";

const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

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

// ─── The measurement blueprint ────────────────────────────────────────────────
// Smooth hairline contours trace the face in anatomical order — jaw ring from
// the chin, brows, nose, lips — drawn by a plotter-style pen whose position is
// driven by scan progress (clean samples, 0→1). Twelve registration marks
// (fine core + a ring that focuses in) land at the true measurement sites as
// the pen reaches them. No fill dots, no mesh, no twinkle. Batched rendering:
// one stroke per contour, two batched passes for settled marks.
const CHAINS=CONTOUR_CHAINS.map(c=>({...c,segs:c.loop?c.idx.length:c.idx.length-1}));
const TOTAL_SEGS=CHAINS.reduce((s,c)=>s+c.segs,0);
const TRACE_END=.85; // contours finish at 85% progress; marks settle by ~93%
const SPANS=(()=>{let acc=0;return CHAINS.map(c=>{const s=acc/TOTAL_SEGS*TRACE_END;acc+=c.segs;return {start:s,end:acc/TOTAL_SEGS*TRACE_END};});})();
const MARKS=REGISTRATION_INDICES.map((idx,i)=>({idx,appearAt:.08+.8*(i/Math.max(1,REGISTRATION_INDICES.length-1))}));

function strokeSmooth(ctx,ring,closed){
  if (ring.length<2) return;
  ctx.beginPath();
  if (closed){
    const start=mid(ring[ring.length-1],ring[0]);
    ctx.moveTo(start.x,start.y);
    for (let i=0;i<ring.length;i++){
      const m=mid(ring[i],ring[(i+1)%ring.length]);
      ctx.quadraticCurveTo(ring[i].x,ring[i].y,m.x,m.y);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(ring[0].x,ring[0].y);
    for (let i=1;i<ring.length-1;i++){
      const m=mid(ring[i],ring[i+1]);
      ctx.quadraticCurveTo(ring[i].x,ring[i].y,m.x,m.y);
    }
    const last=ring[ring.length-1];
    ctx.lineTo(last.x,last.y);
  }
  ctx.stroke();
}

export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion,progress=1){
  if (alpha<=0.01) return;
  ctx.save();
  ctx.strokeStyle="#f2f0e8";
  ctx.lineWidth=1;

  // contours, pen-drawn
  let pen=null;
  for (let c=0;c<CHAINS.length;c++){
    const {idx,loop,segs}=CHAINS[c],{start,end}=SPANS[c];
    if (progress<=start) continue;
    const p=Math.min(1,(progress-start)/(end-start));
    const chainPts=idx.map(i=>pts[i]);
    if (chainPts.some(q=>!q)) continue;
    ctx.globalAlpha=alpha*.34;
    if (p>=1){
      strokeSmooth(ctx,chainPts,loop);
      continue;
    }
    const v=p*segs, m=Math.floor(v), frac=v-m;
    const partial=chainPts.slice(0,m+1);
    if (frac>0&&m<segs){
      const tip=lerp(chainPts[m],chainPts[(m+1)%chainPts.length],frac);
      partial.push(tip);
      pen=tip;
    }
    strokeSmooth(ctx,partial,false);
  }
  if (pen&&!reduceMotion){
    ctx.globalAlpha=alpha*.9;
    ctx.fillStyle="#f2f0e8";
    ctx.beginPath(); ctx.arc(pen.x,pen.y,1.6,0,Math.PI*2); ctx.fill();
  }

  // registration marks: settled cores + rings in two batched passes,
  // the few mid-focus ones animate individually (ring contracts as it lands)
  ctx.fillStyle="#f2f0e8";
  ctx.lineWidth=.75;
  let focusing=null;
  ctx.beginPath();
  for (const mk of MARKS){
    const q=pts[mk.idx];
    if (!q) continue;
    const f=(progress-mk.appearAt)/.05;
    if (f<=0) continue;
    if (f>=1){ ctx.moveTo(q.x+1.3,q.y); ctx.arc(q.x,q.y,1.3,0,Math.PI*2); }
    else (focusing??=[]).push([q,f]);
  }
  ctx.globalAlpha=alpha*.85;
  ctx.fill();
  ctx.beginPath();
  for (const mk of MARKS){
    const q=pts[mk.idx];
    if (!q) continue;
    if ((progress-mk.appearAt)/.05>=1){ ctx.moveTo(q.x+3.2,q.y); ctx.arc(q.x,q.y,3.2,0,Math.PI*2); }
  }
  ctx.globalAlpha=alpha*.28;
  ctx.stroke();
  if (focusing) for (const [q,f] of focusing){
    ctx.globalAlpha=alpha*.85*f;
    ctx.beginPath(); ctx.arc(q.x,q.y,1.3,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=alpha*.28*f;
    ctx.beginPath(); ctx.arc(q.x,q.y,3.2+(reduceMotion?0:5*(1-f)),0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}

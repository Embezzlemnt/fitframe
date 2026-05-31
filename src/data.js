export const FRAMES = [
  { id:"thin-round",  label:"Thin Round",     desc:"Wire. Circular. Timeless.",      tags:["minimal","soft","retro","classic","clean"] },
  { id:"bold-square", label:"Bold Square",    desc:"Thick. Structured. Presence.",   tags:["bold","statement","modern","confident"] },
  { id:"cat-eye",     label:"Cat Eye",        desc:"Upswept. Distinct. Playful.",    tags:["vintage","expressive","retro","statement"] },
  { id:"navigator",   label:"Navigator",      desc:"Teardrop. Works on most faces.", tags:["classic","clean","modern","adjustable"] },
  { id:"rectangle",   label:"Slim Rectangle", desc:"Low profile. Understated.",      tags:["minimal","sleek","modern","clean","slim"] },
  { id:"round-thick", label:"Round Thick",    desc:"Wide. Retro. Confident.",        tags:["bold","retro","statement","vintage"] },
  { id:"sporty-wrap", label:"Sporty Wrap",    desc:"Curved. Active. Polished.",      tags:["sporty","practical","adjustable","bold"] },
  { id:"geometric",   label:"Geometric",      desc:"Angular. Unconventional.",       tags:["editorial","modern","statement","bold"] },
];

export const STYLE_QUESTIONS = [
  { id:"fit",      q:"how do glasses usually feel on you?", options:[
    { label:"too tight at my temples",           tags:["slim","minimal","soft"] },
    { label:"they slide down constantly",        tags:["adjustable","sporty","practical"] },
    { label:"i've never found a pair that fits", tags:["adjustable","bold","sporty"] },
    { label:"fine mostly, just never perfect",   tags:["classic","clean","modern"] },
  ]},
  { id:"vibe",     q:"what's your visual instinct?", options:[
    { label:"quiet. clean lines, nothing extra",    tags:["minimal","clean","soft"] },
    { label:"present. something people notice",     tags:["bold","statement","confident"] },
    { label:"timeless. classic shapes, no trends",  tags:["retro","classic","vintage"] },
    { label:"relaxed. comfortable over everything", tags:["sporty","practical","soft"] },
  ]},
  { id:"use",      q:"where will you wear them most?", options:[
    { label:"at a desk, most of the day",        tags:["minimal","sleek","clean"] },
    { label:"out and about, always on",          tags:["sporty","practical","bold"] },
    { label:"both — they need to do everything", tags:["clean","modern","classic"] },
    { label:"special occasions only",            tags:["bold","expressive","statement"] },
  ]},
  { id:"priority", q:"what matters most in a frame?", options:[
    { label:"it disappears on my face",       tags:["minimal","soft","clean"] },
    { label:"it says something about me",     tags:["bold","statement","editorial"] },
    { label:"it holds up to daily use",       tags:["sporty","practical","modern"] },
    { label:"it fits without any adjustment", tags:["classic","adjustable","clean"] },
  ]},
];

export const DEFAULT_LENS = [
  { id:"bluelight",    label:"Blue Light",   price:0,  desc:"Filters screen glare. Everyday clarity.", spec:"Blocks 40% of high-energy blue light (415-455nm). Clear tint." },
  { id:"sunglass",     label:"Sunglass",     price:25, desc:"UV400 tint. Built for outside." },
  { id:"transition",   label:"Transitions",  price:45, desc:"Adapts to light. One pair, everywhere." },
  { id:"prescription", label:"Prescription", price:65, desc:"Your exact Rx. Requires prescription details." },
];

export const COLORWAYS = [
  { id:"matte-black", label:"Matte Black", desc:"A precise, understated black that works with every frame shape.", fill:"var(--colorway-matte-black)", recommended:true },
  { id:"tortoise", label:"Tortoise", desc:"Warm amber and brown depth, simulated in layered PA12 finish.", fill:"tortoise" },
  { id:"natural-pa12", label:"Natural PA12", desc:"Warm off-white nylon with a softer studio-object feel.", fill:"var(--colorway-natural-pa12)" },
];

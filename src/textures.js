// Procedural planet textures, generated once on the GPU into equirectangular render targets.
// All patterns are sampled from 3D noise on the unit sphere, so there are no seams or pole pinching.
import * as THREE from 'three';

export const TEX = {
  mercury: 0, venus: 1, earth: 2, moon: 3, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8,
  io: 9, europa: 10, ganymede: 11, callisto: 12, titan: 13, icy: 14, grayrock: 15, triton: 16, darkrock: 17,
};
const GAS = new Set(['venus', 'jupiter', 'saturn', 'uranus', 'neptune', 'titan']);

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 nrm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nrm.x;p1*=nrm.y;p2*=nrm.z;p3*=nrm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int oct){
  float a=0.5,s=0.0,n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*snoise(p); n+=a; p=p*2.03+vec3(17.1,3.7,-9.2); a*=0.5; }
  return s/n;
}
float ridged(vec3 p,int oct){
  float a=0.5,s=0.0,n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*(1.0-abs(snoise(p))); n+=a; p=p*2.03+vec3(17.1,3.7,-9.2); a*=0.5; }
  return s/n;
}
`;

const BAKE_FRAG = /* glsl */ `
uniform int uType; uniform int uMode; uniform float uSeed; uniform vec3 uTint;
varying vec2 vUv;
${NOISE_GLSL}
vec3 hash3(vec3 p){
  p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453);
}
// one layer of impact craters: bowl + raised rim. ~[-0.55, 0.3]
float craterLayer(vec3 p){
  vec3 ip=floor(p), fp=fract(p); float h=0.0;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){
    vec3 o=vec3(float(x),float(y),float(z));
    vec3 r=hash3(ip+o+uSeed);
    vec3 r2=fract(r.yzx*43.17+r.zxy*17.31);
    if(r2.x>0.6) continue;
    vec3 c=o+0.2+0.6*r;
    float rad=0.1+0.35*r2.y*r2.y;
    float d=length(fp-c)/rad;
    if(d<1.7){
      float bowl=d<1.0?(d*d-1.0)*0.55:0.0;
      float rim=0.3*exp(-pow((d-1.0)*5.0,2.0));
      h+=bowl+rim;
    }
  }
  return h;
}
float craters(vec3 p,float f0,int layers){
  float h=0.0,a=1.0,f=f0;
  for(int i=0;i<6;i++){ if(i>=layers)break; h+=a*craterLayer(p*f+float(i)*13.7); f*=2.3; a*=0.6; }
  return h;
}
vec3 ramp4(float v,vec3 c0,vec3 c1,vec3 c2,vec3 c3){
  vec3 c=mix(c0,c1,smoothstep(0.18,0.42,v));
  c=mix(c,c2,smoothstep(0.42,0.62,v));
  return mix(c,c3,smoothstep(0.62,0.9,v));
}
// zonal band coordinate for gas giants: latitude warped by turbulence
float bandT(vec3 p,float turb){
  float w=fbm(vec3(p.x*2.0,p.y*5.0,p.z*2.0)+uSeed,5);
  float w2=fbm(vec3(p.x*7.0,p.y*22.0,p.z*7.0)+uSeed+9.0,5);
  return p.y+turb*(0.06*w+0.018*w2);
}
float bandV(float t,float freq){
  float v=0.55*snoise(vec3(0.3,t*freq,uSeed))+0.3*snoise(vec3(1.7,t*freq*2.6,uSeed+3.0))+0.15*snoise(vec3(4.1,t*freq*6.5,uSeed+8.0));
  return 0.5+0.5*v;
}
// elliptical storm at (lat, lon) in radians
float spot(vec3 p,float lat0,float lon0,float w,float hgt){
  float lat=asin(clamp(p.y,-1.0,1.0)), lon=atan(p.z,p.x);
  float dl=lon-lon0; dl=atan(sin(dl),cos(dl));
  vec2 d=vec2(dl*cos(lat0)/w,(lat-lat0)/hgt);
  return 1.0-smoothstep(0.55,1.0,length(d));
}

void surface(vec3 p,out vec3 col,out float h,out float rough){
  rough=1.0; h=0.5;
  float lat=abs(p.y);
  if(uType==0){ // Mercury
    float cr=craters(p,2.5,5);
    float n=fbm(p*2.2+uSeed,6), d=fbm(p*9.0+uSeed,4);
    col=mix(vec3(0.34,0.31,0.29),vec3(0.58,0.55,0.52),0.5+0.9*n);
    col*=1.0+0.3*cr+0.12*d;
    col+=vec3(0.25)*smoothstep(0.35,0.6,cr);
    h=0.5+0.28*cr+0.12*n+0.03*d;
  } else if(uType==1){ // Venus (cloud tops)
    float w=fbm(vec3(p.x*2.0,p.y*4.0,p.z*2.0)+uSeed,5);
    float t=p.y+0.22*w-0.25*abs(p.x)*sign(p.y)*0.0;
    float b=fbm(vec3(p.x*1.4,t*7.0,p.z*1.4)+uSeed+4.0,6);
    float f=fbm(vec3(p.x*6.0,t*24.0,p.z*6.0)+uSeed,4);
    col=mix(vec3(0.78,0.62,0.36),vec3(0.97,0.90,0.70),clamp(0.5+1.1*b+0.25*f,0.0,1.0));
    col=mix(col,vec3(0.86,0.80,0.66),smoothstep(0.7,1.0,lat)*0.6);
  } else if(uType==2){ // Earth
    float n=fbm(p*1.45+uSeed,8);
    float m=fbm(p*3.0+uSeed+31.0,5);
    float d=fbm(p*14.0+uSeed+7.0,5);
    float sea=0.07;
    float elev=n-sea;
    if(elev<0.0){
      float depth=clamp(-elev/0.28,0.0,1.0);
      col=mix(vec3(0.06,0.33,0.50),vec3(0.012,0.055,0.20),sqrt(depth));
      col*=0.95+0.1*d;
      rough=0.38; h=0.2;
    } else {
      vec3 veg=mix(vec3(0.24,0.42,0.15),vec3(0.07,0.24,0.08),smoothstep(-0.25,0.3,m));
      float arid=exp(-pow((lat-0.38)/0.17,2.0))*smoothstep(0.2,-0.2,m);
      col=mix(veg,vec3(0.78,0.66,0.45),clamp(arid*1.6,0.0,1.0));
      col=mix(col,vec3(0.47,0.44,0.34),smoothstep(0.68,0.82,lat));
      col=mix(col,vec3(0.40,0.34,0.29),smoothstep(0.10,0.26,elev+0.05*d));
      col=mix(col,vec3(0.95,0.96,0.98),smoothstep(0.80,0.88,lat+elev*0.9+0.05*d));
      col*=0.9+0.25*d;
      col=mix(vec3(0.75,0.72,0.55),col,smoothstep(0.0,0.012,elev)); // beaches
      rough=0.95; h=0.22+elev*1.6+0.05*d;
    }
    float ice=smoothstep(0.90,0.935,lat+0.07*d+0.06*m);
    col=mix(col,vec3(0.93,0.95,0.98),ice); rough=mix(rough,0.75,ice); h=mix(h,0.3+0.03*d,ice);
  } else if(uType==3){ // Moon
    float mar=smoothstep(0.10,0.30,fbm(p*1.25+uSeed,6)+0.2*p.x-0.03+0.06*fbm(p*6.0+uSeed,3));
    float cr=craters(p,2.5,5)*mix(1.0,0.3,mar);
    float d=fbm(p*10.0+uSeed,4);
    col=mix(vec3(0.63,0.62,0.60),vec3(0.33,0.33,0.35),mar);
    col*=1.0+0.28*cr+0.1*d;
    col+=vec3(0.22)*smoothstep(0.3,0.6,cr);
    h=0.5+0.28*cr-0.06*mar+0.03*d;
  } else if(uType==4){ // Mars
    float n=fbm(p*1.7+uSeed,7), n2=fbm(p*6.0+uSeed+5.0,5);
    float cr=craters(p,4.0,4);
    col=mix(vec3(0.78,0.43,0.22),vec3(0.38,0.20,0.12),smoothstep(-0.02,0.3,n+0.18*n2));
    col=mix(col,vec3(0.88,0.62,0.40),smoothstep(0.12,0.45,-n)*0.55);
    float canyon=pow(1.0-abs(snoise(p*vec3(2.5,7.0,2.5)+uSeed)),10.0)*smoothstep(0.35,0.0,lat);
    col=mix(col,vec3(0.3,0.15,0.1),canyon*0.6);
    col*=1.0+0.2*cr+0.1*n2;
    float cap=smoothstep(0.87,0.92,lat+0.05*n2);
    col=mix(col,vec3(0.96,0.94,0.92),cap);
    h=0.5+0.3*n+0.16*cr-0.2*canyon+0.03*n2;
  } else if(uType==5){ // Jupiter
    float t=bandT(p,1.0);
    float v=bandV(t,8.0);
    col=ramp4(v,vec3(0.50,0.30,0.18),vec3(0.76,0.57,0.40),vec3(0.90,0.83,0.70),vec3(0.96,0.94,0.89));
    float fine=fbm(vec3(p.x*9.0,t*42.0,p.z*9.0)+uSeed,4);
    col*=1.0+0.14*fine;
    float grs=spot(p,-0.38,1.2,0.22,0.11);
    float swirl=0.5+0.5*snoise(vec3(p.x*14.0,p.y*30.0,p.z*14.0)+uSeed);
    col=mix(col,mix(vec3(0.74,0.30,0.16),vec3(0.86,0.50,0.30),swirl*0.6),grs*0.92);
    col=mix(col,vec3(0.96,0.93,0.86),spot(p,-0.58,3.4,0.07,0.04)*0.8);
    col=mix(col,vec3(0.42,0.40,0.42),smoothstep(0.78,1.0,lat)*0.7);
  } else if(uType==6){ // Saturn
    float t=bandT(p,0.45);
    float v=bandV(t,6.5);
    col=ramp4(v,vec3(0.70,0.58,0.40),vec3(0.83,0.72,0.52),vec3(0.91,0.83,0.64),vec3(0.96,0.91,0.76));
    col*=1.0+0.05*fbm(vec3(p.x*8.0,t*40.0,p.z*8.0)+uSeed,4);
    col=mix(col,vec3(0.55,0.60,0.62),smoothstep(0.82,1.0,lat)*0.6);
  } else if(uType==7){ // Uranus
    float t=bandT(p,0.3);
    float v=bandV(t,4.0);
    col=mix(vec3(0.56,0.82,0.86),vec3(0.70,0.90,0.92),v);
    col=mix(col,vec3(0.80,0.93,0.93),smoothstep(0.55,0.95,p.y)*0.5);
  } else if(uType==8){ // Neptune
    float t=bandT(p,0.7);
    float v=bandV(t,5.0);
    col=ramp4(v,vec3(0.10,0.20,0.58),vec3(0.16,0.31,0.74),vec3(0.24,0.42,0.84),vec3(0.36,0.55,0.90));
    col=mix(col,vec3(0.05,0.09,0.30),spot(p,-0.36,2.0,0.2,0.1)*0.85);
    float streak=smoothstep(0.87,0.96,ridged(vec3(p.x*2.5,t*18.0,p.z*2.5)+uSeed,3));
    col=mix(col,vec3(0.92,0.95,1.0),streak*0.45);
  } else if(uType==9){ // Io
    float n=fbm(p*2.4+uSeed,6), n2=fbm(p*5.0+uSeed+3.0,5), d=fbm(p*16.0+uSeed,3);
    col=mix(vec3(0.88,0.80,0.36),vec3(0.82,0.47,0.14),smoothstep(-0.05,0.3,n));
    col=mix(col,vec3(0.94,0.92,0.78),smoothstep(0.1,0.4,n2)*0.8);
    col=mix(col,vec3(0.45,0.52,0.25),smoothstep(0.25,0.5,-n2)*0.35);
    float v=craterLayer(p*5.0)+0.6*craterLayer(p*11.0+5.0);
    col=mix(col,vec3(0.72,0.22,0.08),smoothstep(0.08,0.25,v)*0.8);   // sulfur rings
    col=mix(col,vec3(0.10,0.07,0.05),smoothstep(-0.12,-0.4,v));      // calderas
    col*=1.0+0.1*d;
    h=0.5+0.15*n+0.1*v;
  } else if(uType==10){ // Europa
    float n=fbm(p*2.0+uSeed,5), d=fbm(p*12.0+uSeed,4);
    col=mix(vec3(0.90,0.88,0.82),vec3(0.66,0.52,0.40),smoothstep(0.0,0.4,n)*0.8);
    vec3 q=p+0.08*vec3(fbm(p*3.0+1.0,3),fbm(p*3.0+7.0,3),fbm(p*3.0+13.0,3));
    float l=pow(1.0-abs(snoise(q*3.0+uSeed)),14.0)+0.8*pow(1.0-abs(snoise(q*6.5+uSeed+9.0)),16.0)+0.6*pow(1.0-abs(snoise(q*13.0+uSeed+2.0)),16.0);
    l=clamp(l,0.0,1.0);
    col=mix(col,vec3(0.50,0.29,0.19),l*0.85);
    col*=1.0+0.06*d;
    h=0.5-0.25*l+0.05*d;
  } else if(uType==11){ // Ganymede
    float n=fbm(p*1.8+uSeed,6), d=fbm(p*10.0+uSeed,4);
    float light=smoothstep(-0.02,0.12,n);
    float gr=pow(1.0-abs(snoise(p*vec3(9.0,14.0,9.0)+uSeed)),3.0);
    float cr=craters(p,4.0,4);
    col=mix(vec3(0.33,0.29,0.26),vec3(0.60,0.58,0.55),light);
    col*=1.0-0.18*gr*light+0.1*d;
    col+=vec3(0.32)*smoothstep(0.15,0.5,cr)+vec3(0.12)*smoothstep(-0.2,-0.5,cr);
    h=0.5+0.2*cr-0.08*gr*light+0.04*d;
  } else if(uType==12){ // Callisto
    float n=fbm(p*2.5+uSeed,5), d=fbm(p*12.0+uSeed,4);
    float cr=craters(p,4.0,5);
    col=vec3(0.27,0.23,0.20)*(1.0+0.35*n+0.15*d);
    col+=vec3(0.50,0.47,0.42)*smoothstep(0.1,0.5,abs(cr));
    h=0.5+0.22*cr+0.04*d;
  } else if(uType==13){ // Titan (haze)
    float t=bandT(p,0.5);
    col=mix(vec3(0.78,0.52,0.18),vec3(0.90,0.66,0.28),bandV(t,3.0));
    col=mix(col,vec3(0.62,0.40,0.20),smoothstep(0.5,1.0,p.y)*0.6);
  } else if(uType==14){ // icy moon (Enceladus)
    float d=fbm(p*8.0+uSeed,5);
    float cr=craters(p,5.0,4)*smoothstep(-0.2,0.5,p.y);
    vec3 q=p+0.06*vec3(fbm(p*4.0+1.0,3),fbm(p*4.0+7.0,3),fbm(p*4.0+13.0,3));
    float fr=pow(1.0-abs(snoise(q*5.0+uSeed)),12.0)+0.7*pow(1.0-abs(snoise(q*11.0+uSeed+4.0)),14.0);
    float tiger=pow(1.0-abs(snoise(vec3(q.x*7.0,q.y*2.0,q.z*1.5)+uSeed)),8.0)*smoothstep(-0.55,-0.85,p.y);
    fr=clamp(fr,0.0,1.0);
    col=vec3(0.93,0.95,0.97)*(1.0+0.05*d+0.12*cr);
    col=mix(col,vec3(0.70,0.80,0.90),fr*0.6);
    col=mix(col,vec3(0.30,0.60,0.80),clamp(tiger,0.0,1.0)*0.8);
    h=0.5+0.2*cr-0.2*fr-0.2*tiger;
  } else if(uType==15){ // generic cratered rock/ice
    float n=fbm(p*2.2+uSeed,6), d=fbm(p*11.0+uSeed,4);
    float cr=craters(p,3.0,5);
    col=uTint*(1.0+0.3*n+0.1*d+0.3*cr);
    col+=vec3(0.2)*smoothstep(0.3,0.6,cr);
    h=0.5+0.28*cr+0.1*n;
  } else if(uType==16){ // Triton
    float n=fbm(p*2.0+uSeed,5), d=fbm(p*14.0+uSeed,4);
    float south=smoothstep(0.15,-0.1,p.y+0.2*n);
    vec3 r=hash3(floor(p*18.0)+uSeed);
    float cant=length(fract(p*18.0)-0.5);
    vec3 north=vec3(0.58,0.63,0.67)*(0.85+0.3*smoothstep(0.2,0.5,cant)+0.1*r.x);
    vec3 cap=vec3(0.86,0.76,0.72)*(1.0+0.12*n+0.06*d);
    col=mix(north,cap,south);
    float st=smoothstep(0.75,0.9,ridged(vec3(p.x*6.0,p.y*6.0,p.z*14.0)+uSeed,3))*south;
    col=mix(col,vec3(0.25,0.2,0.2),st*0.6);
    h=0.5+0.15*smoothstep(0.2,0.5,cant)*(1.0-south)+0.05*n;
  } else { // dark rock (Phobos, Deimos)
    float n=fbm(p*2.5+uSeed,5), d=fbm(p*10.0+uSeed,4);
    float cr=craters(p,2.0,4);
    col=vec3(0.30,0.27,0.24)*(1.0+0.3*n+0.12*d+0.35*cr);
    h=0.5+0.35*cr+0.15*n;
  }
}
float cloudCover(vec3 p){
  vec3 q=p+0.18*vec3(fbm(p*2.5+11.0,4),fbm(p*2.5+23.0,4),fbm(p*2.5+37.0,4));
  float c=fbm(q*vec3(2.6,4.2,2.6)+uSeed,7);
  float fine=fbm(q*18.0+uSeed,4);
  float itcz=0.12*exp(-pow(p.y/0.12,2.0))+0.1*exp(-pow((abs(p.y)-0.7)/0.15,2.0));
  return smoothstep(0.02,0.42,c+itcz+0.12*fine-0.02)*0.95;
}
void main(){
  float phi=vUv.x*6.28318530718, th=(1.0-vUv.y)*3.14159265359;
  float st=sin(th), ct=cos(th), sp=sin(phi), cp=cos(phi);
  vec3 p=vec3(-cp*st,ct,sp*st);
  vec3 col; float h; float rough;
  if(uMode==0){
    surface(p,col,h,rough);
    gl_FragColor=vec4(pow(clamp(col,0.0,1.0),vec3(2.2)),rough);
  } else if(uMode==1){
    surface(p,col,h,rough);
    gl_FragColor=vec4(h,h,h,1.0);
  } else {
    gl_FragColor=vec4(1.0,1.0,1.0,cloudCover(p));
  }
}
`;

// height map -> tangent-space normal map (cheap: 4 texture taps instead of re-evaluating the surface)
const NORMAL_FRAG = /* glsl */ `
uniform sampler2D tH; uniform vec2 uPx; uniform float uBump; varying vec2 vUv;
void main(){
  float st=max(sin((1.0-vUv.y)*3.14159265359),0.03);
  float hl=texture2D(tH,vUv-vec2(uPx.x,0.0)).r, hr=texture2D(tH,vUv+vec2(uPx.x,0.0)).r;
  float hd=texture2D(tH,vUv-vec2(0.0,uPx.y)).r, hu=texture2D(tH,vUv+vec2(0.0,uPx.y)).r;
  float du=(hr-hl)/(2.0*uPx.x*6.28318530718*st), dv=(hu-hd)/(2.0*uPx.y*3.14159265359);
  gl_FragColor=vec4(normalize(vec3(-du*uBump,-dv*uBump,1.0))*0.5+0.5,1.0);
}`;

export function createBaker(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const common = {
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  };
  const mat = new THREE.ShaderMaterial({
    ...common, fragmentShader: BAKE_FRAG,
    uniforms: { uType: { value: 0 }, uMode: { value: 0 }, uSeed: { value: 0 }, uTint: { value: new THREE.Vector3(0.6, 0.6, 0.6) } },
  });
  const nmat = new THREE.ShaderMaterial({
    ...common, fragmentShader: NORMAL_FRAG,
    uniforms: { tH: { value: null }, uPx: { value: new THREE.Vector2() }, uBump: { value: 0.03 } },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function render(material, w, opts) {
    const rt = new THREE.WebGLRenderTarget(w, w / 2, { depthBuffer: false, ...opts });
    rt.texture.wrapS = THREE.RepeatWrapping;
    quad.material = material;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    return rt;
  }
  const final = (srgb) => ({
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });
  const finish = (rt) => { rt.texture.anisotropy = aniso; return rt.texture; };

  // Returns { map (rgb = albedo, a = roughness), normalMap?, clouds? }
  return function bake(def, size) {
    const u = mat.uniforms;
    u.uType.value = TEX[def.tex];
    u.uSeed.value = def.seed || 0;
    if (def.tint) u.uTint.value.set(...def.tint);
    u.uMode.value = 0;
    const out = { map: finish(render(mat, size, final(true))) };
    if (!GAS.has(def.tex)) {
      u.uMode.value = 1;
      const hrt = render(mat, size, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      nmat.uniforms.tH.value = hrt.texture;
      nmat.uniforms.uPx.value.set(1 / size, 2 / size);
      nmat.uniforms.uBump.value = def.bump || 0.03;
      out.normalMap = finish(render(nmat, size, final(false)));
      hrt.dispose();
    }
    if (def.clouds) { u.uMode.value = 2; out.clouds = finish(render(mat, size, final(false))); }
    return out;
  };
}
